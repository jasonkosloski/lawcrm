/**
 * Integration tests for the Gmail sync engine.
 *
 * `gmailFetch` (the contract seam with gmail-client) is mocked with
 * a tiny URL-dispatching fake Gmail; the DATABASE IS REAL (test
 * Postgres) because the persistence rules ARE the feature:
 *
 *   - history-vs-full path selection + historyId-404 → full resync;
 *   - idempotent re-upsert on the (accountId|threadId, externalId)
 *     uniques;
 *   - app-owned field preservation across resyncs (matterId filing,
 *     followUpAt, isPrivileged, app-vocabulary labels, downloaded
 *     attachment fileUrl);
 *   - label→flag mapping + custom:* label reconciliation;
 *   - write-time HTML sanitization of hostile mail;
 *   - initial-import cap (newest FULL_SYNC_MAX_THREADS, 90-day q=);
 *   - auth-error account marking vs transient restore-and-rethrow;
 *   - per-user account scoping + the page-load kick throttle.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...mod, gmailFetch: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import type {
  GmailMessage,
  GmailMessagePart,
  GmailThread,
} from "./gmail-message-parse";
import {
  backfillEmailAccount,
  FULL_SYNC_MAX_AGE_DAYS,
  FULL_SYNC_MAX_THREADS,
  GmailSyncError,
  maybeKickEmailSync,
  resetEmailSyncKickThrottleForTests,
  syncAllEmailAccounts,
  syncEmailAccount,
  syncEmailAccountsForUser,
} from "./gmail-sync";

const mockedFetch = vi.mocked(gmailFetch);

let userId: string;

beforeEach(async () => {
  await resetDb();
  resetEmailSyncKickThrottleForTests();
  mockedFetch.mockReset();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
});

async function seedAccount(opts?: {
  ownerId?: string;
  email?: string;
  historyId?: string | null;
  syncStatus?: string;
  syncError?: string | null;
  lastSyncAt?: Date | null;
}): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId: opts?.ownerId ?? userId,
      emailAddress: opts?.email ?? "me@gmail.com",
      refreshToken: "rt-secret",
      syncStatus: opts?.syncStatus ?? "connected",
      syncError: opts?.syncError ?? null,
      historyId: opts?.historyId ?? null,
      lastSyncAt: opts?.lastSyncAt ?? null,
    },
    select: { id: true },
  });
  return account.id;
}

// ── Gmail fixture builders ───────────────────────────────────────────────

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

function gmailMsg(opts: {
  id: string;
  threadId: string;
  labelIds?: string[];
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  html?: string;
  text?: string;
  snippet?: string;
  internalDate?: number;
  attachments?: Array<{ filename: string; attachmentId: string; size?: number }>;
}): GmailMessage {
  const bodyParts: GmailMessagePart[] = [];
  if (opts.text) {
    bodyParts.push({ mimeType: "text/plain", body: { data: b64(opts.text) } });
  }
  if (opts.html) {
    bodyParts.push({ mimeType: "text/html", body: { data: b64(opts.html) } });
  }
  const alt: GmailMessagePart = {
    mimeType: "multipart/alternative",
    parts: bodyParts,
  };
  const attachmentParts: GmailMessagePart[] = (opts.attachments ?? []).map(
    (a) => ({
      mimeType: "application/pdf",
      filename: a.filename,
      body: { attachmentId: a.attachmentId, size: a.size ?? 1000 },
    })
  );
  return {
    id: opts.id,
    threadId: opts.threadId,
    labelIds: opts.labelIds ?? ["INBOX"],
    snippet: opts.snippet ?? "snippet",
    internalDate: String(opts.internalDate ?? 1_767_000_000_000),
    payload: {
      mimeType: attachmentParts.length ? "multipart/mixed" : alt.mimeType,
      headers: [
        { name: "From", value: opts.from ?? "Jane Smith <jane@firm.com>" },
        { name: "To", value: opts.to ?? "you@kosloskilaw.com" },
        ...(opts.cc ? [{ name: "Cc", value: opts.cc }] : []),
        { name: "Subject", value: opts.subject ?? "Discovery schedule" },
      ],
      parts: attachmentParts.length ? [alt, ...attachmentParts] : bodyParts,
    },
  };
}

type FakeGmail = {
  profileHistoryId?: string;
  labels?: Array<{ id: string; name: string; type?: string }>;
  threads?: GmailThread[];
  /** history.list behavior: a 404, or records + the new cursor. */
  history?:
    | { status: 404 }
    | {
        historyId: string;
        records: Array<{
          messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
          labelsRemoved?: Array<{ message: { id: string; threadId: string } }>;
          labelsAdded?: Array<{ message: { id: string; threadId: string } }>;
        }>;
      };
  /** Force a status for any endpoint path prefix. */
  failWith?: { pathPrefix: string; status: number };
};

/** Requested paths, for "endpoint X was (not) called" assertions. */
function requestedPaths(): string[] {
  return mockedFetch.mock.calls.map(([, path]) => path);
}

function installFakeGmail(fake: FakeGmail): void {
  const threadById = new Map((fake.threads ?? []).map((t) => [t.id, t]));
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  mockedFetch.mockImplementation(async (_accountId, path) => {
    const url = new URL(path, "https://gmail.googleapis.com");
    const p = url.pathname;
    if (fake.failWith && path.startsWith(fake.failWith.pathPrefix)) {
      return json({ error: "boom" }, fake.failWith.status);
    }
    if (p.endsWith("/users/me/labels")) {
      return json({ labels: fake.labels ?? [] });
    }
    if (p.endsWith("/users/me/profile")) {
      return json({ historyId: fake.profileHistoryId ?? "h-profile" });
    }
    if (p.endsWith("/users/me/history")) {
      if (!fake.history) return json({ historyId: "h-none", history: [] });
      if ("status" in fake.history) return json({ error: "expired" }, 404);
      return json({
        historyId: fake.history.historyId,
        history: fake.history.records,
      });
    }
    if (p.endsWith("/users/me/threads")) {
      // Paginated list, newest-first as given; pageToken = offset.
      const pageSize = Number(url.searchParams.get("maxResults") ?? 100);
      const offset = Number(url.searchParams.get("pageToken") ?? 0);
      const all = fake.threads ?? [];
      const page = all.slice(offset, offset + pageSize);
      const next = offset + pageSize < all.length ? String(offset + pageSize) : undefined;
      return json({
        threads: page.map((t) => ({ id: t.id })),
        ...(next ? { nextPageToken: next } : {}),
      });
    }
    const threadMatch = p.match(/\/users\/me\/threads\/([^/]+)$/);
    if (threadMatch) {
      const thread = threadById.get(threadMatch[1]);
      return thread ? json(thread) : json({ error: "not found" }, 404);
    }
    throw new Error(`fake gmail: unhandled path ${path}`);
  });
}

const LABELS = [
  { id: "Label_1", name: "Clients/Smith", type: "user" },
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "CATEGORY_PROMOTIONS", name: "CATEGORY_PROMOTIONS", type: "system" },
];

