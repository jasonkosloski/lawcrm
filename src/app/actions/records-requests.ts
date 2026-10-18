/**
 * Records-request actions: create / update / status / delete, on a
 * matter or an intake lead (RecordScope). Each is gated on a
 * `records.*` key and asserts scope access; each logs activity of
 * type "records" (lead-scoped rows carry matterId null).
 *
 * The rolling follow-up task is managed through
 * src/lib/records-requests/follow-up.ts inside the same transaction as
 * the request change. Form-state types live in
 * src/lib/records-requests/form.ts ("use server" files may only export
 * async functions).
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { assertScopeAccess, assertScopeWritable } from "@/lib/scope-access";
import {
  scopeOf,
  scopePaths,
  type RecordScope,
} from "@/lib/record-scope";
import { addCalendarDays, computeResponseDue } from "@/lib/records-requests/due-date";
import { isAssignableUser } from "@/lib/task-assignment";
import { parseDateOnly, todayKey } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  RECORDS_REQUEST_STATUSES,
  RECORDS_TERMINAL_STATUSES,
  checkRecordsTransition,
  type RecordsRequestStatus,
} from "@/lib/records-requests/status";
import {
  cancelFollowUpTasks,
  lockRecordsRequest,
  openFollowUpTask,
  rollFollowUp,
  syncFollowUpTaskOwner,
} from "@/lib/records-requests/follow-up";
import type { RecordsRequestFormState } from "@/lib/records-requests/form";

const STALE_MESSAGE =
  "This request was changed by someone else since you opened it. Close this dialog and reopen it to see the latest, then re-apply your edit.";

function revalidateForScope(scope: RecordScope): void {
  for (const path of scopePaths(scope, "records")) revalidatePath(path);
  revalidatePath("/");
}

const optStr = (max: number) => z.string().max(max).optional().or(z.literal(""));

const requestSchema = z.object({
  custodianContactId: z.string().min(1, "Custodian is required"),
  typeId: z.string().optional().or(z.literal("")),
  adHocTypeName: optStr(200),
  subject: z.string().trim().min(1, "Subject is required").max(300),
  description: optStr(4000),
  dateRangeStart: optStr(10),
  dateRangeEnd: optStr(10),
  /** Tri-state: absent = default/untouched, "" = unassigned, id = assign. */
  ownerId: z.string().optional(),
  sentAt: optStr(10),
  responseDueDate: optStr(10),
  nextFollowUpDate: optStr(10),
  expectedUpdatedAt: optStr(40),
});

type Parsed = z.infer<typeof requestSchema>;
type Errors = Record<string, string[]>;

function rawValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/** Date-only field: undefined = absent, null = cleared, Date = set. */
function dateField(
  value: string | undefined,
  key: string,
  label: string,
  errors: Errors
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === "") return null;
  const d = parseDateOnly(value);
  if (!d) errors[key] = [`Invalid ${label}`];
  return d ?? undefined;
}

/** Cross-field checks shared by create and update. Returns the
 *  resolved type name for ad hoc / typed requests. */
async function validateCommon(
  p: Parsed,
  errors: Errors
): Promise<void> {
  const custodian = await prisma.contact.findUnique({
    where: { id: p.custodianContactId },
    select: { id: true },
  });
  if (!custodian) errors.custodianContactId = ["Custodian not found"];
  if (p.typeId) {
    const t = await prisma.recordsRequestType.findUnique({
      where: { id: p.typeId },
      select: { id: true },
    });
    if (!t) errors.typeId = ["Request type not found"];
  } else if (!p.adHocTypeName?.trim()) {
    errors.adHocTypeName = ["Name the type of records for an ad hoc request"];
  }
}

