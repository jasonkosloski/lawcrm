/**
 * Records request detail page body, shared by the matter and intake
 * routes (`.../records/[requestId]`): loads the request (scoped, so a
 * foreign or missing id 404s) and the lookups the editable sections
 * need, then hands them to the client `RequestDetail`. The route page
 * has already enforced auth, the matter wall and `records.view`.
 */

import { notFound } from "next/navigation";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { activeStorageDriver } from "@/lib/file-storage";
import { daysUntilDateOnly } from "@/lib/format-date";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import {
  getRecordsRequestDetail,
  listRecordsRequestTypes,
} from "@/lib/queries/records-requests";
import { RequestDetail } from "./request-detail";

export async function RequestDetailPage({
  scope,
  requestId,
  writable,
}: {
  scope: RecordScope;
  requestId: string;
  /** False on a converted lead: its requests moved to the matter. */
  writable: boolean;
}) {
  // Matter fees are expense data: visible only with matters.expense.view.
  // A lead has no expenses, so records.view (already enforced) suffices.
  const includeFees =
    scope.kind === "lead" || (await currentUserHasPermission("matters.expense.view"));
  const [detail, tz, canEdit, canDelete, canUpload, canExpense, types] =
    await Promise.all([
      getRecordsRequestDetail(scope, requestId, { includeFees }),
      getCurrentUserTimeZone(),
      currentUserHasPermission("records.edit"),
      currentUserHasPermission("records.delete"),
      currentUserHasPermission("documents.upload"),
      currentUserHasPermission("matters.expense.create"),
      listRecordsRequestTypes({ activeOnly: true }),
    ]);
  if (!detail) notFound();

  const editable = canEdit && writable;
  const [users, templates, linkable] = await Promise.all([
    editable
      ? prisma.user.findMany({
          where: { isActive: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, name: true },
        })
      : [],
    editable
      ? prisma.documentTemplate.findMany({
          where: { isActive: true },
          orderBy: [{ category: "asc" }, { name: "asc" }],
          select: { id: true, name: true, category: true, description: true },
        })
      : [],
    editable
      ? prisma.document.findMany({
          where: { ...scopeWhere(scope), recordsRequestId: null },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 100,
          select: { id: true, name: true },
        })
      : [],
  ]);

  return (
    <RequestDetail
      key={detail.id}
      detail={detail}
      scope={scope}
      types={types.map((t) => ({ id: t.id, name: t.name }))}
      users={users}
      templates={templates}
      defaultTemplateId={
        types.find((t) => t.id === detail.typeId)?.defaultTemplateId ?? null
      }
      storageDriver={activeStorageDriver()}
      linkableDocuments={linkable}
      can={{
        edit: canEdit,
        delete: canDelete,
        upload: canUpload,
        fee: canEdit && (scope.kind === "lead" || (canExpense && includeFees)),
      }}
      writable={writable}
      daysUntilDue={
        detail.responseDueDate ? daysUntilDateOnly(detail.responseDueDate, tz) : null
      }
    />
  );
}
