/**
 * Records tab body, shared by the matter and intake routes: the new
 * request composer, requests grouped by status, and (when `?request=`
 * names a request in THIS scope) the detail panel. A stale or foreign
 * id opens nothing. The page has already enforced `records.view`.
 */

import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { activeStorageDriver } from "@/lib/file-storage";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import {
  RECORDS_REQUEST_STATUSES,
  RECORDS_STATUS_LABEL,
} from "@/lib/records-requests/status";
import {
  getRecordsRequestDetail,
  getRecordsRequests,
  listRecordsRequestTypes,
} from "@/lib/queries/records-requests";
import { NewRequestComposer } from "./new-request-composer";
import { RequestDetailPanel } from "./request-detail-panel";
import { RequestRow } from "./request-row";

export async function RecordsTab({
  scope,
  requestParam,
  writable,
}: {
  scope: RecordScope;
  requestParam: string | null;
  /** False on a converted lead: its requests moved to the matter. */
  writable: boolean;
}) {
  const tz = await getCurrentUserTimeZone();
  // Matter fees are expense data: visible only with matters.expense.view.
  // A lead has no expenses, so records.view (already enforced) suffices.
  const includeFees =
    scope.kind === "lead" || (await currentUserHasPermission("matters.expense.view"));
  const [
    rows,
    detail,
    canCreate,
    canEdit,
    canDelete,
    canUpload,
    canExpense,
    canContact,
    types,
  ] = await Promise.all([
    getRecordsRequests(scope, tz, { includeFees }),
    requestParam
      ? getRecordsRequestDetail(scope, requestParam, { includeFees })
      : null,
    currentUserHasPermission("records.create"),
    currentUserHasPermission("records.edit"),
    currentUserHasPermission("records.delete"),
    currentUserHasPermission("documents.upload"),
    currentUserHasPermission("matters.expense.create"),
    currentUserHasPermission("contacts.create"),
    listRecordsRequestTypes({ activeOnly: true }),
  ]);

  const showComposer = writable && canCreate;
  const needsUsers = showComposer || (detail !== null && canEdit && writable);

  const [users, currentUserId, templates, linkable] = await Promise.all([
    needsUsers
      ? prisma.user.findMany({
          where: { isActive: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, name: true },
        })
      : [],
    showComposer ? getCurrentUserId() : "",
    detail && canEdit && writable
      ? prisma.documentTemplate.findMany({
          where: { isActive: true },
          orderBy: [{ category: "asc" }, { name: "asc" }],
          select: { id: true, name: true, category: true, description: true },
        })
      : [],
    detail && canEdit && writable
      ? prisma.document.findMany({
          where: { ...scopeWhere(scope), recordsRequestId: null },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 100,
          select: { id: true, name: true },
        })
      : [],
  ]);

  const typeOptions = types.map((t) => ({ id: t.id, name: t.name }));
  const groups = RECORDS_REQUEST_STATUSES.map((status) => ({
    status,
    rows: rows.filter((r) => r.status === status),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {showComposer && (
        <NewRequestComposer
          scope={scope}
          types={typeOptions}
          users={users}
          currentUserId={currentUserId}
          canCreateContact={canContact}
        />
      )}

      {rows.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="No records requests yet"
          description={showComposer ? "Create one above." : undefined}
          className="py-6"
        />
      )}

      {groups.map((g) => (
        <section key={g.status}>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              {RECORDS_STATUS_LABEL[g.status]}
            </h2>
            <span className="text-2xs font-mono text-ink-4">{g.rows.length}</span>
          </div>
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-line">
              {g.rows.map((r) => (
                <RequestRow key={r.id} row={r} scope={scope} />
              ))}
            </ul>
          </Card>
        </section>
      ))}

      {detail && (
        <RequestDetailPanel
          key={detail.id}
          detail={detail}
          scope={scope}
          types={typeOptions}
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
        />
      )}
    </div>
  );
}
