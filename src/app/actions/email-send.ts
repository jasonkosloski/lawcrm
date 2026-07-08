/**
 * Gmail send / reply actions (integration phase 3).
 *
 * Both actions gate on `communication.send_email` and send FROM THE
 * CURRENT USER'S OWN connected EmailAccount — an accountId (or
 * thread) belonging to another user never resolves (`userId` scoping
 * in the lookup), so there's nothing to enumerate.
 *
 * Failure contract: `{ ok: false, error }` — the composer keeps the
 * user's draft on every failure path; nothing here throws for
 * expected failures. `GmailAuthError` surfaces its own
 * user-presentable "reconnect from Settings → Integrations" message.
 *
 * Outbound HTML boundary (Email v1.1): the composers send the rich
 * editor's raw HTML; it is SANITIZED HERE, server-side, before it
 * reaches the MIME builder — never trust the client. The profile is
 * `sanitizeUserHtml` (note profile): it's the exact allowlist for
 * our own Tiptap editor's output and stricter than the email
 * profile, which exists for hostile INBOUND mail and additionally
 * tolerates div-soup/inline styles/data-images a hostile client
 * could otherwise smuggle into mail wearing our From header. If
 * sanitizing leaves nothing, the text/plain body is upgraded via
 * `plainTextToHtml` (also sanitizer-shaped by construction).
 *
 * Local persistence after a successful send: the Gmail response
 * carries `{ id, threadId }`; we upsert the sent message + its
 * thread against the SAME unique keys the sync engine converges on
 * — `EmailThread @@unique([accountId, externalId])` and
 * `EmailMessage @@unique([threadId, externalId])` — so a later sync
 * pass lands on these rows instead of duplicating them. The upsert
 * is deliberately self-contained (no import from gmail-sync.ts,
 * which is being built in parallel).
 *
 * Reply-threading honesty: `EmailMessage` does not store the RFC
 * Message-ID / References headers, so `In-Reply-To` is NOT set on
 * replies today. Instead the send payload carries Gmail's own
 * `threadId` (plus a "Re: …" subject), which Gmail uses to thread
 * server-side. When the sync engine starts persisting Message-ID
 * headers, replies should set In-Reply-To/References from the last
 * message and this note dies.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { requirePermission } from "@/lib/permission-check";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import { GoogleOAuthError } from "@/lib/google/oauth";
import {
  buildMimeMessage,
  buildReplySubject,
  deriveReplyRecipients,
  encodeMimeForGmail,
  isValidEmailAddress,
  plainTextToHtml,
  type MimeAddress,
} from "@/lib/google/mime";

export type SendEmailInput = {
  /** Bare, pre-validated addresses (the composer parses its
   *  comma-separated inputs via `parseAddressList`). Re-validated
   *  here — never trust the client. */
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
};

export type ReplyToThreadInput = {
  bodyHtml: string;
  bodyText: string;
  replyAll?: boolean;
  /** Recipient overrides from the reply composer's edit mode. When
   *  omitted, recipients derive server-side from the thread's last
   *  inbound message. */
  to?: string[];
  cc?: string[];
};

export type SendEmailResult =
  | { ok: true; threadId: string }
  | { ok: false; error: string };

/** Account states we'll send from. "error"/"disconnected" mean the
 *  grant is gone — the user must reconnect first. */
const SENDABLE_STATUSES = new Set(["connected", "syncing"]);

const NOT_CONNECTED_ERROR =
  "This mailbox isn't connected. Reconnect it from Settings → Integrations.";
const TRANSIENT_GOOGLE_ERROR =
  "Google is temporarily unreachable — your draft is untouched; try again in a moment.";

// ── Actions ──────────────────────────────────────────────────────────────

