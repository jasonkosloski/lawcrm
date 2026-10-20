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
import { Prisma } from "@/generated/prisma/client";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { roundMoney } from "@/lib/money";
import {
  feeMakesExpense,
  recordsFeeDescription,
  recordsFeeExpenseData,
} from "@/lib/records-requests/fee-expense";
import { logActivity } from "@/lib/activity-log";
import { getCurrentUserId } from "@/lib/current-user";
import { assertScopeAccess, assertScopeWritable } from "@/lib/scope-access";
import {
  SAME_SCOPE_ERROR,
  scopeOf,
  scopePaths,
  scopeRequestPagePattern,
  scopeWhere,
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
import { isRecordsDocRole, type RecordsDocRole } from "@/lib/records-requests/roles";

const STALE_MESSAGE =
  "This request was changed by someone else since you opened it. Reload the page to see the latest, then re-apply your edit.";

function revalidateForScope(scope: RecordScope): void {
  for (const path of scopePaths(scope, "records")) revalidatePath(path);
  revalidatePath(scopeRequestPagePattern(scope), "page");
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
    leadId: scope.kind === "lead" ? scope.leadId : null,
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
    leadId: row.leadId,
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
      const nextFollowUpDate = addCalendarDays(sentAt, t?.followUpDays ?? 7);
      await openFollowUpTask(tx, id);
      // Defensive: a task that already existed keeps the new chase date.
      await tx.task.updateMany({
        where: { recordsRequestId: id, status: { in: ["open", "in_progress"] } },
        data: { dueDate: nextFollowUpDate },
      });
      return null;
    }
  );
  if (result) return fail(result);

  await logActivity({
    matterId: row.matterId,
    leadId: row.leadId,
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
    select: { matterId: true, leadId: true, subject: true, status: true },
  });
  if (!row) return fail("Request no longer exists");
  const scope = scopeOf(row);
  const userId = await assertScopeAccess(scope);
  const readOnly = await assertScopeWritable(scope);
  if (readOnly) return fail(readOnly);
  if (row.status === "draft") {
    return fail("Send the request before logging follow-ups.");
  }

  const today = todayKey(await getCurrentUserTimeZone());
  const rolled = await prisma.$transaction((tx) =>
    rollFollowUp(tx, id, { actorId: userId, note, today })
  );
  if (!rolled) return fail("This request is not open.");

  await logActivity({
    matterId: row.matterId,
    leadId: row.leadId,
    userId,
    type: "records",
    title: "Records follow-up logged",
    detail: row.subject,
  });
  revalidateForScope(scope);
  return { status: "ok" };
}

/** Why a status change was refused (reopen targets depend on sentAt). */
function reopenRefusal(
  from: RecordsRequestStatus,
  to: RecordsRequestStatus,
  hasSentAt: boolean
): string {
  const fromClosed = (RECORDS_TERMINAL_STATUSES as readonly string[]).includes(from);
  const toClosed = (RECORDS_TERMINAL_STATUSES as readonly string[]).includes(to);
  if (fromClosed && !toClosed) {
    return hasSentAt
      ? "A request that was sent can only be reopened as sent, acknowledged or partially received."
      : "A request that was never sent can only be reopened as a draft.";
  }
  return `Can't change a request from ${from} to ${to}.`;
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
        select: {
          status: true,
          sentAt: true,
          type: { select: { followUpDays: true } },
        },
      });
      if (!cur) return { ok: false, error: "Request not found" };
      const from = cur.status as RecordsRequestStatus;
      if (from === "draft" && status !== "denied" && status !== "withdrawn") {
        return { ok: false, error: "Use Mark sent to send a request." };
      }
      const t = checkRecordsTransition(from, status, {
        hasSentAt: cur.sentAt !== null,
      });
      if (!t.ok) {
        return {
          ok: false,
          error: reopenRefusal(from, status, cur.sentAt !== null),
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
          ...(t.reopen && today && status !== "draft"
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
      else if (t.reopen && status !== "draft") await openFollowUpTask(tx, id);
      return { ok: true, from, reopen: t.reopen };
    }
  );
  if (!result.ok) return result;

  await logActivity({
    matterId: row.matterId,
    leadId: row.leadId,
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
    // Generated folders become ordinary, user-managed folders.
    await tx.documentFolder.updateMany({
      where: { recordsRequestId: id },
      data: { systemKind: null, recordsRequestId: null },
    });
    await tx.recordsRequest.delete({ where: { id } });
  });

  await logActivity({
    matterId: row.matterId,
    leadId: row.leadId,
    userId,
    type: "records",
    title: "Records request deleted",
    detail: row.subject,
  });
  // List paths only: revalidating the request page being viewed would
  // re-render it as a 404 before the client navigates back to the list.
  for (const path of scopePaths(scope, "records")) revalidatePath(path);
  revalidatePath("/");
  return { ok: true };
}

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

