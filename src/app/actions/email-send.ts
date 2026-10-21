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
import { assertScopeAccess, assertScopeWritable } from "@/lib/scope-access";
import { optionalScopeOf, scopeWhere, type RecordScope } from "@/lib/record-scope";
import { revalidationPathsFor, sameScope } from "@/lib/email-filing";
import { logActivity } from "@/lib/activity-log";
import { requirePermission } from "@/lib/permission-check";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { isSendableStatus } from "@/lib/email-send-status";
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
  /** The matter or lead the sent email is filed to. Required: every
   *  app-sent email is filed. */
  scope: RecordScope;
};

export type ReplyToThreadInput = {
  bodyHtml: string;
  bodyText: string;
  replyAll?: boolean;
  /** The exact recipients the composer showed (or the user typed).
   *  When omitted, recipients derive server-side from the thread's
   *  last inbound message. */
  to?: string[];
  cc?: string[];
  /** True when the user edited the recipients (send them as typed).
   *  Otherwise `to`/`cc` are the render-time defaults and the send is
   *  refused if the thread now derives different recipients. */
  recipientsEdited?: boolean;
};

export type SendEmailResult =
  | {
      ok: true;
      /** Local thread id, or Gmail's thread id when the local copy
       *  could not be written (see `warning`). */
      threadId: string;
      /** Set when Gmail ACCEPTED the message but saving the local copy
       *  failed. The send is final - the composer must clear the draft
       *  and must not offer a resend. */
      warning?: string;
      /** Set when Gmail added the send to an existing thread that is
       *  already filed to a different record (its filing is kept). */
      notice?: string;
    }
  | {
      ok: false;
      error: string;
      /** Machine-readable reason for failures the UI reacts to. */
      code?: "recipients_changed";
    };

// Account states we'll send from live in @/lib/email-send-status
// (shared with the UI gates so they can't drift).

/** Sanity cap on To / Cc list length for a posted recipient list. */
const MAX_RECIPIENTS_PER_FIELD = 50;
/** Cap on To + Cc combined for one message. */
const MAX_RECIPIENTS_TOTAL = 100;
/** RFC 5321 forward-path limit. */
const MAX_ADDRESS_LENGTH = 254;
/** Gmail rejects an unfolded Subject over 998 characters. */
const MAX_SUBJECT_LENGTH = 998;
/** Plain-text / HTML body cap (the action body limit is ~1 MB). */
const MAX_BODY_LENGTH = 1_000_000;

