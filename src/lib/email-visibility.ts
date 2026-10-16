/**
 * Email-thread read model — the single definition of "which email
 * threads may this user see or act on".
 *
 * Mailboxes are personal: a thread belongs to the EmailAccount that
 * synced it, and an account belongs to one user. The Communication
 * inbox, a matter's Communication tab (listThreadsForMatter), a
 * lead's tab (listThreadsForEmail), the counts and the attachment
 * download route all scope to `account: { userId }`. Filing a thread
 * to a matter does NOT make it visible to the rest of the matter's
 * team — there is no admin override either.
 *
 * Search, the sidebar badge and every email-derived action (file /
 * unfile, spawn task/deadline/note, log time on a message) must use
 * this helper rather than re-deriving the scope, so a future widening
 * (e.g. an explicit shared-mailbox flag) happens in exactly one place.
 */

import type { Prisma } from "@/generated/prisma/client";

/** `where` fragment matching only threads in `userId`'s own mailbox.
 *  Spread it into (or AND it with) any EmailThread where clause. */
export function visibleEmailThreadWhere(
  userId: string
): Prisma.EmailThreadWhereInput {
  return { account: { userId } };
}

/** Same scope for queries that start from an EmailMessage. */
export function visibleEmailMessageWhere(
  userId: string
): Prisma.EmailMessageWhereInput {
  return { thread: visibleEmailThreadWhere(userId) };
}
