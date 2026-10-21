/**
 * Integration tests for the Gmail send/reply actions — real DB,
 * mocked Gmail wire (`gmailFetch` stubbed; everything from the
 * request body out is asserted, everything from the response in is
 * simulated).
 *
 * Covers: permission gate wiring, ownership scoping (another user's
 * account/thread never resolves), recipient validation, MIME payload
 * shape on the wire (decoded from the raw field), OUTBOUND HTML
 * SANITIZATION (hostile bodyHtml never reaches the wire or the
 * local row — Email v1.1), local upsert unique-key convergence with
 * the sync engine's row shape, reply recipient derivation (reply vs
 * reply-all vs overrides), draft-preserving failure paths
 * (auth / transient / HTTP).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { GmailAuthError } from "@/lib/google/gmail-client";
import { GoogleOAuthError } from "@/lib/google/oauth";
import type { RecordScope } from "@/lib/record-scope";
import { REPLY_NEEDS_FILER_ERROR } from "@/lib/email-send-status";
import { replyToThread, sendEmail } from "./email-send";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Matter-wall asserts are covered in matter-access-writes.test.ts; this
// file exercises other behaviour with no authenticated session user.
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "test-user"),
  assertOptionalMatterAccess: vi.fn(async () => "test-user"),
  assertChildMatterAccess: vi.fn(async () => null),
  canAccessMatter: vi.fn(async () => true),
}));

// Lead walls use the real assertLeadAccess against this session user.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

// Keep the real error classes (instanceof in the action must match);
// stub only the network call.
vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...actual, gmailFetch: vi.fn() };
});

import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { canAccessMatter } from "@/lib/matter-access";
import { gmailFetch } from "@/lib/google/gmail-client";

const mockedRequirePermission = vi.mocked(requirePermission);
const mockedGmailFetch = vi.mocked(gmailFetch);

// ── Fixtures (local — email seeders aren't in integration-helpers) ──────

async function seedEmailAccount(opts: {
  userId: string;
  emailAddress?: string;
  syncStatus?: string;
}): Promise<{ accountId: string; emailAddress: string }> {
  const emailAddress = opts.emailAddress ?? "me@firm.com";
  const account = await prisma.emailAccount.create({
    data: {
      userId: opts.userId,
      emailAddress,
      syncStatus: opts.syncStatus ?? "connected",
    },
    select: { id: true },
  });
  return { accountId: account.id, emailAddress };
}

async function seedThread(opts: {
  accountId: string;
  subject?: string;
  externalId?: string | null;
  matterId?: string | null;
  leadId?: string | null;
}): Promise<{ threadId: string }> {
  const t = await prisma.emailThread.create({
    data: {
      accountId: opts.accountId,
      subject: opts.subject ?? "Case update",
      externalId: opts.externalId === undefined ? "gt-1" : opts.externalId,
      // Default: filed to seedActor's matter (replies need a record).
      // Pass matterId: null explicitly for an unfiled thread.
      matterId:
        opts.matterId === undefined && opts.leadId == null
          ? BASE_SEND.scope.kind === "matter"
            ? BASE_SEND.scope.matterId
            : null
          : (opts.matterId ?? null),
      leadId: opts.leadId ?? null,
      lastMessageAt: new Date("2026-07-01T10:00:00Z"),
    },
    select: { id: true },
  });
  return { threadId: t.id };
}

async function seedMessage(opts: {
  threadId: string;
  fromEmail: string;
  fromName?: string;
  to: Array<{ name?: string; email: string }>;
  cc?: Array<{ name?: string; email: string }>;
  sentAt?: Date;
  externalId?: string;
}): Promise<void> {
  await prisma.emailMessage.create({
    data: {
      threadId: opts.threadId,
      externalId: opts.externalId ?? `gm-${Math.random().toString(36).slice(2)}`,
      fromName: opts.fromName ?? opts.fromEmail,
      fromEmail: opts.fromEmail,
      toRecipients: JSON.stringify(opts.to),
      ccRecipients: opts.cc ? JSON.stringify(opts.cc) : null,
      body: "body",
      sentAt: opts.sentAt ?? new Date("2026-07-01T10:00:00Z"),
    },
  });
}

/** A Response the way Gmail answers a successful send. */
function gmailOk(id = "sent-msg-1", threadId = "sent-thread-1"): Response {
  return new Response(JSON.stringify({ id, threadId, labelIds: ["SENT"] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Decode what the action actually put on the wire. */
function sentPayload(call = 0): { raw: string; threadId?: string; mime: string } {
  const init = mockedGmailFetch.mock.calls[call][2];
  const body = JSON.parse(init?.body as string) as {
    raw: string;
    threadId?: string;
  };
  return {
    ...body,
    mime: Buffer.from(body.raw, "base64url").toString("utf-8"),
  };
}

/** Decode the text/html part out of the wire MIME (base64, 76-col
 *  wrapped, terminated by the next boundary line). */
function wireHtml(mime: string): string {
  const idx = mime.indexOf("Content-Type: text/html");
  expect(idx).toBeGreaterThan(-1);
  const start = mime.indexOf("\r\n\r\n", idx) + 4;
  const end = mime.indexOf("\r\n--", start);
  const b64 = mime.slice(start, end).replace(/\r\n/g, "");
  return Buffer.from(b64, "base64").toString("utf-8");
}

async function seedActor(): Promise<{ userId: string; firmId: string }> {
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId, name: "Jason Kosloski" });
  mockedRequirePermission.mockResolvedValue(userId);
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  // Every send is filed: a default matter for BASE_SEND.
  const { areaId, stageId } = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  });
  BASE_SEND.scope = { kind: "matter", matterId: m.matterId };
  return { userId, firmId };
}

