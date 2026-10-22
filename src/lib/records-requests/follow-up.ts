/**
 * Rolling follow-up task for a records request. At most one open task
 * per request. Every helper takes the caller's transaction client so
 * the task state changes atomically with the request change.
 */

import type { Tx } from "@/lib/prisma";
import { scopeOf, scopeWhere } from "@/lib/record-scope";
import { addCalendarDays } from "./due-date";
import { isRecordsRequestOpen } from "./status";
import { parseDateOnly } from "@/lib/format-date";

const OPEN_TASK_STATUSES = ["open", "in_progress"];
const DEFAULT_FOLLOW_UP_DAYS = 7;

/** Row-lock the request for the rest of the caller's transaction so
 *  concurrent read-then-write helpers serialize. */
export async function lockRecordsRequest(tx: Tx, requestId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "records_requests" WHERE id = ${requestId} FOR UPDATE`;
}

export const FOLLOW_UP_RESCHEDULED_ERROR =
  "This follow-up was already rescheduled \u2014 use the open follow-up task instead.";
export const REQUEST_CLOSED_ERROR =
  "This records request is closed \u2014 reopen the request first.";

/**
 * Guard for moving a follow-up task back out of done/cancelled. Locks the
 * request FIRST (request-before-task lock order), then returns an error
 * when the request is closed or another follow-up task is already open;
 * null when the reopen is allowed. A missing request imposes no limit.
 */
export async function checkFollowUpReopen(
  tx: Tx,
  requestId: string,
  taskId: string,
): Promise<string | null> {
  await lockRecordsRequest(tx, requestId);
  const r = await tx.recordsRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!r) return null;
  if (!isRecordsRequestOpen(r.status)) return REQUEST_CLOSED_ERROR;
  const others = await tx.task.count({
    where: {
      recordsRequestId: requestId,
      id: { not: taskId },
      status: { in: OPEN_TASK_STATUSES },
    },
  });
  return others > 0 ? FOLLOW_UP_RESCHEDULED_ERROR : null;
}

/** Create the follow-up task unless one is already open (or the
 *  request is missing, a draft, or closed). Drafts are not chased. */
export async function openFollowUpTask(tx: Tx, requestId: string): Promise<void> {
  await lockRecordsRequest(tx, requestId);
  const r = await tx.recordsRequest.findUnique({
    where: { id: requestId },
    select: {
      status: true,
      matterId: true,
      leadId: true,
      ownerId: true,
      nextFollowUpDate: true,
      adHocTypeName: true,
      custodian: { select: { name: true } },
      type: { select: { name: true } },
    },
  });
  if (!r || r.status === "draft" || !isRecordsRequestOpen(r.status)) return;
  const existing = await tx.task.count({
    where: { recordsRequestId: requestId, status: { in: OPEN_TASK_STATUSES } },
  });
  if (existing > 0) return;
  const typeName = r.type?.name ?? r.adHocTypeName ?? "records request";
  await tx.task.create({
    data: {
      ...scopeWhere(scopeOf(r)),
      recordsRequestId: requestId,
      title: `Follow up: ${r.custodian.name} — ${typeName}`,
      dueDate: r.nextFollowUpDate,
      ownerId: r.ownerId,
      priority: "normal",
    },
  });
}

/** Cancel every open follow-up task for the request. */
export async function cancelFollowUpTasks(tx: Tx, requestId: string): Promise<void> {
  await lockRecordsRequest(tx, requestId);
  await tx.task.updateMany({
    where: { recordsRequestId: requestId, status: { in: OPEN_TASK_STATUSES } },
    data: { status: "cancelled", completedAt: new Date() },
  });
}

/**
 * Log a follow-up, finish the open task, schedule the next chase
 * (today + the type's interval) and open a fresh task. Returns false
 * (doing nothing) when the request is a draft or not open.
 */
export async function rollFollowUp(
  tx: Tx,
  requestId: string,
  opts: { actorId: string; note: string | null; today: string },
): Promise<boolean> {
  await lockRecordsRequest(tx, requestId);
  const r = await tx.recordsRequest.findUnique({
    where: { id: requestId },
    select: { status: true, type: { select: { followUpDays: true } } },
  });
  if (!r || r.status === "draft" || !isRecordsRequestOpen(r.status)) {
    return false;
  }
  const todayDate = parseDateOnly(opts.today);
  if (!todayDate) throw new Error(`Invalid date key: ${opts.today}`);

  await tx.recordsRequestFollowUp.create({
    data: {
      requestId,
      userId: opts.actorId,
      occurredAt: new Date(),
      note: opts.note,
    },
  });
  await tx.task.updateMany({
    where: { recordsRequestId: requestId, status: { in: OPEN_TASK_STATUSES } },
    data: { status: "done", completedAt: new Date() },
  });
  await tx.recordsRequest.update({
    where: { id: requestId },
    data: {
      nextFollowUpDate: addCalendarDays(todayDate, r.type?.followUpDays ?? DEFAULT_FOLLOW_UP_DAYS),
    },
  });
  await openFollowUpTask(tx, requestId);
  return true;
}

/** Keep the open follow-up task's assignee in step with the request. */
export async function syncFollowUpTaskOwner(
  tx: Tx,
  requestId: string,
  ownerId: string | null,
): Promise<void> {
  await tx.task.updateMany({
    where: { recordsRequestId: requestId, status: { in: OPEN_TASK_STATUSES } },
    data: { ownerId },
  });
}