function basicThread(): GmailThread {
  return {
    id: "t1",
    historyId: "h1",
    messages: [
      gmailMsg({
        id: "m1",
        threadId: "t1",
        labelIds: ["INBOX"],
        html: "<div><p>Hello <strong>counsel</strong></p></div>",
        text: "Hello counsel",
        internalDate: 1_767_000_000_000,
      }),
      gmailMsg({
        id: "m2",
        threadId: "t1",
        labelIds: ["INBOX", "UNREAD", "STARRED", "Label_1", "CATEGORY_PROMOTIONS"],
        from: '"Smith, Ann" <ann@x.co>',
        cc: "Bob <bob@x.co>",
        snippet: "Tom &amp; Jerry&#39;s exhibits",
        html: "<p>Reply body</p>",
        internalDate: 1_767_000_600_000,
        attachments: [{ filename: "exhibit-a.pdf", attachmentId: "att-123", size: 54321 }],
      }),
    ],
  };
}

// ── Full sync ────────────────────────────────────────────────────────────

describe("syncEmailAccount — full sync (no cursor)", () => {
  it("imports threads/messages/labels, maps flags, stores the profile cursor", async () => {
    const accountId = await seedAccount();
    installFakeGmail({
      profileHistoryId: "h100",
      labels: LABELS,
      threads: [basicThread()],
    });

    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({
      accountId,
      ok: true,
      mode: "full",
      threadsSynced: 1,
    });

    // Age cap rides the list call as a Gmail query.
    const listCall = requestedPaths().find((p) =>
      p.startsWith("/users/me/threads?")
    );
    expect(listCall).toContain(
      encodeURIComponent(`newer_than:${FULL_SYNC_MAX_AGE_DAYS}d`)
    );

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("connected");
    expect(account.historyId).toBe("h100");
    expect(account.syncError).toBeNull();
    expect(account.lastSyncAt).not.toBeNull();
    expect(account.threadsIndexed).toBe(1);

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: "t1" } },
      include: { labels: true, messages: { include: { attachments: true } } },
    });
    expect(thread.subject).toBe("Discovery schedule");
    // Snippet comes from the LAST message, entity-decoded.
    expect(thread.snippet).toBe("Tom & Jerry's exhibits");
    expect(thread.messageCount).toBe(2);
    expect(thread.hasAttachments).toBe(true);
    expect(thread.lastMessageAt).toEqual(new Date(1_767_000_600_000));
    // Flags: an UNREAD message → unread; any STARRED → starred;
    // INBOX present → not archived.
    expect(thread.isRead).toBe(false);
    expect(thread.isStarred).toBe(true);
    expect(thread.isArchived).toBe(false);
    // User label mapped through the label map into custom:*;
    // system + CATEGORY_* ids never become rows.
    expect(thread.labels.map((l) => l.label)).toEqual(["custom:clients_smith"]);

    const [m1, m2] = thread.messages.sort((a, b) =>
      a.sentAt.getTime() - b.sentAt.getTime()
    );
    expect(m1.fromName).toBe("Jane Smith");
    expect(m1.fromEmail).toBe("jane@firm.com");
    expect(JSON.parse(m1.toRecipients)).toEqual([
      { name: "", email: "you@kosloskilaw.com" },
    ]);
    expect(m1.body).toContain("Hello <strong>counsel</strong>");
    expect(m2.fromName).toBe("Smith, Ann");
    expect(JSON.parse(m2.ccRecipients!)).toEqual([
      { name: "Bob", email: "bob@x.co" },
    ]);
    expect(m2.attachments).toHaveLength(1);
    expect(m2.attachments[0]).toMatchObject({
      filename: "exhibit-a.pdf",
      contentType: "application/pdf",
      fileSize: 54321,
      fileUrl: "gmail:att-123",
    });
  });

  it("SANITIZES HOSTILE MAIL AT WRITE TIME (script gone, pixel blocked)", async () => {
    const accountId = await seedAccount();
    const hostile: GmailThread = {
      id: "t-evil",
      messages: [
        gmailMsg({
          id: "m-evil",
          threadId: "t-evil",
          html:
            "<div><script>document.location='https://evil.example/steal'</script>" +
            '<img src="https://tracker.example/pixel.gif" alt="">' +
            '<p onmouseover="alert(1)" style="color:#333;position:fixed">Dear Counsel</p>' +
            '<a href="javascript:alert(1)">click</a></div>',
        }),
      ],
    };
    installFakeGmail({ labels: [], threads: [hostile] });
    await syncEmailAccount(accountId);

    const message = await prisma.emailMessage.findFirstOrThrow({
      where: { externalId: "m-evil" },
    });
    expect(message.body).not.toContain("<script");
    expect(message.body).not.toContain("evil.example");
    expect(message.body).not.toContain("tracker.example");
    expect(message.body).not.toContain("onmouseover");
    expect(message.body).not.toContain("javascript:");
    expect(message.body).not.toContain("position");
    expect(message.body).toContain("[image blocked]");
    expect(message.body).toContain("color:#333");
    expect(message.body).toContain("Dear Counsel");
  });

  it("enforces the initial-import cap (newest FULL_SYNC_MAX_THREADS only)", async () => {
    const accountId = await seedAccount();
    const total = FULL_SYNC_MAX_THREADS + 50;
    const threads: GmailThread[] = Array.from({ length: total }, (_, i) => ({
      id: `t${i}`,
      messages: [
        gmailMsg({
          id: `t${i}-m0`,
          threadId: `t${i}`,
          subject: `Thread ${i}`,
          text: "hi",
          // List order is newest-first: t0 newest.
          internalDate: 1_767_000_000_000 - i * 1000,
        }),
      ],
    }));
    installFakeGmail({ labels: [], threads });

    const result = await syncEmailAccount(accountId);
    expect(result.threadsSynced).toBe(FULL_SYNC_MAX_THREADS);
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(
      FULL_SYNC_MAX_THREADS
    );
    // Newest (t0) in, first-over-the-cap (t200) out.
    const externalIds = new Set(
      (
        await prisma.emailThread.findMany({
          where: { accountId },
          select: { externalId: true },
        })
      ).map((t) => t.externalId)
    );
    expect(externalIds.has("t0")).toBe(true);
    expect(externalIds.has(`t${FULL_SYNC_MAX_THREADS}`)).toBe(false);
  }, 30_000);
});

// ── Incremental sync ─────────────────────────────────────────────────────