export async function sendEmail(
  accountId: string,
  input: SendEmailInput
): Promise<SendEmailResult> {
  const userId = await requirePermission("communication.send_email");

  // Ownership check in the WHERE clause: another user's accountId
  // simply doesn't resolve.
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, userId },
    select: {
      id: true,
      emailAddress: true,
      syncStatus: true,
      user: { select: { name: true } },
    },
  });
  if (!account) return { ok: false, error: "Email account not found." };
  if (!SENDABLE_STATUSES.has(account.syncStatus)) {
    return { ok: false, error: NOT_CONNECTED_ERROR };
  }

  const to = validateAddresses(input.to);
  if (!to.ok) return to;
  const cc = validateAddresses(input.cc ?? [], { allowEmpty: true });
  if (!cc.ok) return cc;
  if (to.addresses.length === 0) {
    return { ok: false, error: "Add at least one recipient." };
  }
  if (!input.bodyText.trim()) {
    return { ok: false, error: "The message body is empty." };
  }

  const subject = input.subject.trim();
  const sentAt = new Date();
  // Outbound boundary: strip anything the note profile disallows
  // BEFORE the MIME builder sees it (see module header).
  const bodyHtml =
    sanitizeUserHtml(input.bodyHtml) || plainTextToHtml(input.bodyText);
  const mime = buildMimeMessage({
    from: { name: account.user.name, email: account.emailAddress },
    to: to.addresses,
    cc: cc.addresses,
    subject,
    text: input.bodyText,
    html: bodyHtml,
    date: sentAt,
  });

  const sent = await postGmailSend(account.id, {
    raw: encodeMimeForGmail(mime),
  });
  if (!sent.ok) return sent;

  const persisted = await persistSentMessage({
    accountId: account.id,
    gmailMessageId: sent.id,
    gmailThreadId: sent.threadId,
    subject: subject || "(no subject)",
    fromName: account.user.name,
    fromEmail: account.emailAddress,
    to: to.addresses,
    cc: cc.addresses,
    bodyHtml,
    bodyText: input.bodyText,
    sentAt,
  });

  if (persisted.matterId) {
    await logActivity({
      matterId: persisted.matterId,
      userId,
      type: "email",
      title: "Email sent",
      detail: subject || "(no subject)",
    });
  }
  revalidateSendSurfaces(persisted.matterId);
  return { ok: true, threadId: persisted.threadId };
}

export async function replyToThread(
  threadId: string,
  input: ReplyToThreadInput
): Promise<SendEmailResult> {
  const userId = await requirePermission("communication.send_email");

  // Thread must live on one of the CURRENT USER's accounts — same
  // `account: { userId }` scoping as getThreadById.
  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, account: { userId } },
    select: {
      id: true,
      subject: true,
      externalId: true,
      matterId: true,
      account: {
        select: {
          id: true,
          emailAddress: true,
          syncStatus: true,
          user: { select: { name: true } },
        },
      },
      messages: {
        orderBy: { sentAt: "asc" },
        select: {
          fromName: true,
          fromEmail: true,
          toRecipients: true,
          ccRecipients: true,
        },
      },
    },
  });
  if (!thread) return { ok: false, error: "Thread not found." };
  if (!SENDABLE_STATUSES.has(thread.account.syncStatus)) {
    return { ok: false, error: NOT_CONNECTED_ERROR };
  }
  if (!input.bodyText.trim()) {
    return { ok: false, error: "The reply body is empty." };
  }

  // Recipients: composer overrides when provided (edit mode),
  // otherwise derived from the last inbound message.
  let to: MimeAddress[];
  let cc: MimeAddress[];
  if (input.to && input.to.length > 0) {
    const toV = validateAddresses(input.to);
    if (!toV.ok) return toV;
    const ccV = validateAddresses(input.cc ?? [], { allowEmpty: true });
    if (!ccV.ok) return ccV;
    to = toV.addresses;
    cc = ccV.addresses;
  } else {
    const derived = deriveReplyRecipients(
      thread.messages.map((m) => ({
        fromName: m.fromName,
        fromEmail: m.fromEmail,
        toRecipients: parseStoredRecipients(m.toRecipients),
        ccRecipients: parseStoredRecipients(m.ccRecipients),
      })),
      thread.account.emailAddress,
      input.replyAll ?? false
    );
    to = derived.to;
    cc = derived.cc;
  }
  if (to.length === 0) {
    return {
      ok: false,
      error:
        "Couldn't determine who to reply to — edit the recipients and try again.",
    };
  }

  const subject = buildReplySubject(thread.subject);
  const sentAt = new Date();
  // Same outbound sanitize boundary as sendEmail (module header).
  const bodyHtml =
    sanitizeUserHtml(input.bodyHtml) || plainTextToHtml(input.bodyText);
  const mime = buildMimeMessage({
    from: {
      name: thread.account.user.name,
      email: thread.account.emailAddress,
    },
    to,
    cc,
    subject,
    text: input.bodyText,
    html: bodyHtml,
    date: sentAt,
    // No In-Reply-To/References — Message-ID headers aren't stored
    // locally (see module header). Gmail threads via `threadId`.
  });

  const payload: { raw: string; threadId?: string } = {
    raw: encodeMimeForGmail(mime),
  };
  if (thread.externalId) payload.threadId = thread.externalId;

  const sent = await postGmailSend(thread.account.id, payload);
  if (!sent.ok) return sent;

  const persisted = await persistSentMessage({
    accountId: thread.account.id,
    gmailMessageId: sent.id,
    gmailThreadId: sent.threadId,
    subject,
    fromName: thread.account.user.name,
    fromEmail: thread.account.emailAddress,
    to,
    cc,
    bodyHtml,
    bodyText: input.bodyText,
    sentAt,
    // Prefer appending to the thread the user replied from when
    // Gmail's threadId isn't locally known yet.
    localThreadId: thread.id,
  });

  if (persisted.matterId) {
    await logActivity({
      matterId: persisted.matterId,
      userId,
      type: "email",
      title: "Email reply sent",
      detail: subject,
    });
  }
  revalidateSendSurfaces(persisted.matterId);
  return { ok: true, threadId: persisted.threadId };
}

