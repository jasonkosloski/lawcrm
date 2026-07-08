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
  FULL_SYNC_MAX_AGE_DAYS,
  FULL_SYNC_MAX_THREADS,
  GmailSyncError,
  maybeKickEmailSync,
  resetEmailSyncKickThrottleForTests,
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
