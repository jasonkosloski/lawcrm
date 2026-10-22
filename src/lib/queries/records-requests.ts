/**
 * Read-side queries for the Records Requests module. Later tasks add
 * more queries here; for now just the request-type list.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { optionalRecordAccessClause } from "@/lib/matter-access";
import { scopeBasePath, scopeOf, scopeWhere, type RecordScope } from "@/lib/record-scope";
import { addDaysToKey, daysUntilDateOnly, parseDateOnly, todayKey } from "@/lib/format-date";
import {
  RECORDS_REQUEST_STATUSES,
  RECORDS_TERMINAL_STATUSES,
  isRecordsRequestOverdue,
  type RecordsRequestStatus,
} from "@/lib/records-requests/status";

export type RecordsRequestTypeRow = {
  id: string;
  name: string;
  responseAmount: number | null;
  responseUnit: "CALENDAR_DAYS" | "BUSINESS_DAYS" | null;
  followUpDays: number;
  defaultTemplateId: string | null;
  defaultTemplateName: string | null;
  isActive: boolean;
  sortOrder: number;
};

/** Request types ordered by sortOrder then name (id as final tiebreak). */
export async function listRecordsRequestTypes(opts: {
  activeOnly: boolean;
}): Promise<RecordsRequestTypeRow[]> {
  const rows = await prisma.recordsRequestType.findMany({
    where: opts.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      responseAmount: true,
      responseUnit: true,
      followUpDays: true,
      defaultTemplateId: true,
      isActive: true,
      sortOrder: true,
      defaultTemplate: { select: { name: true } },
    },
  });
  return rows.map(({ defaultTemplate, ...r }) => ({
    ...r,
    defaultTemplateName: defaultTemplate?.name ?? null,
  }));
}

// ── Request list + detail ──────────────────────────────────────────────

export type RecordsRequestRow = {
  id: string;
  status: RecordsRequestStatus;
  subject: string;
  custodianName: string;
  typeName: string;
  sentAt: Date | null;
  responseDueDate: Date | null;
  nextFollowUpDate: Date | null;
  /** Whole days until the response is due (negative = past); null without a due date. */
  daysUntilDue: number | null;
  isOverdue: boolean;
  feeAmount: string | null;
  letterCount: number;
  recordsCount: number;
  ownerInitials: string | null;
};

const REQUEST_STATUS_SET = new Set<string>(RECORDS_REQUEST_STATUSES);

/** Every request in the scope, newest first. */
export async function getRecordsRequests(
  scope: RecordScope,
  tz: string,
  /** Fee values leave the server only when the viewer may see them. */
  opts: { includeFees?: boolean } = {},
): Promise<RecordsRequestRow[]> {
  const rows = await prisma.recordsRequest.findMany({
    where: scopeWhere(scope),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      subject: true,
      adHocTypeName: true,
      sentAt: true,
      responseDueDate: true,
      nextFollowUpDate: true,
      feeAmount: true,
      custodian: { select: { name: true } },
      type: { select: { name: true } },
      owner: { select: { initials: true } },
      documents: { select: { recordsRequestRole: true } },
    },
  });
  const today = todayKey(tz);
  return rows.map((r) => ({
    id: r.id,
    status: (REQUEST_STATUS_SET.has(r.status) ? r.status : "draft") as RecordsRequestStatus,
    subject: r.subject,
    custodianName: r.custodian.name,
    typeName: r.type?.name ?? r.adHocTypeName ?? "Ad hoc",
    sentAt: r.sentAt,
    responseDueDate: r.responseDueDate,
    nextFollowUpDate: r.nextFollowUpDate,
    daysUntilDue: r.responseDueDate ? daysUntilDateOnly(r.responseDueDate, tz) : null,
    isOverdue: isRecordsRequestOverdue(r, today),
    feeAmount: opts.includeFees && r.feeAmount ? r.feeAmount.toFixed(2) : null,
    letterCount: r.documents.filter((d) => d.recordsRequestRole === "request_letter").length,
    recordsCount: r.documents.filter((d) => d.recordsRequestRole === "received_records").length,
    ownerInitials: r.owner?.initials ?? null,
  }));
}

export type RecordsRequestDetail = {
  id: string;
  status: RecordsRequestStatus;
  subject: string;
  description: string | null;
  custodianContactId: string;
  custodianName: string;
  typeId: string | null;
  adHocTypeName: string | null;
  typeName: string;
  dateRangeStart: Date | null;
  dateRangeEnd: Date | null;
  sentAt: Date | null;
  receivedAt: Date | null;
  responseDueDate: Date | null;
  nextFollowUpDate: Date | null;
  ownerId: string | null;
  ownerName: string | null;
  feeEstimate: string | null;
  feeAmount: string | null;
  feePaidAt: Date | null;
  /** The fee expense is on an invoice: the fee can no longer change. */
  expenseLocked: boolean;
  followUps: { id: string; occurredAt: Date; note: string | null; userName: string }[];
  documents: {
    id: string;
    name: string;
    role: "request_letter" | "received_records" | null;
    href: string;
  }[];
  /** ISO string, echoed back as expectedUpdatedAt for the stale-edit guard. */
  updatedAt: string;
};