const BASE_SEND: {
  to: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  scope: RecordScope;
} = {
  to: ["alice@example.com"],
  subject: "Retainer",
  bodyText: "Hi Alice,\n\nSee attached.",
  bodyHtml: "<p>Hi Alice,</p><p>See attached.</p>",
  scope: { kind: "matter", matterId: "unset" },
};

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

// ── sendEmail ────────────────────────────────────────────────────────────

describe("sendEmail — gate + ownership", () => {
  test("gates on communication.send_email", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk());
    await sendEmail(accountId, BASE_SEND);
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "communication.send_email"
    );
  });

  test("another user's accountId does not resolve — no network call", async () => {
    const { firmId } = await seedActor();
    const other = await seedUser({ firmId, email: "other@firm.com" });
    const { accountId } = await seedEmailAccount({ userId: other.userId });
    const result = await sendEmail(accountId, BASE_SEND);
    expect(result).toEqual({ ok: false, error: "Email account not found." });
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("disconnected / errored account refuses with a reconnect hint", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({
      userId,
      syncStatus: "error",
    });
    const result = await sendEmail(accountId, BASE_SEND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reconnect/i);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });
});

describe("sendEmail — record filing", () => {
  test("refuses without scope, a converted lead, or a missing record - before Gmail", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { leadId } = await seedLead();
    await prisma.lead.update({
      where: { id: leadId },
      data: { stage: "converted" },
    });

    const noScope = await sendEmail(accountId, {
      ...BASE_SEND,
      scope: undefined as unknown as RecordScope,
    });
    expect(noScope).toMatchObject({ ok: false });

    const converted = await sendEmail(accountId, {
      ...BASE_SEND,
      scope: { kind: "lead", leadId },
    });
    expect(converted).toMatchObject({ ok: false });

    const noMatter = await sendEmail(accountId, {
      ...BASE_SEND,
      scope: { kind: "matter", matterId: "does-not-exist" },
    });
    expect(noMatter).toMatchObject({ ok: false });
    // A missing lead is a notFound throw (ADR-028), still before Gmail.
    await expect(
      sendEmail(accountId, {
        ...BASE_SEND,
        scope: { kind: "lead", leadId: "does-not-exist" },
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("files the new thread to the lead, marks sentFromApp, logs on the lead", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { leadId } = await seedLead();
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-L", "gt-L"));

    const result = await sendEmail(accountId, {
      ...BASE_SEND,
      scope: { kind: "lead", leadId },
    });
    expect(result.ok).toBe(true);

    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: "gt-L" } },
      include: { messages: true },
    });
    expect(thread.leadId).toBe(leadId);
    expect(thread.matterId).toBeNull();
    expect(thread.messages[0].sentFromApp).toBe(true);
    const log = await prisma.activityLog.findFirst({
      where: { title: "Email sent" },
    });
    expect(log).toMatchObject({ leadId, matterId: null });
  });

  test("a thread Gmail returns that is filed elsewhere keeps its filing and returns a notice", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { areaId, stageId } = await seedPracticeArea();
    const other = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Other Matter",
    });
    const { threadId } = await seedThread({
      accountId,
      externalId: "gt-X",
      matterId: other.matterId,
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-X", "gt-X"));

    const result = await sendEmail(accountId, BASE_SEND);
    expect(result).toMatchObject({
      ok: true,
      threadId,
      notice: "Added to an existing thread filed to Other Matter.",
    });
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.matterId).toBe(other.matterId);
    const msg = await prisma.emailMessage.findFirstOrThrow({
      where: { threadId, externalId: "gm-X" },
    });
    expect(msg.sentFromApp).toBe(true);
  });

  test("the notice does not name a record the sender can no longer see", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { areaId, stageId } = await seedPracticeArea();
    const other = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Walled Matter",
    });
    await seedThread({
      accountId,
      externalId: "gt-W",
      matterId: other.matterId,
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-W", "gt-W"));
    vi.mocked(canAccessMatter).mockResolvedValueOnce(false);

    const result = await sendEmail(accountId, BASE_SEND);
    expect(result).toMatchObject({
      ok: true,
      notice: "Added to an existing thread filed to another matter.",
    });
  });

  test("a thread Gmail returns that is unfiled gets filed to the scope", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId, externalId: "gt-U" });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-U", "gt-U"));

    const result = await sendEmail(accountId, BASE_SEND);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notice).toBeUndefined();
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.matterId).toBe(
      BASE_SEND.scope.kind === "matter" ? BASE_SEND.scope.matterId : null
    );
  });
});