describe("syncEmailAccount — incremental (cursor present)", () => {
  it("fetches only history-affected threads and advances the cursor", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    const untouched: GmailThread = {
      id: "t-untouched",
      messages: [gmailMsg({ id: "mu", threadId: "t-untouched", text: "old" })],
    };
    installFakeGmail({
      labels: [],
      threads: [basicThread(), untouched],
      history: {
        historyId: "h200",
        records: [
          { messagesAdded: [{ message: { id: "m2", threadId: "t1" } }] },
          { labelsRemoved: [{ message: { id: "m1", threadId: "t1" } }] },
        ],
      },
    });

    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({ ok: true, mode: "incremental", threadsSynced: 1 });

    const paths = requestedPaths();
    expect(paths.some((p) => p.includes("startHistoryId=h100"))).toBe(true);
    expect(paths.some((p) => p.includes("/users/me/threads/t1"))).toBe(true);
    expect(paths.some((p) => p.includes("/users/me/threads/t-untouched"))).toBe(false);
    // No full-sync list walk on the incremental path.
    expect(paths.some((p) => p.startsWith("/users/me/threads?"))).toBe(false);

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.historyId).toBe("h200");
  });

  it("keeps the local thread when the provider 404s it (firm record)", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    installFakeGmail({
      labels: [],
      threads: [], // every thread fetch 404s
      history: {
        historyId: "h200",
        records: [{ messagesAdded: [{ message: { id: "mx", threadId: "t-gone" } }] }],
      },
    });
    // Pre-existing local copy of the now-deleted thread.
    await prisma.emailThread.create({
      data: {
        accountId,
        externalId: "t-gone",
        subject: "Kept",
        lastMessageAt: new Date(),
      },
    });

    const result = await syncEmailAccount(accountId);
    expect(result.ok).toBe(true);
    expect(result.threadsSynced).toBe(0);
    expect(
      await prisma.emailThread.count({ where: { accountId, externalId: "t-gone" } })
    ).toBe(1);
  });

  it("falls back to a FULL resync when the cursor expired (history 404)", async () => {
    const accountId = await seedAccount({ historyId: "h-stale" });
    installFakeGmail({
      profileHistoryId: "h-new",
      labels: [],
      threads: [basicThread()],
      history: { status: 404 },
    });

    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({ ok: true, mode: "full", threadsSynced: 1 });

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.historyId).toBe("h-new");
    expect(
      requestedPaths().some((p) => p.startsWith("/users/me/threads?"))
    ).toBe(true);
  });
});

// ── Idempotency + preservation ───────────────────────────────────────────

describe("re-upsert semantics", () => {
  it("is idempotent — running the same full sync twice changes nothing", async () => {
    const accountId = await seedAccount();
    installFakeGmail({ labels: LABELS, threads: [basicThread()] });
    await syncEmailAccount(accountId);
    // Cursor advanced → force the full path again for a true re-import.
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: { historyId: null },
    });
    await syncEmailAccount(accountId);

    expect(await prisma.emailThread.count()).toBe(1);
    expect(await prisma.emailMessage.count()).toBe(2);
    expect(await prisma.emailAttachment.count()).toBe(1);
    expect(await prisma.emailLabel.count()).toBe(1);
  });

  it("preserves app-owned fields across a resync (filing survives)", async () => {
    const accountId = await seedAccount();
    installFakeGmail({ labels: LABELS, threads: [basicThread()] });
    await syncEmailAccount(accountId);

    // App-side state: file the thread to a matter, snooze it, flag a
    // message privileged, add an app-vocabulary label, and simulate a
    // completed attachment download.
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const thread = await prisma.emailThread.findFirstOrThrow({
      where: { accountId },
      include: { messages: { include: { attachments: true } } },
    });
    const followUpAt = new Date("2026-08-01T00:00:00Z");
    await prisma.emailThread.update({
      where: { id: thread.id },
      data: { matterId, followUpAt },
    });
    await prisma.emailLabel.create({
      data: { threadId: thread.id, label: "privileged" },
    });
    const flaggedMessage = thread.messages[0];
    await prisma.emailMessage.update({
      where: { id: flaggedMessage.id },
      data: { isPrivileged: true },
    });
    const attachment = thread.messages
      .flatMap((m) => m.attachments)
      .find((a) => a.fileUrl === "gmail:att-123")!;
    await prisma.emailAttachment.update({
      where: { id: attachment.id },
      data: { fileUrl: "https://storage.example/exhibit-a.pdf" },
    });

    // Provider-side changes: subject edit (new draft subject), the
    // thread read + unstarred, user label removed.
    const updated = basicThread();
    const updatedMessages = (updated.messages ?? []).map((m) => ({
      ...m,
      labelIds: ["INBOX"],
    }));
    updatedMessages[0].payload!.headers = updatedMessages[0].payload!.headers!.map(
      (h) =>
        h.name === "Subject" ? { ...h, value: "Discovery schedule (amended)" } : h
    );
    updated.messages = updatedMessages;
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: { historyId: null },
    });
    installFakeGmail({ labels: LABELS, threads: [updated] });
    await syncEmailAccount(accountId);

    const after = await prisma.emailThread.findUniqueOrThrow({
      where: { id: thread.id },
      include: { labels: true, messages: { include: { attachments: true } } },
    });
    // Provider-owned columns updated…
    expect(after.subject).toBe("Discovery schedule (amended)");
    expect(after.isRead).toBe(true);
    expect(after.isStarred).toBe(false);
    // …app-owned state intact.
    expect(after.matterId).toBe(matterId);
    expect(after.followUpAt).toEqual(followUpAt);
    expect(
      after.messages.find((m) => m.id === flaggedMessage.id)!.isPrivileged
    ).toBe(true);
    // custom:* namespace reconciled (label removed at Gmail),
    // app-vocabulary label untouched.
    expect(after.labels.map((l) => l.label)).toEqual(["privileged"]);
    // Downloaded attachment bytes keep their storage URL.
    expect(
      after.messages.flatMap((m) => m.attachments).map((a) => a.fileUrl)
    ).toEqual(["https://storage.example/exhibit-a.pdf"]);
  });
});

// ── Failure semantics ────────────────────────────────────────────────────

describe("failure semantics", () => {
  it("GmailAuthError → account marked error, result ok:false, no throw", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockRejectedValue(
      new GmailAuthError("Reconnect this mailbox.", accountId)
    );

    const result = await syncEmailAccount(accountId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Reconnect this mailbox.");

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("error");
    expect(account.syncError).toBe("Reconnect this mailbox.");
  });

  it("transient failure → status restored, syncError recorded, error rethrown", async () => {
    const accountId = await seedAccount();
    installFakeGmail({
      labels: [],
      threads: [],
      failWith: { pathPrefix: "/users/me/profile", status: 500 },
    });

    await expect(syncEmailAccount(accountId)).rejects.toThrow(GmailSyncError);

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("connected"); // NOT error
    expect(account.syncError).toContain("Last sync failed");
    // A later successful sync clears the note.
    installFakeGmail({ labels: [], threads: [] });
    await syncEmailAccount(accountId);
    const healed = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(healed.syncError).toBeNull();
    expect(healed.syncStatus).toBe("connected");
  });
});

// ── Older-mail backfill ──────────────────────────────────────────────────

