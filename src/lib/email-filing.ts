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
  /**
   * `onlyIfUnfiled` (file-on-reply): never move a thread that is already
   * filed - the thread's record wins. Returns that record, writes nothing.
   */
  options: { onlyIfUnfiled?: boolean } = {},
): Promise<
  | {
      ok: true;
      /** The thread's record after the call. */
      scope: RecordScope | null;
      /** Its record before the call. */
      previous: RecordScope | null;
    }
  | { ok: false; error: string }
> {
  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, ...visibleEmailThreadWhere(userId) },
    select: { id: true, subject: true, matterId: true, leadId: true },
  });
  if (!thread) return { ok: false, error: "Thread not found" };

  const current = optionalScopeOf(thread);
  if (current) await assertScopeAccess(current);
  if (options.onlyIfUnfiled && current) {
    return { ok: true, scope: current, previous: current };
  }
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
  if (sameScope(current, scope)) {
    return { ok: true, scope: current, previous: current };
  }

  if (scope) {
    const blocked = await assertScopeWritable(scope);
    if (blocked) return { ok: false, error: blocked };
  }

  // Owner-scoped write (defense in depth), both FKs in one update so a
  // thread is never on a matter and a lead at once. The where re-checks
  // what this call read, so a racing tab can't be overwritten:
  //  - unfile: no app-sent mail (every app-sent email stays filed);
  //  - onlyIfUnfiled: still unfiled.
  const written = await prisma.emailThread.updateMany({
    where: {
      id: threadId,
      ...visibleEmailThreadWhere(userId),
      ...(!scope && current
        ? { messages: { none: { sentFromApp: true } } }
        : {}),
      ...(options.onlyIfUnfiled ? { matterId: null, leadId: null } : {}),
    },
    data: {
      matterId: scope?.kind === "matter" ? scope.matterId : null,
      leadId: scope?.kind === "lead" ? scope.leadId : null,
    },
  });
  if (written.count === 0) {
    const fresh = await prisma.emailThread.findFirst({
      where: { id: threadId, ...visibleEmailThreadWhere(userId) },
      select: { matterId: true, leadId: true },
    });
    if (!fresh) return { ok: false, error: "Thread not found" };
    const now = optionalScopeOf(fresh);
    if (options.onlyIfUnfiled && now) {
      return { ok: true, scope: now, previous: now };
    }
    if (!scope) return { ok: false, error: APP_SENT_UNFILE_ERROR };
    return { ok: false, error: "Thread changed - try again." };
  }

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
  return { ok: true, scope, previous: current };
}