describe("sendEmail — validation", () => {
  test("rejects an invalid recipient before touching the wire", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const result = await sendEmail(accountId, {
      ...BASE_SEND,
      to: ["not-an-email"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid email/i);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("rejects empty recipients and empty body", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    expect((await sendEmail(accountId, { ...BASE_SEND, to: [] })).ok).toBe(
      false
    );
    expect(
      (await sendEmail(accountId, { ...BASE_SEND, bodyText: "   " })).ok
    ).toBe(false);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });
});

describe("sendEmail — wire + local upsert", () => {
  test("POSTs a decodable MIME message from the account's own address", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk());

    await sendEmail(accountId, {
      ...BASE_SEND,
      cc: ["carol@example.com"],
    });

    expect(mockedGmailFetch).toHaveBeenCalledWith(
      accountId,
      "/users/me/messages/send",
      expect.objectContaining({ method: "POST" })
    );
    const { mime, threadId } = sentPayload();
    expect(threadId).toBeUndefined(); // fresh compose — no thread pin
    expect(mime).toContain("From: Jason Kosloski <me@firm.com>");
    expect(mime).toContain("To: alice@example.com");
    expect(mime).toContain("Cc: carol@example.com");
    expect(mime).toContain("Subject: Retainer");
    expect(mime).toContain("Content-Type: multipart/alternative");
    expect(mime).not.toContain("Message-ID:");
  });

  test("upserts thread + message on the sync engine's unique keys", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-9", "gt-9"));

    const result = await sendEmail(accountId, BASE_SEND);
    expect(result.ok).toBe(true);

    const thread = await prisma.emailThread.findUnique({
      where: { accountId_externalId: { accountId, externalId: "gt-9" } },
      include: { messages: true },
    });
    expect(thread).not.toBeNull();
    expect(thread?.subject).toBe("Retainer");
    expect(thread?.isRead).toBe(true); // sender has read their own send
    expect(thread?.messageCount).toBe(1);
    expect(thread?.snippet).toBe("Hi Alice, See attached.");
    expect(thread?.messages).toHaveLength(1);
    const msg = thread?.messages[0];
    expect(msg?.externalId).toBe("gm-9");
    expect(msg?.fromEmail).toBe("me@firm.com");
    expect(JSON.parse(msg?.toRecipients ?? "[]")).toEqual([
      { email: "alice@example.com" },
    ]);
    if (result.ok) expect(result.threadId).toBe(thread?.id);
  });

  test("converges onto a pre-existing (sync-created) thread row instead of duplicating", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId, externalId: "gt-9" });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-9", "gt-9"));

    const result = await sendEmail(accountId, BASE_SEND);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.threadId).toBe(threadId);

    expect(await prisma.emailThread.count()).toBe(1);
    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
    });
    expect(thread?.messageCount).toBe(2); // recomputed from rows
  });

  test("a repeat write of the same Gmail ids is idempotent (unique-compatible)", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-9", "gt-9"));

    await sendEmail(accountId, BASE_SEND);
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-9", "gt-9"));
    await sendEmail(accountId, BASE_SEND);

    expect(await prisma.emailThread.count()).toBe(1);
    expect(await prisma.emailMessage.count()).toBe(1);
  });

  test("activity-logs when the (existing) thread is filed to a matter", async () => {
    const { userId } = await seedActor();
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const { accountId } = await seedEmailAccount({ userId });
    await seedThread({ accountId, externalId: "gt-9", matterId });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-9", "gt-9"));

    await sendEmail(accountId, BASE_SEND);

    const log = await prisma.activityLog.findFirst({
      where: { matterId, type: "email" },
    });
    expect(log?.title).toBe("Email sent");
    expect(log?.detail).toBe("Retainer");
  });
});