describe("backfillEmailAccount", () => {
  /** Anchor with a sub-second remainder so the round-UP is pinned:
   *  ceil(1_767_000_000_500 / 1000) = 1_767_000_001. */
  const ANCHOR_MS = 1_767_000_000_500;

  async function seedLocalAnchor(accountId: string): Promise<void> {
    await prisma.emailThread.create({
      data: {
        accountId,
        externalId: "t-anchor",
        subject: "Oldest local",
        lastMessageAt: new Date(ANCHOR_MS),
      },
    });
  }

  function olderThreads(): GmailThread[] {
    // Fake list order is newest-first: anchor (already local), then
    // two genuinely older threads.
    return [
      {
        id: "t-anchor",
        messages: [
          gmailMsg({ id: "ma", threadId: "t-anchor", internalDate: ANCHOR_MS }),
        ],
      },
      {
        id: "t-old1",
        messages: [
          gmailMsg({
            id: "mo1",
            threadId: "t-old1",
            subject: "Older 1",
            internalDate: ANCHOR_MS - 86_400_000,
          }),
        ],
      },
      {
        id: "t-old2",
        messages: [
          gmailMsg({
            id: "mo2",
            threadId: "t-old2",
            subject: "Older 2",
            internalDate: ANCHOR_MS - 2 * 86_400_000,
          }),
        ],
      },
    ];
  }

  it("walks one window below the oldest local thread (q=before:<epoch s, rounded up>)", async () => {
    const accountId = await seedAccount();
    await seedLocalAnchor(accountId);
    installFakeGmail({ labels: [], threads: olderThreads() });

    const result = await backfillEmailAccount(accountId);
    expect(result).toMatchObject({
      accountId,
      ok: true,
      threadsSynced: 2,
      before: new Date(ANCHOR_MS),
    });

    // The list query anchors on epoch SECONDS, rounded up so the
    // sub-second remainder can't skip mail.
    const listCall = requestedPaths().find((p) =>
      p.startsWith("/users/me/threads?")
    );
    expect(listCall).toContain(encodeURIComponent("before:1767000001"));
    // No now-relative operator sneaks into an anchored window.
    expect(listCall).not.toContain("newer_than");

    // Already-local anchor thread was skipped WITHOUT a refetch…
    expect(
      requestedPaths().some((p) => p.includes("/users/me/threads/t-anchor"))
    ).toBe(false);
    // …and both older threads landed.
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(3);

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.threadsIndexed).toBe(3);
    // Backfill stays out of the sync status machine.
    expect(account.historyId).toBeNull();
    expect(account.lastSyncAt).toBeNull();
    expect(account.syncError).toBeNull();
  });

  it("is idempotent — re-running the same window imports nothing new", async () => {
    const accountId = await seedAccount();
    await seedLocalAnchor(accountId);
    installFakeGmail({ labels: [], threads: olderThreads() });

    await backfillEmailAccount(accountId);
    const second = await backfillEmailAccount(accountId);

    expect(second.ok).toBe(true);
    expect(second.threadsSynced).toBe(0);
    // Second call re-anchored at the NEW oldest thread (t-old2).
    expect(second.before).toEqual(new Date(ANCHOR_MS - 2 * 86_400_000));
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(3);
    expect(await prisma.emailMessage.count()).toBe(2);
  });

  it("honors the per-call thread cap (newest-first within the window)", async () => {
    const accountId = await seedAccount();
    await seedLocalAnchor(accountId);
    installFakeGmail({ labels: [], threads: olderThreads() });

    const result = await backfillEmailAccount(accountId, { maxThreads: 1 });
    expect(result.threadsSynced).toBe(1);

    const externalIds = new Set(
      (
        await prisma.emailThread.findMany({
          where: { accountId },
          select: { externalId: true },
        })
      ).map((t) => t.externalId)
    );
    expect(externalIds.has("t-old1")).toBe(true); // newest of the window
    expect(externalIds.has("t-old2")).toBe(false); // next click's window
  });

  it("no local threads → nothing to anchor on, no Gmail traffic", async () => {
    const accountId = await seedAccount();
    installFakeGmail({ labels: [], threads: olderThreads() });

    const result = await backfillEmailAccount(accountId);
    expect(result).toMatchObject({ ok: true, threadsSynced: 0, before: null });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("GmailAuthError → account marked error, ok:false, no throw", async () => {
    const accountId = await seedAccount();
    await seedLocalAnchor(accountId);
    mockedFetch.mockRejectedValue(
      new GmailAuthError("Reconnect this mailbox.", accountId)
    );

    const result = await backfillEmailAccount(accountId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Reconnect this mailbox.");

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("error");
    expect(account.syncError).toBe("Reconnect this mailbox.");
  });

  it("transient failure → syncError notes the backfill, error rethrown", async () => {
    const accountId = await seedAccount();
    await seedLocalAnchor(accountId);
    installFakeGmail({
      labels: [],
      threads: [],
      failWith: { pathPrefix: "/users/me/labels", status: 500 },
    });

    await expect(backfillEmailAccount(accountId)).rejects.toThrow(
      GmailSyncError
    );

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("connected"); // NOT error
    expect(account.syncError).toContain("Last backfill failed");
  });
});

// ── Multi-account wrappers + kick throttle ───────────────────────────────

describe("syncEmailAccountsForUser", () => {
  it("syncs only the given user's accounts; reconnect-required rows are reported, not retried", async () => {
    const { firmId } = await prisma.user
      .findUniqueOrThrow({ where: { id: userId }, select: { firmId: true } })
      .then((u) => ({ firmId: u.firmId! }));
    const { userId: otherUserId } = await seedUser({
      firmId,
      email: "other@kosloskilaw.com",
    });
    const mine = await seedAccount();
    const mineBroken = await seedAccount({
      email: "me2@gmail.com",
      syncStatus: "error",
      syncError: "Reconnect required.",
    });
    await seedAccount({ ownerId: otherUserId, email: "other@gmail.com" });

    installFakeGmail({ labels: [], threads: [basicThread()] });
    const results = await syncEmailAccountsForUser(userId);

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.accountId === mine)).toMatchObject({
      ok: true,
      mode: "full",
    });
    expect(results.find((r) => r.accountId === mineBroken)).toMatchObject({
      ok: false,
      mode: "skipped",
      error: "Reconnect required.",
    });
    // The other user's account was never touched…
    expect(
      mockedFetch.mock.calls.every(([accountId]) => accountId === mine)
    ).toBe(true);
    // …and one transiently-failing mailbox doesn't block the pass
    // (covered implicitly: the broken account is skipped pre-Google).
  });
});

