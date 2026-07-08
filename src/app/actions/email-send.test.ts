/**
 * Integration tests for the Gmail send/reply actions — real DB,
 * mocked Gmail wire (`gmailFetch` stubbed; everything from the
 * request body out is asserted, everything from the response in is
 * simulated).
 *
 * Covers: permission gate wiring, ownership scoping (another user's
 * account/thread never resolves), recipient validation, MIME payload
 * shape on the wire (decoded from the raw field), local upsert
 * unique-key convergence with the sync engine's row shape, reply
 * recipient derivation (reply vs reply-all vs overrides),
 * draft-preserving failure paths (auth / transient / HTTP).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { GmailAuthError } from "@/lib/google/gmail-client";
import { GoogleOAuthError } from "@/lib/google/oauth";
import { replyToThread, sendEmail } from "./email-send";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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

import { requirePermission } from "@/lib/permission-check";
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
}): Promise<{ threadId: string }> {
  const t = await prisma.emailThread.create({
    data: {
      accountId: opts.accountId,
      subject: opts.subject ?? "Case update",
      externalId: opts.externalId === undefined ? "gt-1" : opts.externalId,
      matterId: opts.matterId ?? null,
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

async function seedActor(): Promise<{ userId: string; firmId: string }> {
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId, name: "Jason Kosloski" });
  mockedRequirePermission.mockResolvedValue(userId);
  return { userId, firmId };
}

const BASE_SEND = {
  to: ["alice@example.com"],
  subject: "Retainer",
  bodyText: "Hi Alice,\n\nSee attached.",
  bodyHtml: "<p>Hi Alice,</p><p>See attached.</p>",
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

  test("no activity log for an unfiled send", async () => {
    const { userId } = await seedActor();
    const { accountId } = await seedEmailAccount({ userId });
    mockedGmailFetch.mockResolvedValue(gmailOk());
    await sendEmail(accountId, BASE_SEND);
    expect(await prisma.activityLog.count()).toBe(0);
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
    });
    const { mime } = sentPayload();
    expect(mime).toContain("To: dave@example.com");
    expect(mime).toContain("Cc: erin@example.com");
    expect(mime).not.toContain("alice@example.com");

    const bad = await replyToThread(threadId, {
      ...BASE_REPLY,
      to: ["not-valid"],
    });
    expect(bad.ok).toBe(false);
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