describe("sendEmail — outbound HTML sanitization (Email v1.1)", () => {
  test("hostile bodyHtml is sanitized BEFORE the MIME builder — nothing dangerous on the wire", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk());

    await sendEmail(accountId, {
      ...BASE_SEND,
      bodyHtml:
        '<p>Hi</p><script>alert(1)</script>' +
        '<p onclick="steal()">Click <a href="javascript:alert(2)">here</a></p>' +
        '<img src="https://evil.example/pixel.png" onerror="alert(3)">' +
        '<iframe src="https://evil.example"></iframe>' +
        '<p style="position:fixed">styled</p>',
    });

    const html = wireHtml(sentPayload().mime);
    expect(html).toContain("<p>Hi</p>");
    expect(html).toContain("styled"); // text survives, style attr doesn't
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)"); // discard mode drops contents
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("style=");
  });

  test("editor-shaped rich HTML passes through intact and persists as the local body", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-9", "gt-9"));

    const rich =
      "<p>Hi <strong>Alice</strong>,</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>";
    await sendEmail(accountId, { ...BASE_SEND, bodyHtml: rich });

    expect(wireHtml(sentPayload().mime)).toBe(rich);

    // Local copy stores the sanitized wire HTML (email-body.ts
    // contract: HTML bodies are safe-by-construction), snippet
    // stays plain text.
    const msg = await prisma.emailMessage.findFirst();
    expect(msg?.body).toBe(rich);
    const thread = await prisma.emailThread.findFirst();
    expect(thread?.snippet).toBe("Hi Alice, See attached.");
  });

  test("bodyHtml that sanitizes to nothing falls back to paragraphed bodyText", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk());

    await sendEmail(accountId, {
      ...BASE_SEND,
      bodyText: "Hi Alice",
      bodyHtml: "<script>alert(1)</script>",
    });

    expect(wireHtml(sentPayload().mime)).toBe("<p>Hi Alice</p>");
  });
});

describe("sendEmail — failure paths preserve the draft contract", () => {
  test("GmailAuthError → its reconnect message, no local rows", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockRejectedValue(
      new GmailAuthError("Reconnect this mailbox from Settings.", accountId)
    );
    const result = await sendEmail(accountId, BASE_SEND);
    expect(result).toEqual({
      ok: false,
      error: "Reconnect this mailbox from Settings.",
    });
    expect(await prisma.emailThread.count()).toBe(0);
  });

  test("GoogleOAuthError (transient) → retry message", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockRejectedValue(new GoogleOAuthError("boom", null, 503));
    const result = await sendEmail(accountId, BASE_SEND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/try again/i);
  });

  test("non-2xx Gmail response → {ok:false} with the status", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(
      new Response("quota", { status: 429 })
    );
    const result = await sendEmail(accountId, BASE_SEND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/429/);
    expect(await prisma.emailThread.count()).toBe(0);
  });
});

// ── replyToThread ────────────────────────────────────────────────────────

const BASE_REPLY = {
  bodyText: "Thanks — will do.",
  bodyHtml: "<p>Thanks — will do.</p>",
};

describe("replyToThread — gate + ownership", () => {
  test("gates on communication.send_email", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk());
    await replyToThread(threadId, BASE_REPLY);
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "communication.send_email"
    );
  });

  test("another user's thread does not resolve", async () => {
    const { firmId } = await seedActor();
    const other = await seedUser({ firmId, email: "other@firm.com" });
    const { accountId } = await seedEmailAccount({ userId: other.userId });
    const { threadId } = await seedThread({ accountId });
    const result = await replyToThread(threadId, BASE_REPLY);
    expect(result).toEqual({ ok: false, error: "Thread not found." });
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });
});