describe("maybeKickEmailSync — page-load throttle", () => {
  it("runs when an account is stale, then throttles repeat kicks", async () => {
    await seedAccount({ lastSyncAt: null });
    installFakeGmail({ labels: [], threads: [] });

    expect(await maybeKickEmailSync(userId)).toEqual({ ran: true });
    const callsAfterFirst = mockedFetch.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second kick inside the window: throttled, no Google traffic.
    expect(await maybeKickEmailSync(userId)).toEqual({ ran: false });
    expect(mockedFetch.mock.calls.length).toBe(callsAfterFirst);
  });

  it("no-ops (without syncing) when every account synced recently", async () => {
    await seedAccount({ lastSyncAt: new Date() });
    installFakeGmail({ labels: [], threads: [] });
    expect(await maybeKickEmailSync(userId)).toEqual({ ran: false });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("never throws even when the sync blows up", async () => {
    await seedAccount({ lastSyncAt: null });
    mockedFetch.mockRejectedValue(new Error("network down"));
    await expect(maybeKickEmailSync(userId)).resolves.toEqual({ ran: true });
  });
});

// ── W6a: isolation, drafts, deactivated owners, catch-up, anchor ─────────

describe("poison-message isolation (F069)", () => {
  it("strips NUL bytes from subject, body, sender and filename instead of failing the insert", async () => {
    const accountId = await seedAccount();
    const thread: GmailThread = {
      id: "t-nul",
      messages: [
        gmailMsg({
          id: "m-nul",
          threadId: "t-nul",
          // =?UTF-8?B?AA==?= decodes to a single U+0000.
          subject: "=?UTF-8?B?AA==?=Hello",
          from: "Eve\u0000 <eve@x.co>",
          text: "body\u0000with\u0000nuls",
          snippet: "snip\u0000pet",
          attachments: [{ filename: "a\u0000.pdf", attachmentId: "att-1" }],
        }),
      ],
    };
    installFakeGmail({ labels: [], threads: [thread] });

    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({ ok: true, threadsSynced: 1 });

    const stored = await prisma.emailThread.findFirstOrThrow({
      where: { accountId },
      include: { messages: { include: { attachments: true } } },
    });
    expect(stored.subject).toBe("Hello");
    expect(stored.snippet).toBe("snippet");
    expect(stored.messages[0].body).toContain("bodywithnuls");
    expect(stored.messages[0].body).not.toContain("\u0000");
    expect(stored.messages[0].fromName).not.toContain("\u0000");
    expect(stored.messages[0].attachments[0].filename).toBe("a.pdf");
  });

  it("one poisoned thread is skipped and logged; the rest sync and the cursor still advances", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    const poisoned: GmailThread = {
      id: "t-bad",
      messages: [gmailMsg({ id: "mb", threadId: "t-bad", text: "x" })],
    };
    // An unparseable internalDate makes the insert throw.
    poisoned.messages![0].internalDate = "not-a-number";
    const good: GmailThread = {
      id: "t-good",
      messages: [gmailMsg({ id: "mg", threadId: "t-good", text: "fine" })],
    };
    installFakeGmail({
      labels: [],
      threads: [poisoned, good],
      history: {
        historyId: "h200",
        records: [
          { messagesAdded: [{ message: { id: "mb", threadId: "t-bad" } }] },
          { messagesAdded: [{ message: { id: "mg", threadId: "t-good" } }] },
        ],
      },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({ ok: true, mode: "incremental", threadsSynced: 1 });
    expect(
      await prisma.emailThread.count({ where: { accountId, externalId: "t-good" } })
    ).toBe(1);
    expect(
      await prisma.emailThread.count({ where: { accountId, externalId: "t-bad" } })
    ).toBe(0);

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.historyId).toBe("h200"); // cursor NOT wedged
    expect(account.syncStatus).toBe("connected");
    expect(account.syncError).toContain("1 thread(s)");
    // Logged with ids only — never message content.
    const logged = String(errSpy.mock.calls[0][0]);
    expect(logged).toContain(accountId);
    expect(logged).toContain("t-bad");

    // A later clean pass clears the note.
    installFakeGmail({ labels: [], threads: [good] });
    await syncEmailAccount(accountId);
    expect(
      (await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } }))
        .syncError
    ).toBeNull();
    errSpy.mockRestore();
  });

  it("an auth error from a thread fetch still stops the account", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    installFakeGmail({
      labels: [],
      threads: [],
      history: {
        historyId: "h200",
        records: [{ messagesAdded: [{ message: { id: "m", threadId: "t" } }] }],
      },
    });
    const base = mockedFetch.getMockImplementation()!;
    mockedFetch.mockImplementation(async (id, path, init) => {
      if (path.includes("/users/me/threads/")) {
        throw new GmailAuthError("Reconnect this mailbox.", accountId);
      }
      return base(id, path, init);
    });
    const result = await syncEmailAccount(accountId);
    expect(result.ok).toBe(false);
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("error");
    expect(account.historyId).toBe("h100");
  });
});

describe("transient failures abort the pass (review of F069)", () => {
  function threadAndHistory(ids: string[]) {
    const threads: GmailThread[] = ids.map((id) => ({
      id,
      messages: [gmailMsg({ id: `m-${id}`, threadId: id, text: "x" })],
    }));
    return {
      labels: [],
      threads,
      history: {
        historyId: "h200",
        records: ids.map((id) => ({
          messagesAdded: [{ message: { id: `m-${id}`, threadId: id } }],
        })),
      },
    };
  }

  it("a connectivity-class database error is NOT skipped: the pass aborts and historyId stays put", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    installFakeGmail(threadAndHistory(["t-a", "t-b"]));
    const spy = vi.spyOn(prisma.emailThread, "upsert").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
        code: "P1001",
        clientVersion: "test",
      })
    );
    await expect(syncEmailAccount(accountId)).rejects.toThrow();
    spy.mockRestore();

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.historyId).toBe("h100");
    expect(account.syncError).toContain("Last sync failed");

    // The next run retries and imports both threads.
    const retry = await syncEmailAccount(accountId);
    expect(retry.threadsSynced).toBe(2);
    expect(
      (await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } }))
        .historyId
    ).toBe("h200");
  });

  it("a deadlock / serialization failure (P2034) also aborts", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    installFakeGmail(threadAndHistory(["t-a"]));
    const spy = vi.spyOn(prisma.emailThread, "upsert").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("write conflict", {
        code: "P2034",
        clientVersion: "test",
      })
    );
    await expect(syncEmailAccount(accountId)).rejects.toThrow();
    spy.mockRestore();
    expect(
      (await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } }))
        .historyId
    ).toBe("h100");
  });

  it("when several threads ALL fail and none succeeds, the pass aborts instead of advancing the cursor", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    const fake = threadAndHistory(["t-1", "t-2", "t-3"]);
    for (const t of fake.threads) t.messages![0].internalDate = "not-a-number";
    installFakeGmail(fake);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(syncEmailAccount(accountId)).rejects.toThrow(/All 3 thread imports failed/);
    errSpy.mockRestore();
    expect(
      (await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } }))
        .historyId
    ).toBe("h100");
  });
});

describe("drafts (F070)", () => {
  it("never stores DRAFT messages and removes local copies of ones that now carry DRAFT", async () => {
    const accountId = await seedAccount();
    const sent = gmailMsg({
      id: "m-sent",
      threadId: "t-d",
      text: "real mail",
      internalDate: 1_767_000_000_000,
    });
    const draft = gmailMsg({
      id: "m-draft",
      threadId: "t-d",
      labelIds: ["DRAFT"],
      subject: "Re: secret strategy",
      text: "unsent privileged text",
      snippet: "unsent",
      internalDate: 1_767_000_900_000,
    });
    // Pre-existing local copy of the draft (imported by an older build).
    const t = await prisma.emailThread.create({
      data: {
        accountId,
        externalId: "t-d",
        subject: "old",
        lastMessageAt: new Date(1_767_000_900_000),
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: t.id,
        externalId: "m-draft",
        fromName: "me",
        fromEmail: "me@x.co",
        toRecipients: "[]",
        body: "stale draft",
        sentAt: new Date(),
      },
    });
    installFakeGmail({
      labels: [],
      threads: [
        { id: "t-d", messages: [sent, draft] },
        // A brand-new compose draft is a draft-only thread.
        {
          id: "t-draft-only",
          messages: [
            gmailMsg({
              id: "m-d2",
              threadId: "t-draft-only",
              labelIds: ["DRAFT"],
              text: "wip",
            }),
          ],
        },
      ],
    });

    const result = await syncEmailAccount(accountId);
    expect(result.threadsSynced).toBe(1);

    const messages = await prisma.emailMessage.findMany({
      where: { threadId: t.id },
    });
    expect(messages.map((m) => m.externalId)).toEqual(["m-sent"]);
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: t.id },
    });
    // Subject / snippet / messageCount / lastMessageAt ignore the draft.
    expect(thread.subject).toBe("Discovery schedule");
    expect(thread.messageCount).toBe(1);
    expect(thread.snippet).toBe("snippet");
    expect(thread.lastMessageAt.getTime()).toBe(1_767_000_000_000);
    expect(
      await prisma.emailThread.count({
        where: { accountId, externalId: "t-draft-only" },
      })
    ).toBe(0);
  });
});

