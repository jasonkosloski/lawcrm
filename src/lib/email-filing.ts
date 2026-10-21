/**
 * Shared core for filing an email thread to a matter or an intake lead
 * (or unfiling it). Used by the `setEmailThreadRecord` action and by
 * `replyToThread` (file-on-reply).
 *
 * No permission check and no `revalidatePath`: the caller gates
 * (`communication.file_email`) and revalidates. Everything else lives
 * here: mailbox ownership, record-wall access on the record the thread
 * leaves and the one it joins, existence, the converted-lead guard, the
 * app-sent unfile guard, the write, and the audit rows.
 */

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { visibleEmailThreadWhere } from "@/lib/email-visibility";
import { optionalScopeOf, type RecordScope } from "@/lib/record-scope";
import { assertScopeAccess, assertScopeWritable } from "@/lib/scope-access";

/** Refusal when unfiling a thread that carries mail sent from the app. */
export const APP_SENT_UNFILE_ERROR =
  "This thread has email sent from the app, so it must stay filed. Move it to another matter or lead instead.";

export const sameScope = (
  a: RecordScope | null,
  b: RecordScope | null,
): boolean => {
  if (!a || !b) return a === b;
  if (a.kind === "matter" && b.kind === "matter") {
    return a.matterId === b.matterId;
  }
  if (a.kind === "lead" && b.kind === "lead") return a.leadId === b.leadId;
  return false;
};

const activityScope = (scope: RecordScope) =>
  scope.kind === "matter"
    ? { matterId: scope.matterId, leadId: null }
    : { matterId: null, leadId: scope.leadId };

export function revalidationPathsFor(scope: RecordScope | null): string[] {
  if (!scope) return [];
  return [
    scope.kind === "matter"
      ? `/matters/${scope.matterId}/communication`
      : `/intake/${scope.leadId}/communication`,
  ];
}

export async function fileEmailThread(
  userId: string,
  threadId: string,
  /** Record to file to - null unfiles. */
  scope: RecordScope | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, ...visibleEmailThreadWhere(userId) },
    select: { id: true, subject: true, matterId: true, leadId: true },
  });
  if (!thread) return { ok: false, error: "Thread not found" };

  const current = optionalScopeOf(thread);
  if (current) await assertScopeAccess(current);
  if (scope) await assertScopeAccess(scope);

  // Verify the target exists - defends against stale picker values and
  // keeps the activity log honest.
  if (scope) {
    const exists =
      scope.kind === "matter"
        ? await prisma.matter.findUnique({
            where: { id: scope.matterId },
            select: { id: true },
          })
        : await prisma.lead.findUnique({
            where: { id: scope.leadId },
            select: { id: true },
          });
    if (!exists) {
      return {
        ok: false,
        error: scope.kind === "matter" ? "Matter not found" : "Lead not found",
      };
    }
  }

  // Already there (the picker lets the user click the active record) -
  // nothing changes, so nothing is written or logged.
  if (sameScope(current, scope)) return { ok: true };

  if (scope) {
    const blocked = await assertScopeWritable(scope);
    if (blocked) return { ok: false, error: blocked };
  } else if (current) {
    // Every app-sent email is filed: it can move, never go back to the inbox.
    const appSent = await prisma.emailMessage.count({
      where: { threadId, sentFromApp: true },
    });
    if (appSent > 0) return { ok: false, error: APP_SENT_UNFILE_ERROR };
  }

  // Owner-scoped write (defense in depth), both FKs in one update so a
  // thread is never on a matter and a lead at once.
  await prisma.emailThread.updateMany({
    where: { id: threadId, ...visibleEmailThreadWhere(userId) },
    data: {
      matterId: scope?.kind === "matter" ? scope.matterId : null,
      leadId: scope?.kind === "lead" ? scope.leadId : null,
    },
  });

  // A move must be as auditable as an unfile: record the departure on
  // the record the email left, then the arrival.
  if (current) {
    await logActivity({
      ...activityScope(current),
      userId,
      type: "email",
      title: `Email removed from ${current.kind}`,
      detail: thread.subject,
    });
  }
  if (scope) {
    await logActivity({
      ...activityScope(scope),
      userId,
      type: "email",
      title: `Email filed to ${scope.kind}`,
      detail: thread.subject,
    });
  }
  return { ok: true };
}