describe("replyToThread — recipient derivation on the wire", () => {
  /** me@firm.com's thread: inbound from Alice (to me + bob, cc carol),
   *  then my earlier reply. Reply must anchor on Alice's message. */
  async function seedConversation(): Promise<{
    accountId: string;
    threadId: string;
  }> {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({
      accountId,
      subject: "Re: Discovery schedule",
      externalId: "gt-1",
    });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      fromName: "Alice",
      to: [{ email: "me@firm.com" }, { email: "bob@example.com" }],
      cc: [{ email: "carol@example.com" }, { email: "ME@firm.com" }],
      sentAt: new Date("2026-07-01T10:00:00Z"),
    });
    await seedMessage({
      threadId,
      fromEmail: "me@firm.com",
      to: [{ email: "alice@example.com" }],
      sentAt: new Date("2026-07-01T11:00:00Z"),
    });
    return { accountId, threadId };
  }

  test("reply: To = last inbound From only; subject Re: without stacking; threadId pinned", async () => {
    const { threadId } = await seedConversation();
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));

    const result = await replyToThread(threadId, BASE_REPLY);
    expect(result.ok).toBe(true);

    const { mime, threadId: wireThreadId } = sentPayload();
    expect(wireThreadId).toBe("gt-1");
    expect(mime).toContain("To: Alice <alice@example.com>");
    expect(mime).not.toContain("bob@example.com");
    expect(mime).not.toContain("Cc:");
    expect(mime).toContain("Subject: Re: Discovery schedule");
    // Honest headers: no In-Reply-To fabricated without a stored
    // Message-ID — Gmail threads via the payload threadId.
    expect(mime).not.toContain("In-Reply-To:");
    expect(mime).not.toContain("References:");
  });

  test("reply-all: From + To + Cc minus my own address (case-insensitive)", async () => {
    const { threadId } = await seedConversation();
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));

    await replyToThread(threadId, { ...BASE_REPLY, replyAll: true });

    const { mime } = sentPayload();
    const headersBlock = mime.slice(0, mime.indexOf("\r\n\r\n"));
    const unfolded = headersBlock.replace(/\r\n[ \t]/g, " ");
    expect(unfolded).toMatch(
      /^To: Alice <alice@example\.com>, bob@example\.com$/m
    );
    expect(unfolded).toMatch(/^Cc: carol@example\.com$/m);
    // My own address appears in From (of course) but never as a
    // recipient — case-insensitive exclusion covers the "ME@firm.com"
    // spelling seeded in the Cc line.
    const toLine = /^To: (.*)$/m.exec(unfolded)?.[1] ?? "";
    const ccLine = /^Cc: (.*)$/m.exec(unfolded)?.[1] ?? "";
    expect(`${toLine} ${ccLine}`).not.toMatch(/me@firm\.com/i);
  });

  test("recipient overrides (edit mode) replace derivation and are validated", async () => {
    const { threadId } = await seedConversation();
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));

    await replyToThread(threadId, {
      ...BASE_REPLY,
      to: ["dave@example.com"],
      cc: ["erin@example.com"],
      recipientsEdited: true,
    });
    const { mime } = sentPayload();
    expect(mime).toContain("To: dave@example.com");
    expect(mime).toContain("Cc: erin@example.com");
    expect(mime).not.toContain("alice@example.com");

    const bad = await replyToThread(threadId, {
      ...BASE_REPLY,
      to: ["not-valid"],
      recipientsEdited: true,
    });
    expect(bad.ok).toBe(false);
  });

  test("unedited list matching the current derivation sends, keeping display names (F043/F064)", async () => {
    const { threadId } = await seedConversation();
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));

    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      replyAll: true,
      // order + case differ from the derived list on purpose
      to: ["BOB@example.com", "alice@example.com"],
      cc: ["carol@example.com"],
      recipientsEdited: false,
    });
    expect(result.ok).toBe(true);
    const { mime } = sentPayload();
    const unfolded = mime
      .slice(0, mime.indexOf("\r\n\r\n"))
      .replace(/\r\n[ \t]/g, " ");
    expect(unfolded).toMatch(/^To: Alice <alice@example\.com>, bob@example\.com$/m);
    expect(unfolded).toMatch(/^Cc: carol@example\.com$/m);
  });

  test("unedited list is REFUSED when a newer inbound message changed who the reply goes to (F043/F064)", async () => {
    const { threadId } = await seedConversation();
    // The composer rendered "To: Alice"; then a sync stored opposing
    // counsel's newer message on the same thread.
    await seedMessage({
      threadId,
      fromEmail: "opposing@other.com",
      fromName: "Opposing Counsel",
      to: [{ email: "me@firm.com" }],
      sentAt: new Date("2026-07-01T12:00:00Z"),
    });

    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      to: ["alice@example.com"],
      cc: [],
      recipientsEdited: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("recipients_changed");
      expect(result.error).toMatch(/recipients changed/i);
    }
    // Nothing went out and nothing was persisted.
    expect(mockedGmailFetch).not.toHaveBeenCalled();
    expect(await prisma.emailMessage.count({ where: { threadId } })).toBe(3);
  });

  test("a reply-all gaining a Cc between render and send is refused", async () => {
    const { threadId } = await seedConversation();
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
      cc: [{ email: "new-person@other.com" }],
      sentAt: new Date("2026-07-01T12:00:00Z"),
    });
    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      replyAll: true,
      to: ["alice@example.com", "bob@example.com"],
      cc: ["carol@example.com"],
      recipientsEdited: false,
    });
    expect(result.ok).toBe(false);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("an EDITED list is sent as typed even when it differs from the derivation", async () => {
    const { threadId } = await seedConversation();
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));
    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      to: ["dave@example.com"],
      recipientsEdited: true,
    });
    expect(result.ok).toBe(true);
    expect(sentPayload().mime).toContain("To: dave@example.com");
  });

  test("a posted list without the edited flag is treated as unedited (secure default)", async () => {
    const { threadId } = await seedConversation();
    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      to: ["dave@example.com"],
    });
    expect(result.ok).toBe(false);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("implausible posted lists are rejected before the wire", async () => {
    const { threadId } = await seedConversation();
    const tooMany = Array.from({ length: 51 }, (_, i) => `u${i}@example.com`);
    const many = await replyToThread(threadId, {
      ...BASE_REPLY,
      to: tooMany,
      recipientsEdited: true,
    });
    expect(many.ok).toBe(false);
    const bad = await replyToThread(threadId, {
      ...BASE_REPLY,
      to: ["alice@example.com"],
      cc: ["x@y.com\r\nBcc: attacker@evil.com"],
      recipientsEdited: false,
    });
    expect(bad.ok).toBe(false);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("thread with no derivable recipients returns an edit hint", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId });
    // Only message is my own, addressed only to myself.
    await seedMessage({
      threadId,
      fromEmail: "me@firm.com",
      to: [{ email: "me@firm.com" }],
    });
    const result = await replyToThread(threadId, BASE_REPLY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/edit the recipients/i);
  });
});

