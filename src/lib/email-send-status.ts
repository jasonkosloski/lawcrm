/**
 * Which EmailAccount.syncStatus values can send. "connected" (idle)
 * and "syncing" hold a live grant; "error"/"disconnected" mean the
 * user must reconnect first.
 *
 * One source of truth for the send actions (the authority) and the UI
 * gates (compose launcher, reply section) so they can't drift apart.
 * Deliberately a plain module - no server-only imports - because it
 * is read from server components AND a "use server" file (which may
 * only export async functions, so the constant can't live there).
 */
export const SENDABLE_EMAIL_STATUSES = ["connected", "syncing"] as const;

/** Reply to an unfiled thread by a user who can't file email. Shared
 *  by the reply action and composer ("use server" files can't export
 *  constants). */
export const REPLY_NEEDS_FILER_ERROR =
  "Ask someone who can file email to file this thread first.";

export function isSendableStatus(status: string): boolean {
  return (SENDABLE_EMAIL_STATUSES as readonly string[]).includes(status);
}

/** Most files one sent email may carry. */
export const MAX_SEND_ATTACHMENTS = 20;
/** Total attachment bytes per sent email: Gmail's own 25 MB limit. */
export const MAX_SEND_ATTACHMENT_BYTES = 25 * 1024 * 1024;