export async function createRecordsRequest(
  scope: RecordScope,
  _prev: RecordsRequestFormState,
  fd: FormData
): Promise<RecordsRequestFormState> {
  await requirePermission("records.create");
  const userId = await assertScopeAccess(scope);
  const values = rawValues(fd);

  const readOnly = await assertScopeWritable(scope);
  if (readOnly) {
    return { status: "error", errors: { _form: [readOnly] }, values };
  }

  const parsed = requestSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors as Errors,
      values,
    };
  }
  const p = parsed.data;
  const errors: Errors = {};
  await validateCommon(p, errors);
  const rangeStart = dateField(p.dateRangeStart, "dateRangeStart", "start date", errors);
  const rangeEnd = dateField(p.dateRangeEnd, "dateRangeEnd", "end date", errors);
  const dueDate = p.typeId
    ? undefined
    : dateField(p.responseDueDate, "responseDueDate", "due date", errors);
  if (rangeStart && rangeEnd && rangeEnd < rangeStart) {
    errors.dateRangeEnd = ["End date is before the start date"];
  }
  const ownerId = p.ownerId === undefined ? userId : p.ownerId || null;
  if (ownerId && ownerId !== userId && !(await isAssignableUser(ownerId))) {
    errors.ownerId = ["Owner not found or inactive"];
  }
  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, values };
  }

  await prisma.recordsRequest.create({
    data: {
      ...(scope.kind === "matter"
        ? { matterId: scope.matterId }
        : { leadId: scope.leadId }),
      custodianContactId: p.custodianContactId,
      typeId: p.typeId || null,
      adHocTypeName: p.typeId ? null : p.adHocTypeName!.trim(),
      subject: p.subject,
      description: p.description || null,
      dateRangeStart: rangeStart ?? null,
      dateRangeEnd: rangeEnd ?? null,
      responseDueDate: dueDate ?? null,
      ownerId,
      status: "draft",
      createdById: userId,
    },
  });

  await logActivity({
    matterId: scope.kind === "matter" ? scope.matterId : null,
    userId,
    type: "records",
    title: "Records request created",
    detail: p.subject,
  });
  revalidateForScope(scope);
  return { status: "ok" };
}

export async function updateRecordsRequest(
  id: string,
  _prev: RecordsRequestFormState,
  fd: FormData
): Promise<RecordsRequestFormState> {
  await requirePermission("records.edit");
  const values = rawValues(fd);
  const row = await prisma.recordsRequest.findUnique({ where: { id } });
  if (!row) {
    return {
      status: "error",
      errors: { _form: ["Request no longer exists"] },
      values,
    };
  }
  const scope = scopeOf(row);
  const userId = await assertScopeAccess(scope);

  const parsed = requestSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors as Errors,
      values,
    };
  }
  const p = parsed.data;

  const expected = p.expectedUpdatedAt ? new Date(p.expectedUpdatedAt) : null;
  if (
    expected &&
    (Number.isNaN(expected.getTime()) ||
      expected.getTime() !== row.updatedAt.getTime())
  ) {
    revalidateForScope(scope);
    return { status: "error", errors: { _form: [STALE_MESSAGE] }, values };
  }

  const errors: Errors = {};
  await validateCommon(p, errors);
  const rangeStart = dateField(p.dateRangeStart, "dateRangeStart", "start date", errors);
  const rangeEnd = dateField(p.dateRangeEnd, "dateRangeEnd", "end date", errors);
  const sentAt = dateField(p.sentAt, "sentAt", "sent date", errors);
  const dueDate = dateField(p.responseDueDate, "responseDueDate", "due date", errors);
  const nextFollowUp = dateField(
    p.nextFollowUpDate,
    "nextFollowUpDate",
    "follow-up date",
    errors
  );
  const start = rangeStart === undefined ? row.dateRangeStart : rangeStart;
  const end = rangeEnd === undefined ? row.dateRangeEnd : rangeEnd;
  if (start && end && end < start) {
    errors.dateRangeEnd = ["End date is before the start date"];
  }
  const nextOwner =
    p.ownerId === undefined ? undefined : p.ownerId === "" ? null : p.ownerId;
  const ownerChanged = nextOwner !== undefined && nextOwner !== row.ownerId;
  if (ownerChanged && nextOwner && !(await isAssignableUser(nextOwner))) {
    errors.ownerId = ["Owner not found or inactive"];
  }
  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, values };
  }

  const stale = await prisma.$transaction(async (tx) => {
    const write = await tx.recordsRequest.updateMany({
      where: expected ? { id, updatedAt: expected } : { id },
      data: {
        custodianContactId: p.custodianContactId,
        typeId: p.typeId || null,
        adHocTypeName: p.typeId ? null : p.adHocTypeName!.trim(),
        subject: p.subject,
        description: p.description || null,
        dateRangeStart: rangeStart,
        dateRangeEnd: rangeEnd,
        sentAt,
        // Never recomputed from the type: only what the form sent.
        responseDueDate: dueDate,
        nextFollowUpDate: nextFollowUp,
        ownerId: ownerChanged ? nextOwner : undefined,
      },
    });
    if (write.count === 0) return true;
    if (ownerChanged) await syncFollowUpTaskOwner(tx, id, nextOwner ?? null);
    if (nextFollowUp !== undefined) {
      await tx.task.updateMany({
        where: { recordsRequestId: id, status: { in: ["open", "in_progress"] } },
        data: { dueDate: nextFollowUp },
      });
    }
    return false;
  });
  if (stale) {
    revalidateForScope(scope);
    return { status: "error", errors: { _form: [STALE_MESSAGE] }, values };
  }

  await logActivity({
    matterId: row.matterId,
    userId,
    type: "records",
    title: "Records request updated",
    detail: p.subject,
  });
  revalidateForScope(scope);
  return { status: "ok" };
}