// ── Internals ────────────────────────────────────────────────────────────

type AddressValidation =
  | { ok: true; addresses: MimeAddress[] }
  | { ok: false; error: string };

function validateAddresses(
  raw: string[],
  opts?: { allowEmpty?: boolean }
): AddressValidation {
  const addresses: MimeAddress[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const email = entry.trim();
    if (!email && opts?.allowEmpty) continue;
    if (!isValidEmailAddress(email)) {
      return { ok: false, error: `Invalid email address: "${entry}".` };
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push({ email });
  }
  return { ok: true, addresses };
}

type GmailSendSuccess = { ok: true; id: string; threadId: string };

/** POST users/me/messages/send via gmailFetch, translating every
 *  expected failure into a draft-preserving `{ ok: false }`. */
async function postGmailSend(
  accountId: string,
  payload: { raw: string; threadId?: string }
): Promise<GmailSendSuccess | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await gmailFetch(accountId, "/users/me/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // User-presentable "reconnect from Settings → Integrations".
      return { ok: false, error: err.message };
    }
    if (err instanceof GoogleOAuthError) {
      return { ok: false, error: TRANSIENT_GOOGLE_ERROR };
    }
    // Network-level failure (fetch TypeError etc.) — still return
    // rather than throw so the composer keeps the draft.
    console.warn("[email-send] send failed", err);
    return { ok: false, error: TRANSIENT_GOOGLE_ERROR };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `Gmail rejected the send (HTTP ${res.status}). Your draft is untouched.`,
    };
  }
  const body = (await res.json()) as { id?: string; threadId?: string };
  if (!body.id || !body.threadId) {
    return { ok: false, error: "Gmail returned an unexpected response." };
  }
  return { ok: true, id: body.id, threadId: body.threadId };
}

/** Stored `toRecipients`/`ccRecipients` JSON → address objects.
 *  (Local copy of the queries-layer parser — that one isn't
 *  exported, and importing the query module here would drag its
 *  whole surface into the action bundle.) */
function parseStoredRecipients(raw: string | null): MimeAddress[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is MimeAddress =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as { email?: unknown }).email === "string"
    );
  } catch {
    return [];
  }
}

function serializeRecipients(list: MimeAddress[]): string {
  return JSON.stringify(
    list.map((a) => (a.name ? { name: a.name, email: a.email } : { email: a.email }))
  );
}