describe("deactivated owners (F071/F348)", () => {
  async function deactivate(): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
  }

  it("the cron sweep and the per-user sweep skip a deactivated member's mailbox", async () => {
    await seedAccount();
    await deactivate();
    installFakeGmail({ labels: [], threads: [basicThread()] });

    expect(await syncAllEmailAccounts()).toEqual([]);
    expect(await syncEmailAccountsForUser(userId)).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("direct on-demand sync of an inactive owner's account makes no Google calls and leaves state alone", async () => {
    const accountId = await seedAccount();
    await deactivate();
    installFakeGmail({ labels: [], threads: [basicThread()] });

    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({ ok: false, mode: "skipped" });
    expect(mockedFetch).not.toHaveBeenCalled();
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("connected");
  });

  it("active members' accounts still sync in the cron sweep", async () => {
    const accountId = await seedAccount();
    installFakeGmail({ labels: [], threads: [basicThread()] });
    const results = await syncAllEmailAccounts();
    expect(results.map((r) => r.accountId)).toEqual([accountId]);
  });
});

describe("history-expired catch-up (F257)", () => {
  function manyThreads(n: number): GmailThread[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      messages: [
        gmailMsg({
          id: `m${i}`,
          threadId: `t${i}`,
          text: `body ${i}`,
          internalDate: 1_767_000_000_000 - i * 1000,
        }),
      ],
    }));
  }

  it("an account that has synced before catches up UNCAPPED since lastSyncAt (minus a day)", async () => {
    const lastSyncAt = new Date("2026-03-01T12:00:00Z");
    const accountId = await seedAccount({ historyId: "h-stale", lastSyncAt });
    installFakeGmail({
      profileHistoryId: "h-new",
      labels: [],
      threads: manyThreads(FULL_SYNC_MAX_THREADS + 5),
      history: { status: 404 },
    });

    const result = await syncEmailAccount(accountId);
    expect(result.mode).toBe("full");
    expect(result.threadsSynced).toBe(FULL_SYNC_MAX_THREADS + 5);

    const listCall = requestedPaths().find((p) =>
      p.startsWith("/users/me/threads?")
    )!;
    const q = new URLSearchParams(listCall.split("?")[1]).get("q");
    expect(q).toBe(`after:${Math.floor(lastSyncAt.getTime() / 1000) - 86400}`);
    expect(
      (await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } }))
        .historyId
    ).toBe("h-new");
  }, 30_000);

  it("an account that never completed a sync keeps the capped initial import", async () => {
    const accountId = await seedAccount({ historyId: "h-stale", lastSyncAt: null });
    installFakeGmail({
      profileHistoryId: "h-new",
      labels: [],
      threads: manyThreads(FULL_SYNC_MAX_THREADS + 5),
      history: { status: 404 },
    });
    const result = await syncEmailAccount(accountId);
    expect(result.threadsSynced).toBe(FULL_SYNC_MAX_THREADS);
    const listCall = requestedPaths().find((p) =>
      p.startsWith("/users/me/threads?")
    )!;
    expect(new URLSearchParams(listCall.split("?")[1]).get("q")).toBe(
      `newer_than:${FULL_SYNC_MAX_AGE_DAYS}d`
    );
  }, 30_000);
});

describe("catch-up truncation (review of F257)", () => {
  it("a catch-up that hits its cap leaves cursor + lastSyncAt alone, notes it, and later passes skip what is already local and reach the rest", async () => {
    const lastSyncAt = new Date("2026-03-01T12:00:00Z");
    const accountId = await seedAccount({ historyId: "h-stale", lastSyncAt });
    const threads: GmailThread[] = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      messages: [
        gmailMsg({
          id: `m${i}`,
          threadId: `t${i}`,
          text: `body ${i}`,
          internalDate: 1_767_000_000_000 - i * 1000,
        }),
      ],
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fullFetches = () =>
      requestedPaths().filter((p) => p.endsWith("format=full")).length;

    // Pass 1: cap 4 of 10.
    installFakeGmail({ profileHistoryId: "h-new", labels: [], threads, history: { status: 404 } });
    const r1 = await syncEmailAccount(accountId, { catchUpMaxThreads: 4 });
    expect(r1).toMatchObject({ ok: true, mode: "full", threadsSynced: 4 });
    let account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.historyId).toBe("h-stale"); // NOT advanced: gap still open
    expect(account.lastSyncAt?.getTime()).toBe(lastSyncAt.getTime());
    expect(account.syncError).toContain("safety cap");
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(4);

    // Pass 2: the 4 local threads are current → minimal check only.
    mockedFetch.mockClear();
    installFakeGmail({ profileHistoryId: "h-new", labels: [], threads, history: { status: 404 } });
    const r2 = await syncEmailAccount(accountId, { catchUpMaxThreads: 4 });
    expect(r2.threadsSynced).toBe(4);
    expect(fullFetches()).toBe(4); // only the 4 NEW ones got a full fetch
    expect(requestedPaths().filter((p) => p.endsWith("format=minimal")).length).toBeGreaterThanOrEqual(4);
    account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.historyId).toBe("h-stale");
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(8);

    // Pass 3: the last 2 fit under the cap → gap closed, cursor advances.
    installFakeGmail({ profileHistoryId: "h-new", labels: [], threads, history: { status: 404 } });
    const r3 = await syncEmailAccount(accountId, { catchUpMaxThreads: 4 });
    expect(r3.threadsSynced).toBe(2);
    account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.historyId).toBe("h-new");
    expect(account.syncError).toBeNull();
    expect(account.lastSyncAt!.getTime()).toBeGreaterThan(lastSyncAt.getTime());
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(10);
    warnSpy.mockRestore();
  }, 30_000);

  it("a catch-up thread whose local copy is stale (new message) is refetched in full", async () => {
    const lastSyncAt = new Date("2026-03-01T12:00:00Z");
    const accountId = await seedAccount({ historyId: "h-stale", lastSyncAt });
    const threads: GmailThread[] = [
      {
        id: "t0",
        messages: [
          gmailMsg({ id: "m0", threadId: "t0", text: "a", internalDate: 1_767_000_000_000 }),
        ],
      },
    ];
    installFakeGmail({ profileHistoryId: "h-new", labels: [], threads, history: { status: 404 } });
    await syncEmailAccount(accountId);
    // A reply lands at Gmail.
    threads[0].messages!.push(
      gmailMsg({ id: "m0b", threadId: "t0", text: "b", internalDate: 1_767_000_900_000 })
    );
    installFakeGmail({ profileHistoryId: "h-new2", labels: [], threads, history: { status: 404 } });
    // Cursor was advanced to h-new by pass 1; force the expired path again.
    await prisma.emailAccount.update({ where: { id: accountId }, data: { historyId: "h-stale" } });
    await syncEmailAccount(accountId);
    expect(
      await prisma.emailMessage.count({ where: { thread: { accountId } } })
    ).toBe(2);
  });
});

