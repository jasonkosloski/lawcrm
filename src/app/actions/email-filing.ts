/**
 * File-to-record actions for email threads (matter or intake lead).
 *
 * Today's surface: a single "set the record for this thread"
 * action. The thread-reader header uses a picker that calls this
 * with a matter / lead scope (file) or null (unfile back to the inbox).
 * The work lives in `fileEmailThread` (src/lib/email-filing.ts), shared
 * with file-on-reply.
 *
 * When auto-filing rules land (subject keywords / sender ↔ matter
 * party / etc.) they'll write to the same FK; this action becomes
 * the "manual override" path.
 *
 * Auth: gated on `communication.file_email` — filing/unfiling moves
 * an email onto (or off) a matter's record, so it's a matter-record
 * mutation, not just an inbox convenience. Mailboxes are personal, so
 * only the mailbox owner may file / unfile / move a thread
 * (`visibleEmailThreadWhere`); any other caller gets "Thread not
 * found" and nothing is written or logged.
 */

"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permission-check";
import { fileEmailThread, revalidationPathsFor, sameScope } from "@/lib/email-filing";
import type { RecordScope } from "@/lib/record-scope";

export async function setEmailThreadRecord(
  threadId: string,
  /** Record to file to - pass null to unfile. */
  scope: RecordScope | null,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("communication.file_email");

  const res = await fileEmailThread(userId, threadId, scope);
  if (!res.ok) return res;

  // Re-selecting the current record changed nothing - nothing to refresh.
  if (sameScope(res.previous, res.scope)) return { ok: true };

  revalidatePath("/communication");
  const paths = [...revalidationPathsFor(res.scope), ...revalidationPathsFor(res.previous)];
  for (const p of new Set(paths)) revalidatePath(p);
  return { ok: true };
}