/** One request with its history; null when the id isn't in the scope. */
export async function getRecordsRequestDetail(
  scope: RecordScope,
  id: string,
  /** Fee values leave the server only when the viewer may see them. */
  opts: { includeFees?: boolean } = {},
): Promise<RecordsRequestDetail | null> {
  const fees = opts.includeFees === true;
  const r = await prisma.recordsRequest.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      custodian: { select: { name: true } },
      type: { select: { name: true } },
      owner: { select: { name: true } },
      expense: { select: { invoiceId: true } },
      followUps: {
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        include: { user: { select: { name: true } } },
      },
      documents: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, recordsRequestRole: true },
      },
    },
  });
  if (!r) return null;
  const base = scopeBasePath(scope);
  return {
    id: r.id,
    status: (REQUEST_STATUS_SET.has(r.status) ? r.status : "draft") as RecordsRequestStatus,
    subject: r.subject,
    description: r.description,
    custodianContactId: r.custodianContactId,
    custodianName: r.custodian.name,
    typeId: r.typeId,
    adHocTypeName: r.adHocTypeName,
    typeName: r.type?.name ?? r.adHocTypeName ?? "Ad hoc",
    dateRangeStart: r.dateRangeStart,
    dateRangeEnd: r.dateRangeEnd,
    sentAt: r.sentAt,
    receivedAt: r.receivedAt,
    responseDueDate: r.responseDueDate,
    nextFollowUpDate: r.nextFollowUpDate,
    ownerId: r.ownerId,
    ownerName: r.owner?.name ?? null,
    feeEstimate: fees && r.feeEstimate ? r.feeEstimate.toFixed(2) : null,
    feeAmount: fees && r.feeAmount ? r.feeAmount.toFixed(2) : null,
    feePaidAt: fees ? r.feePaidAt : null,
    expenseLocked: fees && !!r.expense?.invoiceId,
    followUps: r.followUps.map((f) => ({
      id: f.id,
      occurredAt: f.occurredAt,
      note: f.note,
      userName: f.user.name,
    })),
    documents: r.documents.map((d) => ({
      id: d.id,
      name: d.name,
      role:
        d.recordsRequestRole === "request_letter" || d.recordsRequestRole === "received_records"
          ? d.recordsRequestRole
          : null,
      href: `${base}/documents/${d.id}`,
    })),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ── Dashboard: requests to chase ───────────────────────────────────────

export type RecordsChaseItem = {
  id: string;
  subject: string;
  custodianName: string;
  href: string;
  label: string;
  context: string;
};

const CHASE_WINDOW_DAYS = 7;

/** The viewer's open requests that are overdue or due for a follow-up
 *  within a week. Fee data is deliberately not selected. */
export async function getMyRecordsToChase(tz: string): Promise<RecordsChaseItem[]> {
  const viewerId = await getCurrentUserId();
  const today = todayKey(tz);
  const todayStart = parseDateOnly(today)!;
  const windowEnd = parseDateOnly(addDaysToKey(today, CHASE_WINDOW_DAYS + 1))!;
  const accessOpt = await optionalRecordAccessClause(viewerId);
  const rows = await prisma.recordsRequest.findMany({
    where: {
      AND: [
        ...accessOpt,
        {
          ownerId: viewerId,
          status: { notIn: [...RECORDS_TERMINAL_STATUSES] },
          OR: [{ responseDueDate: { lt: todayStart } }, { nextFollowUpDate: { lt: windowEnd } }],
        },
      ],
    },
    select: {
      id: true,
      status: true,
      subject: true,
      matterId: true,
      leadId: true,
      responseDueDate: true,
      nextFollowUpDate: true,
      custodian: { select: { name: true } },
      matter: { select: { name: true } },
      lead: { select: { name: true } },
    },
  });
  const items: Array<RecordsChaseItem & { overdue: boolean; sortKey: string }> = [];
  for (const r of rows) {
    if (!RECORDS_REQUEST_STATUSES.includes(r.status as RecordsRequestStatus)) continue;
    let base: string;
    try {
      base = scopeBasePath(scopeOf(r));
    } catch {
      continue; // malformed scope: skip rather than fail the dashboard
    }
    const overdue = isRecordsRequestOverdue(r, today);
    const dueKey = r.responseDueDate ? r.responseDueDate.toISOString().slice(0, 10) : null;
    const fuKey = r.nextFollowUpDate ? r.nextFollowUpDate.toISOString().slice(0, 10) : null;
    let label: string;
    if (overdue) {
      label = `${daysUntilDateOnly(r.responseDueDate!, tz) * -1}d overdue`;
    } else if (r.nextFollowUpDate && fuKey! <= addDaysToKey(today, CHASE_WINDOW_DAYS)) {
      const d = daysUntilDateOnly(r.nextFollowUpDate, tz);
      label = d <= 0 ? "Follow up today" : `Follow up in ${d}d`;
    } else {
      continue; // matched only on a stale clause (e.g. not overdue, follow-up far off)
    }
    items.push({
      id: r.id,
      subject: r.subject,
      custodianName: r.custodian.name,
      href: `${base}/records/${r.id}`,
      label,
      context: r.matter?.name ?? (r.lead ? `Intake \u00b7 ${r.lead.name}` : "Intake"),
      overdue,
      sortKey: (overdue ? dueKey : fuKey) ?? "9999",
    });
  }
  items.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      a.sortKey.localeCompare(b.sortKey) ||
      a.id.localeCompare(b.id),
  );
  return items.map((i) => ({
    id: i.id,
    subject: i.subject,
    custodianName: i.custodianName,
    href: i.href,
    label: i.label,
    context: i.context,
  }));
}