const SAVED_LOCALLY_WARNING =
  "Sent, but the local copy could not be saved. It will appear after the next sync.";

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
  if (!isSendableStatus(account.syncStatus)) {
    return { ok: false, error: NOT_CONNECTED_ERROR };
  }

  // Record the email is filed to. Validated BEFORE Gmail so a stale or
  // walled record sends nothing. The guards throw notFound for a
  // missing / walled record (never try/catch them).
  const scope = input.scope as RecordScope | undefined;
  if (
    !scope ||
    (scope.kind === "matter" && !scope.matterId) ||
    (scope.kind === "lead" && !scope.leadId) ||
    (scope.kind !== "matter" && scope.kind !== "lead")
  ) {
    return { ok: false, error: "Choose a matter or lead." };
  }
  await assertScopeAccess(scope);
  const blocked = await assertScopeWritable(scope);
  if (blocked) return { ok: false, error: blocked };
  const recordExists =
    scope.kind === "matter"
      ? await prisma.matter.findUnique({
          where: { id: scope.matterId },
          select: { id: true },
        })
      : await prisma.lead.findUnique({
          where: { id: scope.leadId },
          select: { id: true },
        });
  if (!recordExists) {
    return {
      ok: false,
      error: scope.kind === "matter" ? "Matter not found" : "Lead not found",
    };
  }

  const to = validateAddresses(input.to);
  if (!to.ok) return to;
  const cc = validateAddresses(input.cc ?? [], { allowEmpty: true });
  if (!cc.ok) return cc;
  if (to.addresses.length === 0) {
    return { ok: false, error: "Add at least one recipient." };
  }
  if (to.addresses.length + cc.addresses.length > MAX_RECIPIENTS_TOTAL) {
    return { ok: false, error: "Too many recipients." };
  }
  if (!input.bodyText.trim()) {
    return { ok: false, error: "The message body is empty." };
  }
  const sizeError = checkContentSize(input.subject, input);
  if (sizeError) return { ok: false, error: sizeError };

  const subject = input.subject.trim();
  const sentAt = new Date();
  // Outbound boundary: strip anything the note profile disallows
  // BEFORE the MIME builder sees it (see module header).
  const bodyHtml =
    sanitizeUserHtml(input.bodyHtml) || plainTextToHtml(input.bodyText);
  const raw = tryBuildRaw({
    from: { name: account.user.name, email: account.emailAddress },
    to: to.addresses,
    cc: cc.addresses,
    subject,
    text: input.bodyText,
    html: bodyHtml,
    date: sentAt,
  });
  if (!raw.ok) return raw;

  const sent = await postGmailSend(account.id, { raw: raw.raw });
  if (!sent.ok) return sent;

  // Gmail has ACCEPTED the message. Nothing below may turn the result
  // into a failure: the composer would keep the draft and the user would
  // send the same email to the recipient a second time.
  try {
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
      scope,
    });

    if (persisted.matterId || persisted.leadId) {
      await logActivity({
        matterId: persisted.matterId,
        leadId: persisted.leadId,
        userId,
        type: "email",
        title: "Email sent",
        detail: subject || "(no subject)",
      });
    }
    revalidateSendSurfaces(
      optionalScopeOf({ matterId: persisted.matterId, leadId: persisted.leadId })
    );
    return {
      ok: true,
      threadId: persisted.threadId,
      ...(persisted.notice ? { notice: persisted.notice } : {}),
    };
  } catch (err) {
    console.error("[email-send] sent but local save failed", sent.id, err);
    return { ok: true, threadId: sent.threadId, warning: SAVED_LOCALLY_WARNING };
  }
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
      leadId: true,
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
  const threadScope = optionalScopeOf(thread);
  if (threadScope) await assertScopeAccess(threadScope);
  if (!isSendableStatus(thread.account.syncStatus)) {
    return { ok: false, error: NOT_CONNECTED_ERROR };
  }
  if (!input.bodyText.trim()) {
    return { ok: false, error: "The reply body is empty." };
  }

  // Recipients. The composer posts the exact list the user was shown.
  //   - edited (`recipientsEdited: true`): the user typed it, send it
  //     (validated).
  //   - not edited: the list is the render-time DEFAULT. The thread may
  //     have changed since (a sync landed a newer inbound message), so
  //     re-derive from the current rows and REFUSE if the result differs
  //     from what the user saw - a privileged reply must never go to
  //     someone other than the people on screen.
  //   - no list at all: derive (legacy / programmatic callers).
  const derive = () =>
    deriveReplyRecipients(
      thread.messages.map((m) => ({
        fromName: m.fromName,
        fromEmail: m.fromEmail,
        toRecipients: parseStoredRecipients(m.toRecipients),
        ccRecipients: parseStoredRecipients(m.ccRecipients),
      })),
      thread.account.emailAddress,
      input.replyAll ?? false
    );
  let to: MimeAddress[];
  let cc: MimeAddress[];
  if (input.to && input.to.length > 0) {
    if (
      input.to.length > MAX_RECIPIENTS_PER_FIELD ||
      (input.cc?.length ?? 0) > MAX_RECIPIENTS_PER_FIELD
    ) {
      return { ok: false, error: "Too many recipients." };
    }
    const toV = validateAddresses(input.to);
    if (!toV.ok) return toV;
    const ccV = validateAddresses(input.cc ?? [], { allowEmpty: true });
    if (!ccV.ok) return ccV;
    if (input.recipientsEdited === true) {
      to = toV.addresses;
      cc = ccV.addresses;
    } else {
      const derived = derive();
      if (
        !sameAddressSet(derived.to, toV.addresses) ||
        !sameAddressSet(derived.cc, ccV.addresses)
      ) {
        return {
          ok: false,
          code: "recipients_changed",
          error:
            "New messages arrived on this thread, so the recipients changed. Review the updated recipients and send again - your draft is untouched.",
        };
      }
      // Same people the user saw - use the derived entries so display
      // names survive.
      to = derived.to;
      cc = derived.cc;
    }
  } else {
    const derived = derive();
    to = derived.to;
    cc = derived.cc;
  }
  // Derived recipients come from stored headers and were never run
  // through validateAddresses; a malformed one (group syntax such as
  // "Team: a@b.com", "ops@localhost") would make the MIME builder throw.
  // Drop them rather than fail the whole reply.
  to = to.filter((a) => isSendableAddress(a.email));
  cc = cc.filter((a) => isSendableAddress(a.email));
  if (to.length + cc.length > MAX_RECIPIENTS_TOTAL) {
    return { ok: false, error: "Too many recipients." };
  }
  if (to.length === 0) {
    return {
      ok: false,
      error:
        "Couldn't determine who to reply to — edit the recipients and try again.",
    };
  }

  const subject = buildReplySubject(thread.subject);
  const sizeError = checkContentSize(subject, input);
  if (sizeError) return { ok: false, error: sizeError };
  const sentAt = new Date();
  // Same outbound sanitize boundary as sendEmail (module header).
  const bodyHtml =
    sanitizeUserHtml(input.bodyHtml) || plainTextToHtml(input.bodyText);
  const raw = tryBuildRaw({
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
  if (!raw.ok) return raw;

  const payload: { raw: string; threadId?: string } = { raw: raw.raw };
  if (thread.externalId) payload.threadId = thread.externalId;

  const sent = await postGmailSend(thread.account.id, payload);
  if (!sent.ok) return sent;

  // Gmail has ACCEPTED the message - see sendEmail: never fail past here.
  try {
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
      // The thread's own record: files the new local thread if Gmail
      // forks the reply into a different Gmail thread.
      scope: threadScope,
    });

    if (persisted.matterId || persisted.leadId) {
      await logActivity({
        matterId: persisted.matterId,
        leadId: persisted.leadId,
        userId,
        type: "email",
        title: "Email reply sent",
        detail: subject,
      });
    }
    revalidateSendSurfaces(
      optionalScopeOf({ matterId: persisted.matterId, leadId: persisted.leadId })
    );
    return { ok: true, threadId: persisted.threadId };
  } catch (err) {
    console.error("[email-send] reply sent but local save failed", sent.id, err);
    return { ok: true, threadId: thread.id, warning: SAVED_LOCALLY_WARNING };
  }
}