/** Blank = null; otherwise a non-negative amount with at most 2 decimals. */
function moneyField(
  value: string | undefined,
  key: string,
  errors: Errors
): Prisma.Decimal | null {
  const v = (value ?? "").trim().replace(/[$,]/g, "");
  if (!v) return null;
  if (!MONEY_RE.test(v)) {
    errors[key] = ["Enter a non-negative amount with at most 2 decimals"];
    return null;
  }
  return roundMoney(v);
}

/** Save the fee fields. On a matter, an amount plus a paid date becomes
 *  (or updates) a billable "records" Expense linked by expenseId. On a
 *  lead the fields are stored only. */
export async function saveRecordsFee(
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
  const feeEstimate = moneyField(values.feeEstimate, "feeEstimate", errors);
  const feeAmount = moneyField(values.feeAmount, "feeAmount", errors);
  const feePaidAt = dateField(values.feePaidAt || "", "feePaidAt", "paid date", errors) ?? null;
  if (feePaidAt && !feeAmount && !errors.feeAmount) {
    errors.feePaidAt = ["Enter the fee amount before a paid date"];
  }
  if (Object.keys(errors).length > 0) {
    return { status: "error", errors, values };
  }

  const result = await prisma.$transaction(
    async (tx): Promise<{ error: string | null; matterId: string | null }> => {
      await lockRecordsRequest(tx, id);
      // Scope and expense-ness come from the row as it stands AFTER the
      // lock: a conversion that committed first moved it onto a matter.
      const cur = await tx.recordsRequest.findUnique({
        where: { id },
        select: {
          matterId: true,
          leadId: true,
          expenseId: true,
          adHocTypeName: true,
          custodian: { select: { name: true } },
          type: { select: { name: true } },
        },
      });
      const fail2 = (error: string) => ({ error, matterId: cur?.matterId ?? null });
      if (!cur) return { error: "Request no longer exists", matterId: null };
      const curScope = scopeOf(cur);
      if (curScope.kind !== scope.kind) await assertScopeAccess(curScope);
      if (
        curScope.kind === "matter" &&
        !(await currentUserHasPermission("matters.expense.view"))
      ) {
        return fail2("You don't have permission to view expenses.");
      }
      const makesExpense =
        curScope.kind === "matter" && feeMakesExpense(feeAmount, feePaidAt);

      let expenseId = cur.expenseId;
      const linked = expenseId
        ? await tx.expense.findUnique({
            where: { id: expenseId },
            select: { amount: true, date: true, description: true, invoiceId: true },
          })
        : null;
      if (linked && !makesExpense) {
        return fail2("This fee is recorded as an expense on the matter \u2014 edit or delete it on the Time & expenses tab.");
      }
      if (makesExpense) {
        const description = recordsFeeDescription({
          custodianName: cur.custodian.name,
          typeName: cur.type?.name ?? null,
          adHocTypeName: cur.adHocTypeName,
        });
        if (linked) {
          const differs =
            !linked.amount.equals(feeAmount!) ||
            linked.date.getTime() !== feePaidAt!.getTime() ||
            linked.description !== description;
          if (differs) {
            if (linked.invoiceId) {
              return fail2("This fee is on an invoice and can't be changed.");
            }
            if (!(await currentUserHasPermission("matters.expense.edit"))) {
              return fail2("You don't have permission to edit expenses.");
            }
            const w = await tx.expense.updateMany({
              where: { id: expenseId!, invoiceId: null },
              data: { amount: feeAmount!, date: feePaidAt!, description },
            });
            if (w.count === 0) {
              return fail2("This fee is on an invoice and can't be changed.");
            }
          }
        } else {
          expenseId = null;
        }
        if (!expenseId) {
          if (!(await currentUserHasPermission("matters.expense.create"))) {
            return fail2("You don't have permission to add expenses.");
          }
          const e = await tx.expense.create({
            data: recordsFeeExpenseData({
              matterId: cur.matterId!,
              loggedBy: userId,
              feePaidAt: feePaidAt!,
              feeAmount: feeAmount!,
              description,
            }),
            select: { id: true },
          });
          expenseId = e.id;
        }
      }

      await tx.recordsRequest.update({
        where: { id },
        data: { feeEstimate, feeAmount, feePaidAt, expenseId },
      });
      return { error: null, matterId: cur.matterId };
    }
  );
  if (result.error) return fail(result.error);

  await logActivity({
    matterId: result.matterId,
    leadId: scope.kind === "lead" ? scope.leadId : null,
    userId,
    type: "records",
    title: "Records fee updated",
    detail: row.subject,
  });
  revalidateForScope(scope);
  if (result.matterId) {
    revalidateForScope({ kind: "matter", matterId: result.matterId });
    revalidatePath(`/matters/${result.matterId}/time`);
  }
  return { status: "ok" };
}

const LINK_BATCH_CAP = 200;
const LINK_CONFLICT_ERROR = "Some documents are already linked to another request.";

class LinkConflictError extends Error {}

/** Revalidate the Documents tab alongside the Records tab. */
function revalidateRecordsAndDocuments(scope: RecordScope): void {
  revalidateForScope(scope);
  for (const path of scopePaths(scope, "documents")) revalidatePath(path);
}