describe("backfill anchor protection (F259)", () => {
  it("incremental sync does not import an UNKNOWN thread older than the oldest local thread, but still refreshes known/newer ones", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    const frontier = new Date(1_766_000_000_000);
    // Known old-ish thread = the current frontier.
    await prisma.emailThread.create({
      data: {
        accountId,
        externalId: "t-known",
        subject: "known",
        lastMessageAt: frontier,
      },
    });
    const ancient: GmailThread = {
      id: "t-2019",
      messages: [
        gmailMsg({
          id: "ma",
          threadId: "t-2019",
          text: "old",
          internalDate: 1_550_000_000_000,
        }),
      ],
    };
    const known: GmailThread = {
      id: "t-known",
      messages: [
        gmailMsg({
          id: "mk",
          threadId: "t-known",
          text: "k",
          internalDate: frontier.getTime(),
        }),
      ],
    };
    const fresh: GmailThread = {
      id: "t-new",
      messages: [
        gmailMsg({
          id: "mn",
          threadId: "t-new",
          text: "n",
          internalDate: 1_767_000_000_000,
        }),
      ],
    };
    installFakeGmail({
      labels: [],
      threads: [ancient, known, fresh],
      history: {
        historyId: "h200",
        records: [
          { labelsRemoved: [{ message: { id: "ma", threadId: "t-2019" } }] },
          { labelsRemoved: [{ message: { id: "mk", threadId: "t-known" } }] },
          { messagesAdded: [{ message: { id: "mn", threadId: "t-new" } }] },
        ],
      },
    });

    const result = await syncEmailAccount(accountId);
    expect(result.threadsSynced).toBe(2);
    const ids = (
      await prisma.emailThread.findMany({ where: { accountId } })
    ).map((t) => t.externalId);
    expect(ids.sort()).toEqual(["t-known", "t-new"]);

    // The backfill anchor did not move.
    const oldest = await prisma.emailThread.findFirstOrThrow({
      where: { accountId },
      orderBy: { lastMessageAt: "asc" },
    });
    expect(oldest.lastMessageAt.getTime()).toBe(frontier.getTime());
  });
});

describe("SPAM / TRASH threads (F258)", () => {
  const history = (threadId: string, id = "mj") => ({
    historyId: "h200",
    records: [{ messagesAdded: [{ message: { id, threadId } }] }],
  });

  it("incremental sync does NOT import a thread whose every message is SPAM", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    installFakeGmail({
      labels: [],
      threads: [
        {
          id: "t-spam",
          messages: [
            gmailMsg({
              id: "mj",
              threadId: "t-spam",
              labelIds: ["SPAM", "UNREAD"],
              subject: "You won!",
              text: "click here",
            }),
          ],
        },
      ],
      history: history("t-spam"),
    });

    const result = await syncEmailAccount(accountId);
    expect(result.ok).toBe(true);
    expect(result.threadsSynced).toBe(0);
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(0);
    expect(await prisma.emailMessage.count()).toBe(0);
    // The cursor still advances — the junk is deliberately ignored.
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.historyId).toBe("h200");
  });

  it("does not import a TRASHed thread, and a later restore imports it normally", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    const trashed: GmailThread = {
      id: "t-trash",
      messages: [
        gmailMsg({
          id: "mt",
          threadId: "t-trash",
          labelIds: ["TRASH"],
          text: "deleted by user",
        }),
      ],
    };
    installFakeGmail({
      labels: [],
      threads: [trashed],
      history: history("t-trash", "mt"),
    });
    await syncEmailAccount(accountId);
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(0);

    // Restore: Gmail now reports the thread back in INBOX.
    const restored: GmailThread = {
      id: "t-trash",
      messages: [
        gmailMsg({
          id: "mt",
          threadId: "t-trash",
          labelIds: ["INBOX", "UNREAD"],
          text: "deleted by user",
        }),
      ],
    };
    installFakeGmail({
      labels: [],
      threads: [restored],
      history: {
        historyId: "h300",
        records: [
          { labelsAdded: [{ message: { id: "mt", threadId: "t-trash" } }] },
        ],
      },
    });
    const result = await syncEmailAccount(accountId);
    expect(result.threadsSynced).toBe(1);
    const row = await prisma.emailThread.findFirstOrThrow({
      where: { accountId, externalId: "t-trash" },
    });
    expect(row.isRead).toBe(false);
    expect(row.isArchived).toBe(false);
  });

  it("keeps an already-local thread that turned to junk, forcing read + archived so it cannot inflate unread counts", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    await prisma.emailThread.create({
      data: {
        accountId,
        externalId: "t-was-ok",
        subject: "was ok",
        lastMessageAt: new Date(1_767_000_000_000),
        isRead: false,
        isArchived: false,
      },
    });
    installFakeGmail({
      labels: [],
      threads: [
        {
          id: "t-was-ok",
          messages: [
            gmailMsg({
              id: "mw",
              threadId: "t-was-ok",
              labelIds: ["SPAM", "UNREAD", "INBOX"],
              text: "reported as spam",
            }),
          ],
        },
      ],
      history: history("t-was-ok", "mw"),
    });

    await syncEmailAccount(accountId);
    const row = await prisma.emailThread.findFirstOrThrow({
      where: { accountId, externalId: "t-was-ok" },
    });
    expect(row.isRead).toBe(true);
    expect(row.isArchived).toBe(true);
  });

  it("a trashed reply does not keep a thread unread when the live messages are read", async () => {
    const accountId = await seedAccount({ historyId: "h100" });
    installFakeGmail({
      labels: [],
      threads: [
        {
          id: "t-mixed",
          messages: [
            gmailMsg({
              id: "m1",
              threadId: "t-mixed",
              labelIds: ["INBOX"],
              text: "read",
              internalDate: 1_767_000_000_000,
            }),
            gmailMsg({
              id: "m2",
              threadId: "t-mixed",
              labelIds: ["TRASH", "UNREAD"],
              text: "junk reply",
              internalDate: 1_767_000_100_000,
            }),
          ],
        },
      ],
      history: history("t-mixed", "m1"),
    });
    await syncEmailAccount(accountId);
    const row = await prisma.emailThread.findFirstOrThrow({
      where: { accountId, externalId: "t-mixed" },
    });
    expect(row.isRead).toBe(true);
    expect(row.isArchived).toBe(false);
    expect(row.messageCount).toBe(2);
  });
});