describe("replyToThread — outbound HTML sanitization (Email v1.1)", () => {
  test("hostile bodyHtml is sanitized on the reply wire too", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));

    await replyToThread(threadId, {
      ...BASE_REPLY,
      bodyHtml:
        '<p>Done.</p><script>alert(1)</script><img src="https://evil.example/p.png">',
    });

    const html = wireHtml(sentPayload().mime);
    expect(html).toContain("<p>Done.</p>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<img");

    // The persisted reply body is the sanitized HTML, not the input.
    const msg = await prisma.emailMessage.findFirst({
      where: { fromEmail: "me@firm.com" },
    });
    expect(msg?.body).toBe("<p>Done.</p>");
  });
});

describe("replyToThread — local persistence", () => {
  test("appends the sent message to the SAME local thread row", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId, externalId: "gt-1" });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));

    const result = await replyToThread(threadId, BASE_REPLY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.threadId).toBe(threadId);

    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      include: { messages: { orderBy: { sentAt: "asc" } } },
    });
    expect(thread?.messages).toHaveLength(2);
    expect(thread?.messageCount).toBe(2);
    expect(thread?.messages[1].fromEmail).toBe("me@firm.com");
    expect(thread?.snippet).toBe("Thanks — will do.");
    expect(await prisma.emailThread.count()).toBe(1);
  });

  test("links a local thread with no externalId to Gmail's threadId", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId, externalId: null });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-fresh"));

    // No externalId → the send payload must NOT pin a threadId.
    await replyToThread(threadId, BASE_REPLY);
    expect(sentPayload().threadId).toBeUndefined();

    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
    });
    expect(thread?.externalId).toBe("gt-fresh"); // linked for sync convergence
    expect(await prisma.emailThread.count()).toBe(1);
  });

  test("filed reply activity-logs against the matter", async () => {
    const { userId } = await seedActor();
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({
      accountId,
      matterId,
      subject: "Depo prep",
      externalId: "gt-1",
    });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    // Gmail echoes the pinned threadId back on a reply.
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));

    await replyToThread(threadId, BASE_REPLY);

    const log = await prisma.activityLog.findFirst({ where: { matterId } });
    expect(log?.title).toBe("Email reply sent");
    expect(log?.detail).toBe("Re: Depo prep");
  });

  test("GmailAuthError on reply preserves the thread untouched", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockRejectedValue(
      new GmailAuthError("Reconnect.", accountId)
    );
    const result = await replyToThread(threadId, BASE_REPLY);
    expect(result.ok).toBe(false);
    expect(await prisma.emailMessage.count()).toBe(1); // nothing appended
  });
});

