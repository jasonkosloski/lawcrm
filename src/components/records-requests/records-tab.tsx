/**
 * Records tab body, shared by the matter and intake routes: the new
 * request composer and requests grouped by status. Each row links to the
 * request's own page. The page has already enforced `records.view`.
 */

import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { type RecordScope } from "@/lib/record-scope";
import {
  RECORDS_REQUEST_STATUSES,
  RECORDS_STATUS_LABEL,
} from "@/lib/records-requests/status";
import {
  getRecordsRequests,
  listRecordsRequestTypes,
} from "@/lib/queries/records-requests";
import { NewRequestComposer } from "./new-request-composer";
import { RequestRow } from "./request-row";

export async function RecordsTab({
  scope,
  writable,
}: {
  scope: RecordScope;
  /** False on a converted lead: its requests moved to the matter. */
  writable: boolean;
}) {
  const tz = await getCurrentUserTimeZone();
  // Matter fees are expense data: visible only with matters.expense.view.
  // A lead has no expenses, so records.view (already enforced) suffices.
  const includeFees =
    scope.kind === "lead" || (await currentUserHasPermission("matters.expense.view"));
  const [rows, canCreate, canContact, types] = await Promise.all([
    getRecordsRequests(scope, tz, { includeFees }),
    currentUserHasPermission("records.create"),
    currentUserHasPermission("contacts.create"),
    listRecordsRequestTypes({ activeOnly: true }),
  ]);

  const showComposer = writable && canCreate;

  const [users, currentUserId] = await Promise.all([
    showComposer
      ? prisma.user.findMany({
          where: { isActive: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, name: true },
        })
      : [],
    showComposer ? getCurrentUserId() : "",
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
    </div>
  );
}