describe("non-UTF-8 bodies (F256)", () => {
  it("stores a windows-1252 text/plain body decoded, not as replacement characters", async () => {
    const accountId = await seedAccount();
    const msg = gmailMsg({ id: "m-cp", threadId: "t-cp", text: "x" });
    msg.payload = {
      mimeType: "text/plain",
      headers: [
        ...(msg.payload?.headers ?? []),
        { name: "Content-Type", value: "text/plain; charset=windows-1252" },
      ],
      // "café § " — 0xE9 é, 0xA7 §
      body: {
        data: Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0xa7]).toString(
          "base64url"
        ),
      },
    };
    installFakeGmail({
      labels: [],
      threads: [{ id: "t-cp", messages: [msg] }],
    });
    await syncEmailAccount(accountId);
    const stored = await prisma.emailMessage.findFirstOrThrow({
      where: { externalId: "m-cp" },
    });
    expect(stored.body).toContain("café §");
    expect(stored.body).not.toContain("\ufffd");
  });
});

describe("per-account sync claim (F696/F728)", () => {
  function healthy(): void {
    installFakeGmail({ labels: [], threads: [], profileHistoryId: "h-ok" });
  }

  it("skips an account another pass is already syncing (fresh claim) — no Google traffic, status untouched", async () => {
    const accountId = await seedAccount({ syncStatus: "syncing" });
    healthy();

    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({ ok: true, mode: "skipped", threadsSynced: 0 });
    expect(mockedFetch).not.toHaveBeenCalled();
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("syncing");
  });

  it("takes over a STALE claim (crashed run) and finishes connected", async () => {
    const accountId = await seedAccount({ syncStatus: "syncing" });
    // Age the claim past the stale window.
    await prisma.$executeRaw`UPDATE email_accounts SET "updatedAt" = now() - interval '30 minutes' WHERE id = ${accountId}`;
    healthy();

    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({ ok: true, mode: "full" });
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("connected");
    expect(row.historyId).toBe("h-ok");
  });

  it("two overlapping syncs of one account: exactly one runs", async () => {
    const accountId = await seedAccount();
    healthy();
    const [a, b] = await Promise.all([
      syncEmailAccount(accountId),
      syncEmailAccount(accountId),
    ]);
    expect([a.mode, b.mode].sort()).toEqual(["full", "skipped"]);
  });
});

describe("disconnect is never relabelled or resurrected (review of F691/F696)", () => {
  async function seedDisconnected(): Promise<string> {
    const account = await prisma.emailAccount.create({
      data: {
        userId,
        emailAddress: "gone@gmail.com",
        refreshToken: null,
        accessToken: null,
        syncStatus: "disconnected",
        syncError: null,
      },
      select: { id: true },
    });
    return account.id;
  }

  it("backfillEmailAccount on a disconnected, token-less account (auth error) keeps 'disconnected' and a null syncError", async () => {
    const accountId = await seedDisconnected();
    await prisma.emailThread.create({
      data: {
        accountId,
        externalId: "t-anchor",
        subject: "Oldest local",
        lastMessageAt: new Date(1_767_000_000_500),
      },
    });
    mockedFetch.mockRejectedValue(
      new GmailAuthError("Google authorization revoked.", accountId)
    );

    const result = await backfillEmailAccount(accountId);
    expect(result.ok).toBe(false);
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("disconnected");
    expect(row.syncError).toBeNull();
  });

  it("syncEmailAccount on a token-less account is skipped without Google traffic or a status change", async () => {
    const accountId = await seedDisconnected();
    const result = await syncEmailAccount(accountId);
    expect(result).toMatchObject({ ok: false, mode: "skipped" });
    expect(mockedFetch).not.toHaveBeenCalled();
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("disconnected");
  });

  it("a disconnect landing mid-pass is not overwritten by the auth-error path or the success write", async () => {
    // Auth failure mid-pass after the user disconnects.
    const a = await seedAccount();
    mockedFetch.mockImplementation(async (accountId) => {
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { refreshToken: null, syncStatus: "disconnected" },
      });
      throw new GmailAuthError("Google authorization revoked.", accountId);
    });
    await syncEmailAccount(a);
    let row = await prisma.emailAccount.findUniqueOrThrow({ where: { id: a } });
    expect(row.syncStatus).toBe("disconnected");
    expect(row.syncError).toBeNull();

    // Success path after the user disconnects.
    const b = await seedAccount({ email: "b@gmail.com" });
    installFakeGmail({ labels: [], threads: [], profileHistoryId: "h-ok" });
    const base = mockedFetch.getMockImplementation()!;
    mockedFetch.mockImplementation(async (accountId, ...rest) => {
      if (accountId === b) {
        await prisma.emailAccount.update({
          where: { id: b },
          data: { refreshToken: null, syncStatus: "disconnected" },
        });
      }
      return base(accountId, ...rest);
    });
    await syncEmailAccount(b);
    row = await prisma.emailAccount.findUniqueOrThrow({ where: { id: b } });
    expect(row.syncStatus).toBe("disconnected");
    expect(row.refreshToken).toBeNull();
  });
});

describe("message insert race (F696/F728)", () => {
  it("a message created between the existence lookup and the insert converges via update instead of failing with P2002", async () => {
    const accountId = await seedAccount();
    const thread = basicThread();
    installFakeGmail({ labels: LABELS, threads: [thread] });
    await syncEmailAccount(accountId);
    const before = await prisma.emailMessage.count();
    expect(before).toBe(2);

    // Simulate the concurrent winner: the lookup reports nothing even
    // though the rows exist, so the engine goes down the create path.
    const spy = vi
      .spyOn(prisma.emailMessage, "findMany")
      .mockResolvedValueOnce([]);
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: { historyId: null },
    });
    const result = await syncEmailAccount(accountId);
    // The lookup really was intercepted (the create path really ran).
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    // Without the P2002 fallback the thread import would throw, be
    // skipped as "poisoned", and leave a syncError note + failed count.
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncError).toBeNull();
    expect(result.threadsSynced).toBe(1);
    expect(await prisma.emailMessage.count()).toBe(2);
  });
});

describe("cron sweep ordering (F692)", () => {
  it("syncs never-synced and least-recently-synced accounts first so a heavy mailbox cannot starve the rest", async () => {
    const { firmId } = await seedFirm();
    const { userId: u2 } = await seedUser({ firmId, email: "u2@kosloskilaw.com" });
    const { userId: u3 } = await seedUser({ firmId, email: "u3@kosloskilaw.com" });
    const recent = await seedAccount({
      email: "recent@gmail.com",
      lastSyncAt: new Date(Date.now() - 60_000),
    });
    const never = await seedAccount({ ownerId: u2, email: "never@gmail.com" });
    const old = await seedAccount({
      ownerId: u3,
      email: "old@gmail.com",
      lastSyncAt: new Date(Date.now() - 86_400_000),
    });
    installFakeGmail({ labels: [], threads: [] });

    const results = await syncAllEmailAccounts();
    expect(results.map((r) => r.accountId)).toEqual([never, old, recent]);
  });
});