/** Send a draft: stamps sentAt, derives the response due date from the
 *  type's statutory period (else the posted/ad hoc value), schedules the
 *  first chase and opens the follow-up task. */
export async function markRecordsRequestSent(
  id: string,
  _prev: RecordsRequestFormState,
  fd: FormData
): Promise<RecordsRequestFormState> {
  await requirePermission("records.edit");
  const values = rawValues(fd);
  const fail = (msg: string, key = "_form"): RecordsRequestFormState => ({
    status: "error",
    errors: { [key]: [msg] },
    values,
  });
  const row = await prisma.recordsRequest.findUnique({
    where: { id },
    select: { matterId: true, leadId: true, subject: true },
  });
  if (!row) return fail("Request no longer exists");
  const scope = scopeOf(row);
  const userId = await assertScopeAccess(scope);
  const readOnly = await assertScopeWritable(scope);
  if (readOnly) return fail(readOnly);

  const errors: Errors = {};
  const todayKeyStr = todayKey(await getCurrentUserTimeZone());
  const sentAt = parseDateOnly(values.sentAt || todayKeyStr);
  if (!sentAt) return fail("Invalid sent date", "sentAt");
  const postedDue = dateField(
    values.responseDueDate,
    "responseDueDate",
    "due date",
    errors
  );
  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, values };
  }

  const result = await prisma.$transaction(
    async (tx): Promise<string | null> => {
      await lockRecordsRequest(tx, id);
      const cur = await tx.recordsRequest.findUnique({
        where: { id },
        select: {
          status: true,
          type: {
            select: {
              followUpDays: true,
              responseAmount: true,
              responseUnit: true,
            },
          },
        },
      });
      if (!cur) return "Request no longer exists";
      if (cur.status !== "draft") {
        return "Only a draft request can be marked sent.";
      }
      const t = cur.type;
      const dueDate =
        t?.responseAmount != null && t.responseUnit
          ? computeResponseDue(sentAt, t.responseAmount, t.responseUnit)
          : (postedDue ?? null);
      await tx.recordsRequest.update({
        where: { id },
        data: {
          status: "sent",
          sentAt,
          responseDueDate: dueDate,
          nextFollowUpDate: addCalendarDays(sentAt, t?.followUpDays ?? 7),
        },
      });
      await openFollowUpTask(tx, id);
      return null;
    }
  );
  if (result) return fail(result);

  await logActivity({
    matterId: row.matterId,
    userId,
    type: "records",
    title: "Records request sent",
    detail: row.subject,
  });
  revalidateForScope(scope);
  return { status: "ok" };
}

