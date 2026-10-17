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

export function isSendableStatus(status: string): boolean {
  return (SENDABLE_EMAIL_STATUSES as readonly string[]).includes(status);
}