/**
 * Upsert the sent message + its thread so the inbox shows the send
 * immediately, keyed exactly like the sync engine's rows:
 *
 *   1. Thread resolves by (accountId, externalId=Gmail threadId);
 *      when the reply came from a local thread whose externalId is
 *      still null, that row is linked instead of duplicated.
 *   2. Message upserts by (threadId, externalId=Gmail message id) —
 *      a later sync pass hits the same unique and no-ops into it.
 *   3. Thread rollups (messageCount / lastMessageAt / snippet)
 *      recompute from actual rows so repeated writes converge.
 *
 * The stored message body is the SANITIZED HTML that went on the
 * wire — that's the contract `src/lib/email-body.ts` documents
 * (HTML bodies are safe-by-construction for the reader's
 * dangerouslySetInnerHTML path). Snippets stay plain text.
 *
 * Unique-collision races with a concurrently-running sync fall back
 * to a refetch — last writer wins on the rollups, both point at the
 * same row.
 */
async function persistSentMessage(opts: {
  accountId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  to: MimeAddress[];
  cc: MimeAddress[];
  /** Already-sanitized HTML (the wire body) — stored verbatim. */
  bodyHtml: string;
  /** Plain-text body — snippet source only. */
  bodyText: string;
  sentAt: Date;
  localThreadId?: string;
}): Promise<{ threadId: string; matterId: string | null }> {
  const byExternal = {
    accountId_externalId: {
      accountId: opts.accountId,
      externalId: opts.gmailThreadId,
    },
  } as const;
  const threadSelect = { id: true, matterId: true } as const;

  let thread = await prisma.emailThread.findUnique({
    where: byExternal,
    select: threadSelect,
  });

  if (!thread && opts.localThreadId) {
    // Link the local thread the user replied from — but only when
    // it hasn't been linked to a different Gmail thread already
    // (Gmail can fork when it refuses our threadId).
    const local = await prisma.emailThread.findUnique({
      where: { id: opts.localThreadId },
      select: { externalId: true },
    });
    if (local && local.externalId === null) {
      try {
        thread = await prisma.emailThread.update({
          where: { id: opts.localThreadId },
          data: { externalId: opts.gmailThreadId },
          select: threadSelect,
        });
      } catch {
        // Unique collision: sync created the row first — use theirs.
        thread = await prisma.emailThread.findUnique({
          where: byExternal,
          select: threadSelect,
        });
      }
    }
  }

  if (!thread) {
    try {
      thread = await prisma.emailThread.create({
        data: {
          accountId: opts.accountId,
          externalId: opts.gmailThreadId,
          subject: opts.subject,
          snippet: makeSnippet(opts.bodyText),
          isRead: true, // the sender has read their own send
          lastMessageAt: opts.sentAt,
          messageCount: 1,
        },
        select: threadSelect,
      });
    } catch {
      const existing = await prisma.emailThread.findUnique({
        where: byExternal,
        select: threadSelect,
      });
      if (!existing) throw new Error("Failed to persist sent thread");
      thread = existing;
    }
  }

  await prisma.emailMessage.upsert({
    where: {
      threadId_externalId: {
        threadId: thread.id,
        externalId: opts.gmailMessageId,
      },
    },
    create: {
      threadId: thread.id,
      externalId: opts.gmailMessageId,
      fromName: opts.fromName,
      fromEmail: opts.fromEmail,
      toRecipients: serializeRecipients(opts.to),
      ccRecipients: opts.cc.length > 0 ? serializeRecipients(opts.cc) : null,
      body: opts.bodyHtml,
      sentAt: opts.sentAt,
    },
    // Sync may later enrich this row (clean headers, HTML body);
    // never clobber on a repeat of our own write.
    update: {},
  });

  // Converging rollups — computed from rows, not incremented.
  const messageCount = await prisma.emailMessage.count({
    where: { threadId: thread.id },
  });
  await prisma.emailThread.update({
    where: { id: thread.id },
    data: {
      messageCount,
      lastMessageAt: opts.sentAt,
      snippet: makeSnippet(opts.bodyText),
    },
  });

  return { threadId: thread.id, matterId: thread.matterId };
}

function makeSnippet(bodyText: string): string {
  return bodyText.replace(/\s+/g, " ").trim().slice(0, 140);
}

/** Every surface that lists threads / renders the reader — same set
 *  as thread-read's revalidation. */
function revalidateSendSurfaces(matterId: string | null): void {
  revalidatePath("/communication");
  if (matterId) revalidatePath(`/matters/${matterId}/communication`);
  revalidatePath("/intake/[id]/communication", "page");
}