/** Log a manual follow-up: closes the open task and schedules the next. */
export async function logRecordsFollowUp(
  id: string,
  _prev: RecordsRequestFormState,
  fd: FormData
): Promise<RecordsRequestFormState> {
  await requirePermission("records.edit");
  const values = rawValues(fd);
  const fail = (msg: string): RecordsRequestFormState => ({
    status: "error",
    errors: { _form: [msg] },
    values,
  });
  const note = (values.note ?? "").trim().slice(0, 2000) || null;
  const row = await prisma.recordsRequest.findUnique({
    where: { id },
    select: { matterId: true, leadId: true, subject: true },
  });
  if (!row) return fail("Request no longer exists");
  const scope = scopeOf(row);
  const userId = await assertScopeAccess(scope);
  const readOnly = await assertScopeWritable(scope);
  if (readOnly) return fail(readOnly);

  const today = todayKey(await getCurrentUserTimeZone());
  const rolled = await prisma.$transaction((tx) =>
    rollFollowUp(tx, id, { actorId: userId, note, today })
  );
  if (!rolled) return fail("This request is not open.");

  await logActivity({
    matterId: row.matterId,
    userId,
    type: "records",
    title: "Records follow-up logged",
    detail: row.subject,
  });
  revalidateForScope(scope);
  return { status: "ok" };
}

export async function setRecordsRequestStatus(
  id: string,
  status: RecordsRequestStatus
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("records.edit");
  if (!(RECORDS_REQUEST_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Unknown status: ${status}` };
  }
  const row = await prisma.recordsRequest.findUnique({
    where: { id },
    select: { matterId: true, leadId: true, status: true, subject: true },
  });
  if (!row) return { ok: false, error: "Request not found" };
  const scope = scopeOf(row);
  const userId = await assertScopeAccess(scope);

  const toTerminal = (RECORDS_TERMINAL_STATUSES as readonly string[]).includes(
    status
  );
  const today = parseDateOnly(todayKey(await getCurrentUserTimeZone()));

  const result = await prisma.$transaction(
    async (
      tx
    ): Promise<
      | { ok: true; from: RecordsRequestStatus; reopen: boolean }
      | { ok: false; error: string }
    > => {
      await lockRecordsRequest(tx, id);
      const cur = await tx.recordsRequest.findUnique({
        where: { id },
        select: { status: true, type: { select: { followUpDays: true } } },
      });
      if (!cur) return { ok: false, error: "Request not found" };
      const from = cur.status as RecordsRequestStatus;
      if (from === "draft" && status === "sent") {
        return { ok: false, error: "Use Mark sent to send a request." };
      }
      const t = checkRecordsTransition(from, status);
      if (!t.ok) {
        return {
          ok: false,
          error: `Can't change a request from ${from} to ${status}.`,
        };
      }
      const write = await tx.recordsRequest.updateMany({
        where: { id, status: from },
        data: {
          status,
          ...(toTerminal
            ? {
                nextFollowUpDate: null,
                ...(status === "complete" ? { receivedAt: today } : {}),
              }
            : {}),
          // A reopened request was cleared at close; restart the chase.
          ...(t.reopen && today
            ? {
                nextFollowUpDate: addCalendarDays(
                  today,
                  cur.type?.followUpDays ?? 7
                ),
              }
            : {}),
        },
      });
      if (write.count === 0) {
        return {
          ok: false,
          error:
            "This request changed while you were updating it. Reload and try again.",
        };
      }
      if (toTerminal) await cancelFollowUpTasks(tx, id);
      else if (t.reopen) await openFollowUpTask(tx, id);
      return { ok: true, from, reopen: t.reopen };
    }
  );
  if (!result.ok) return result;

  await logActivity({
    matterId: row.matterId,
    userId,
    type: "records",
    title: result.reopen
      ? "Records request reopened"
      : "Records request status changed",
    detail: `${row.subject}: ${result.from} → ${status}`,
  });
  revalidateForScope(scope);
  return { ok: true };
}

export async function deleteRecordsRequest(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("records.delete");
  const row = await prisma.recordsRequest.findUnique({
    where: { id },
    select: { matterId: true, leadId: true, subject: true },
  });
  if (!row) return { ok: false, error: "Request not found" };
  const scope = scopeOf(row);
  const userId = await assertScopeAccess(scope);

  await prisma.$transaction(async (tx) => {
    await cancelFollowUpTasks(tx, id);
    // The FK SetNull only clears recordsRequestId; clear the role too.
    await tx.document.updateMany({
      where: { recordsRequestId: id },
      data: { recordsRequestId: null, recordsRequestRole: null },
    });
    await tx.recordsRequest.delete({ where: { id } });
  });

  await logActivity({
    matterId: row.matterId,
    userId,
    type: "records",
    title: "Records request deleted",
    detail: row.subject,
  });
  revalidateForScope(scope);
  return { ok: true };
}
