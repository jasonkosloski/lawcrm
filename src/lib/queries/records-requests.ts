/**
 * Read-side queries for the Records Requests module. Later tasks add
 * more queries here; for now just the request-type list.
 */

import { prisma } from "@/lib/prisma";
import { scopeBasePath, scopeWhere, type RecordScope } from "@/lib/record-scope";
import { daysUntilDateOnly, todayKey } from "@/lib/format-date";
import {
  RECORDS_REQUEST_STATUSES,
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
  tz: string
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
    feeAmount: r.feeAmount ? r.feeAmount.toFixed(2) : null,
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
  id: string
): Promise<RecordsRequestDetail | null> {
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
    feeEstimate: r.feeEstimate ? r.feeEstimate.toFixed(2) : null,
    feeAmount: r.feeAmount ? r.feeAmount.toFixed(2) : null,
    feePaidAt: r.feePaidAt,
    expenseLocked: !!r.expense?.invoiceId,
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
        d.recordsRequestRole === "request_letter" ||
        d.recordsRequestRole === "received_records"
          ? d.recordsRequestRole
          : null,
      href: `${base}/documents/${d.id}`,
    })),
    updatedAt: r.updatedAt.toISOString(),
  };
}