describe("replyToThread — file on reply", () => {
  async function unfiled() {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({
      accountId,
      matterId: null,
      externalId: "gt-1",
    });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    return { userId, accountId, threadId };
  }

  test("unfiled thread + scope files then sends", async () => {
    const { threadId } = await unfiled();
    const { leadId } = await seedLead();
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));
    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      scope: { kind: "lead", leadId },
    });
    expect(result.ok).toBe(true);
    const thread = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
      include: { messages: { orderBy: { sentAt: "asc" } } },
    });
    expect(thread.leadId).toBe(leadId);
    expect(thread.messages[1].sentFromApp).toBe(true);
    expect(mockedGmailFetch).toHaveBeenCalledTimes(1);
  });

  test("unfiled thread without scope is refused before Gmail", async () => {
    const { threadId } = await unfiled();
    const result = await replyToThread(threadId, BASE_REPLY);
    expect(result).toMatchObject({ ok: false });
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("unfiled thread without communication.file_email is refused", async () => {
    const { threadId } = await unfiled();
    const { leadId } = await seedLead();
    vi.mocked(currentUserHasPermission).mockResolvedValueOnce(false);
    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      scope: { kind: "lead", leadId },
    });
    expect(result).toEqual({ ok: false, error: REPLY_NEEDS_FILER_ERROR });
    expect(mockedGmailFetch).not.toHaveBeenCalled();
    const t = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(t.leadId).toBeNull();
  });

  test("filing succeeds, Gmail fails: thread stays filed", async () => {
    const { accountId, threadId } = await unfiled();
    const { leadId } = await seedLead();
    mockedGmailFetch.mockRejectedValue(
      new GmailAuthError("Reconnect.", accountId)
    );
    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      scope: { kind: "lead", leadId },
    });
    expect(result.ok).toBe(false);
    const t = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(t.leadId).toBe(leadId);
  });

  test("filed by another tab between read and file: reply lands on that record", async () => {
    const { userId, threadId } = await unfiled();
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const { leadId } = await seedLead();
    const real = prisma.emailThread.findFirst.bind(prisma.emailThread);
    // The reply's own read sees the thread unfiled; the filing re-read
    // happens after another tab filed it to the matter.
    const spy = vi
      .spyOn(prisma.emailThread, "findFirst")
      .mockImplementationOnce((async (args: never) => {
        const stale = await real(args);
        await prisma.emailThread.update({
          where: { id: threadId },
          data: { matterId },
        });
        return stale;
      }) as never);
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));
    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      scope: { kind: "lead", leadId },
    });
    spy.mockRestore();
    expect(result.ok).toBe(true);
    const t = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(t).toMatchObject({ matterId, leadId: null });
    const removed = await prisma.activityLog.count({
      where: { title: { startsWith: "Email removed" } },
    });
    expect(removed).toBe(0);
  });

  test("a filed thread ignores a posted scope", async () => {
    const { userId } = await seedActor();
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const { leadId } = await seedLead();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId, matterId });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));
    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      scope: { kind: "lead", leadId },
    });
    expect(result.ok).toBe(true);
    const t = await prisma.emailThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(t).toMatchObject({ matterId, leadId: null });
  });

  test("reply activity logs on a lead-filed thread's lead", async () => {
    const { userId, accountId } = await unfiled();
    const { leadId } = await seedLead();
    const { threadId } = await seedThread({
      accountId,
      leadId,
      externalId: "gt-9",
    });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-3", "gt-9"));
    const result = await replyToThread(threadId, BASE_REPLY);
    expect(result.ok).toBe(true);
    const log = await prisma.activityLog.findFirst({
      where: { title: "Email reply sent" },
    });
    expect(log).toMatchObject({ leadId, matterId: null });
    expect(userId).toBeTruthy();
  });
});