// ── Internals ────────────────────────────────────────────────────────────

type AddressValidation =
  | { ok: true; addresses: MimeAddress[] }
  | { ok: false; error: string };

/** isValidEmailAddress is deliberately permissive (it is shared with the
 *  client composer); on the server we additionally refuse control
 *  characters, quotes and over-long addresses. */
function isSendableAddress(email: string): boolean {
  return (
    email.length <= MAX_ADDRESS_LENGTH &&
    !/[\x00-\x1f\x7f"]/.test(email) &&
    isValidEmailAddress(email)
  );
}

/** Subject / body size limits; returns a friendly error or null. */
function checkContentSize(
  subject: string,
  input: { bodyHtml: string; bodyText: string }
): string | null {
  if (subject.trim().length > MAX_SUBJECT_LENGTH) {
    return `The subject is too long (max ${MAX_SUBJECT_LENGTH} characters).`;
  }
  if (
    input.bodyText.length > MAX_BODY_LENGTH ||
    input.bodyHtml.length > MAX_BODY_LENGTH
  ) {
    return "The message is too large to send.";
  }
  return null;
}

/** buildMimeMessage throws on a header it cannot encode; turn that
 *  into a draft-preserving failure. */
function tryBuildRaw(
  input: Parameters<typeof buildMimeMessage>[0]
): { ok: true; raw: string } | { ok: false; error: string } {
  try {
    return { ok: true, raw: encodeMimeForGmail(buildMimeMessage(input)) };
  } catch (err) {
    console.warn("[email-send] could not build message", err);
    return {
      ok: false,
      error:
        "Couldn't build the message - check the recipients and subject. Your draft is untouched.",
    };
  }
}

function validateAddresses(
  raw: string[],
  opts?: { allowEmpty?: boolean }
): AddressValidation {
  const addresses: MimeAddress[] = [];
  const seen = new Set<string>();
  if (raw.length > MAX_RECIPIENTS_PER_FIELD) {
    return { ok: false, error: "Too many recipients." };
  }
  for (const entry of raw) {
    const email = entry.trim();
    if (!email && opts?.allowEmpty) continue;
    if (!isSendableAddress(email)) {
      return { ok: false, error: `Invalid email address: "${entry}".` };
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push({ email });
  }
  return { ok: true, addresses };
}

/** Order-insensitive, case-insensitive comparison of two recipient
 *  lists by bare address. */
function sameAddressSet(a: MimeAddress[], b: MimeAddress[]): boolean {
  const left = new Set(a.map((x) => x.email.toLowerCase()));
  const right = new Set(b.map((x) => x.email.toLowerCase()));
  if (left.size !== right.size) return false;
  for (const e of left) if (!right.has(e)) return false;
  return true;
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
  /** Record to file a newly created or still-unfiled thread to. A
   *  thread already filed elsewhere keeps its filing (see `notice`).
   *  Null files nothing. */
  scope: RecordScope | null;
}): Promise<{
  threadId: string;
  matterId: string | null;
  leadId: string | null;
  notice?: string;
}> {
  const byExternal = {
    accountId_externalId: {
      accountId: opts.accountId,
      externalId: opts.gmailThreadId,
    },
  } as const;
  const threadSelect = { id: true, matterId: true, leadId: true } as const;

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
          ...(opts.scope ? scopeWhere(opts.scope) : {}),
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

  // File an unfiled thread (an existing Gmail thread the send landed
  // in, or one the create raced with sync); never move a filed one.
  let notice: string | undefined;
  if (opts.scope) {
    const current = optionalScopeOf(thread);
    if (!current) {
      await prisma.emailThread.updateMany({
        where: { id: thread.id, matterId: null, leadId: null },
        data: scopeWhere(opts.scope),
      });
      const fresh = await prisma.emailThread.findUniqueOrThrow({
        where: { id: thread.id },
        select: threadSelect,
      });
      thread = fresh;
    } else if (!sameScope(current, opts.scope)) {
      const record =
        current.kind === "matter"
          ? await prisma.matter.findUnique({
              where: { id: current.matterId },
              select: { name: true },
            })
          : await prisma.lead.findUnique({
              where: { id: current.leadId },
              select: { name: true },
            });
      notice = `Added to an existing thread filed to ${record?.name ?? `another ${current.kind}`}.`;
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
      sentFromApp: true,
    },
    // Sync may later enrich this row (clean headers, HTML body);
    // never clobber on a repeat of our own write - but a row sync
    // created first is still ours: mark it app-sent.
    update: { sentFromApp: true },
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

  return {
    threadId: thread.id,
    matterId: thread.matterId,
    leadId: thread.leadId,
    ...(notice ? { notice } : {}),
  };
}

function makeSnippet(bodyText: string): string {
  return bodyText.replace(/\s+/g, " ").trim().slice(0, 140);
}

/** Every surface that lists threads / renders the reader — same set
 *  as thread-read's revalidation. */
function revalidateSendSurfaces(scope: RecordScope | null): void {
  revalidatePath("/communication");
  for (const path of revalidationPathsFor(scope)) revalidatePath(path);
  revalidatePath("/intake/[id]/communication", "page");
}