/** Attach existing documents to a request under `role` (request
 *  document or responsive document). Documents must share the request's
 *  scope. Re-linking a document already on THIS request with the other
 *  role switches its role. Never moves files. */
export async function linkRecordsDocuments(
  id: string,
  documentIds: string[],
  role: RecordsDocRole
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("records.edit");
  if (!isRecordsDocRole(role)) {
    return { ok: false, error: "Invalid records document kind." };
  }
  const ids = [...new Set(documentIds)];
  if (ids.length === 0) return { ok: false, error: "Select at least one document." };
  if (ids.length > LINK_BATCH_CAP) {
    return { ok: false, error: `Link at most ${LINK_BATCH_CAP} documents at a time.` };
  }
  const row = await prisma.recordsRequest.findUnique({
    where: { id },
    select: { matterId: true, leadId: true, subject: true },
  });
  if (!row) return { ok: false, error: "Request not found" };
  const scope = scopeOf(row);
  const userId = await assertScopeAccess(scope);
  const readOnly = await assertScopeWritable(scope);
  if (readOnly) return { ok: false, error: readOnly };

  // Scope check and write in one transaction, so a document cannot be
  // claimed by another request (or moved) between the two.
  const outcome = await prisma.$transaction(async (tx) => {
    await lockRecordsRequest(tx, id);
    const docs = await tx.document.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        matterId: true,
        leadId: true,
        recordsRequestId: true,
        recordsRequestRole: true,
      },
    });
    if (docs.length !== ids.length) {
      return { ok: false as const, error: "Document not found" };
    }
    const sameScope = (d: { matterId: string | null; leadId: string | null }) =>
      scope.kind === "matter"
        ? d.matterId === scope.matterId && d.leadId === null
        : d.leadId === scope.leadId && d.matterId === null;
    if (!docs.every(sameScope)) {
      return { ok: false as const, error: SAME_SCOPE_ERROR };
    }
    // Already this request's own document with this role needs no
    // write; documents held by a different request are never stolen.
    const toTag = docs
      .filter((d) => !(d.recordsRequestId === id && d.recordsRequestRole === role))
      .map((d) => d.id);
    const written = await tx.document.updateMany({
      where: {
        id: { in: toTag },
        ...scopeWhere(scope),
        OR: [{ recordsRequestId: null }, { recordsRequestId: id }],
      },
      data: { recordsRequestId: id, recordsRequestRole: role },
    });
    if (written.count !== toTag.length) {
      // Roll back: nothing is tagged on a partial claim.
      throw new LinkConflictError();
    }
    return { ok: true as const };
  }).catch((err: unknown) => {
    if (err instanceof LinkConflictError) {
      return { ok: false as const, error: LINK_CONFLICT_ERROR };
    }
    throw err;
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await logActivity({
    matterId: row.matterId,
    leadId: row.leadId,
    userId,
    type: "records",
    title: "Documents linked to records request",
    detail: `${row.subject}: ${ids.length} document${ids.length === 1 ? "" : "s"}`,
  });
  revalidateRecordsAndDocuments(scope);
  return { ok: true };
}

/** Detach a document from its request. Never deletes the document. */
export async function unlinkRecordsDocument(
  documentId: string
): Promise<{ ok: boolean }> {
  await requirePermission("records.edit");
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { matterId: true, leadId: true, name: true, recordsRequestId: true },
  });
  if (!doc) return { ok: false };
  const scope = scopeOf(doc);
  const userId = await assertScopeAccess(scope);
  const readOnly = await assertScopeWritable(scope);
  if (readOnly) return { ok: false };

  await prisma.document.update({
    where: { id: documentId },
    data: { recordsRequestId: null, recordsRequestRole: null },
  });
  await logActivity({
    matterId: doc.matterId,
    leadId: doc.leadId,
    userId,
    type: "records",
    title: "Document unlinked from records request",
    detail: doc.name,
  });
  revalidateRecordsAndDocuments(scope);
  return { ok: true };
}

/** Custodian types the request composer may quick-create. */
const CUSTODIAN_QUICK_TYPES = ["medical_provider", "government"] as const;

/** Quick-create a custodian from the request composer. Unlike
 *  `createContact` it does not redirect, so the typed request survives.
 *  Needs both `records.create` and `contacts.create`. */
export async function createCustodianContact(
  name: string,
  type: string
): Promise<
  { ok: true; id: string; name: string } | { ok: false; error: string }
> {
  await requirePermission("records.create");
  await requirePermission("contacts.create");
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return { ok: false, error: "Enter the custodian's name." };
  if (trimmed.length > 200) return { ok: false, error: "That name is too long." };
  if (!(CUSTODIAN_QUICK_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "Pick medical provider or government." };
  }
  const userId = await getCurrentUserId();
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { firmId: true },
  });
  const created = await prisma.contact.create({
    data: { firmId: owner?.firmId ?? null, name: trimmed, type },
    select: { id: true, name: true },
  });
  revalidatePath("/contacts");
  return { ok: true, id: created.id, name: created.name };
}