// ── Hardening (F248 / F276 / F702) ───────────────────────────────────────

describe("send — a post-send persistence failure is NOT a failure (F276)", () => {
  test("sendEmail: Gmail accepted, local save throws -> ok:true with a warning, never ok:false", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-9", "gt-9"));
    const spy = vi
      .spyOn(prisma.emailMessage, "upsert")
      .mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendEmail(accountId, BASE_SEND);

    spy.mockRestore();
    errSpy.mockRestore();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.threadId).toBe("gt-9");
      expect(result.warning).toMatch(/could not be saved/i);
    }
    expect(mockedGmailFetch).toHaveBeenCalledTimes(1);
  });

  test("replyToThread: Gmail accepted, local save throws -> ok:true with the local thread id", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-9", "gt-1"));
    const spy = vi
      .spyOn(prisma.emailMessage, "upsert")
      .mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await replyToThread(threadId, BASE_REPLY);

    spy.mockRestore();
    errSpy.mockRestore();
    expect(result).toMatchObject({ ok: true, threadId });
    if (result.ok) expect(result.warning).toBeTruthy();
  });
});

describe("reply — malformed stored recipients never throw (F248)", () => {
  test("group-syntax / dotless stored addresses are dropped, the valid one still gets the reply", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId });
    await seedMessage({
      threadId,
      fromEmail: "alice@example.com",
      to: [{ email: "me@firm.com" }, { email: "Team: a@b.com" }],
      cc: [{ email: "ops@localhost" }, { email: "carol@example.com" }],
    });
    mockedGmailFetch.mockResolvedValue(gmailOk("gm-2", "gt-1"));

    const result = await replyToThread(threadId, {
      ...BASE_REPLY,
      replyAll: true,
    });

    expect(result.ok).toBe(true);
    const { mime } = sentPayload();
    expect(mime).toContain("alice@example.com");
    expect(mime).toContain("carol@example.com");
    expect(mime).not.toContain("localhost");
    expect(mime).not.toContain("Team:");
  });

  test("a thread whose only recipient is malformed returns the edit hint instead of throwing", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const { threadId } = await seedThread({ accountId });
    await seedMessage({
      threadId,
      fromEmail: "Team: a@b.com",
      to: [{ email: "me@firm.com" }],
    });
    const result = await replyToThread(threadId, BASE_REPLY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/edit the recipients/i);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });
});

describe("send — size and address hardening (F702)", () => {
  test("rejects control characters and quotes in addresses", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    for (const bad of ["a\u0000b@example.com", 'a"b@example.com']) {
      const r = await sendEmail(accountId, { ...BASE_SEND, to: [bad] });
      expect(r.ok).toBe(false);
    }
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("rejects an over-long address, subject, body and recipient flood", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    const longAddr = `${"a".repeat(250)}@example.com`;
    expect(
      (await sendEmail(accountId, { ...BASE_SEND, to: [longAddr] })).ok
    ).toBe(false);
    expect(
      (await sendEmail(accountId, { ...BASE_SEND, subject: "s".repeat(999) }))
        .ok
    ).toBe(false);
    expect(
      (
        await sendEmail(accountId, {
          ...BASE_SEND,
          bodyText: "x".repeat(1_000_001),
        })
      ).ok
    ).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => `u${i}@example.com`);
    expect((await sendEmail(accountId, { ...BASE_SEND, to: many })).ok).toBe(
      false
    );
    // 50 To + 51 Cc: Cc alone is over the per-field cap.
    const fifty = many.slice(0, 50);
    const cc = fifty.map((a) => `cc-${a}`);
    const combined = await sendEmail(accountId, {
      ...BASE_SEND,
      to: fifty,
      cc: [...cc, "extra@example.com"],
    });
    expect(combined.ok).toBe(false);
    expect(mockedGmailFetch).not.toHaveBeenCalled();
  });

  test("plus-tagged addresses stay valid", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk());
    const r = await sendEmail(accountId, {
      ...BASE_SEND,
      to: ["alice+case@example.com"],
    });
    expect(r.ok).toBe(true);
  });
});
