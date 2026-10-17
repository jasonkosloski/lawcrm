/**
 * Matter Detail — Deadlines tab
 *
 * Statute-driven, rule-driven, and manual deadlines for this matter.
 * Open deadlines surface first, then completed/waived, each sorted by
 * due date.
 *
 * Due dates are date-only values (ADR-012): displayed with
 * `formatDateOnly`, and "days left" is counted from the VIEWER's today
 * with `daysUntilDateOnly` — a deadline due today is "Today", never
 * late. Write controls follow the viewer's permissions.
 */

import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeadlineComposer } from "@/components/matters/captures/deadline-composer";
import { DeadlineRowMenu } from "@/components/deadlines/deadline-row-actions";
import { EntitySourceChip } from "@/components/matters/entity-source-chip";
import { RowAttachedNotes } from "@/components/matters/row-attached-notes";
import {
  DEADLINE_KIND_LABEL,
  DEADLINE_STATUS_LABEL,
  type DeadlineStatus,
} from "@/lib/constants/deadline-status";
import {
  dateOnlyKey,
  daysUntilDateOnly,
  formatDateOnly,
} from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";
import { getMatterDeadlines } from "@/lib/queries/matter-detail";
import { listDeadlineRules } from "@/lib/queries/automations";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getCaptureAccess } from "@/lib/capture-access";
import { ApplyDeadlineRuleDialog } from "@/components/automations/apply-deadline-rule-dialog";
import { requireUser } from "@/lib/current-user";

// Label maps are centralized (src/lib/constants/deadline-status.ts).
// Widened to string-indexable here because DB values arrive untyped.
const KIND_LABEL: Record<string, string> = DEADLINE_KIND_LABEL;
const STATUS_LABEL: Record<string, string> = DEADLINE_STATUS_LABEL;

function KindChip({ kind }: { kind: string }) {
  const label = KIND_LABEL[kind] ?? kind;
  const cls =
    kind === "critical"
      ? "bg-warn-soft text-warn border-warn-border"
      : kind === "auto_rule"
        ? "bg-brand-soft text-brand-700 border-brand-200"
        : "bg-paper-2 text-ink-3 border-line";
  return (
    <span
      className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
    >
      {label}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const cls =
    status === "completed"
      ? "bg-ok-soft text-ok border-line"
      : status === "waived"
        ? "bg-paper-2 text-ink-4 border-line"
        : "bg-brand-soft text-brand-700 border-brand-200";
  return (
    <span
      className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
    >
      {label}
    </span>
  );
}

export default async function MatterDeadlinesPage({
  params,
}: PageProps<"/matters/[id]">) {
  await requireUser();
  const { id } = await params;
  // The rule library does not depend on the matter or the permission
  // result, so it runs in the same batch; it is discarded below for
  // viewers who couldn't apply a rule.
  const [
    rows,
    versions,
    allRules,
    tz,
    canCreate,
    canEdit,
    canDelete,
    canLogTime,
    captureAccess,
  ] = await Promise.all([
    getMatterDeadlines(id),
    // Row versions for the edit dialog's stale-form guard.
    prisma.deadline.findMany({
      where: { matterId: id },
      select: { id: true, updatedAt: true },
    }),
    listDeadlineRules({ activeOnly: true }),
    getCurrentUserTimeZone(),
    currentUserHasPermission("deadlines.create"),
    currentUserHasPermission("deadlines.edit"),
    currentUserHasPermission("deadlines.delete"),
    currentUserHasPermission("time_entries.create"),
    getCaptureAccess(),
  ]);
  const rules = canCreate ? allRules : [];
  const updatedAtById = new Map(
    versions.map((v) => [v.id, v.updatedAt.toISOString()])
  );

  // Open deadlines first, then completed/waived (the query's
  // alphabetical status order put "completed" above "open"); each
  // group stays in due-date order (Array.sort is stable).
  const deadlines = rows
    .map((d) => ({ ...d, daysLeft: daysUntilDateOnly(d.dueDate, tz) }))
    .sort((a, b) => {
      const rank = (x: { status: string }) => (x.status === "open" ? 0 : 1);
      return (
        rank(a) - rank(b) ||
        a.dueDate.getTime() - b.dueDate.getTime()
      );
    });

  return (
    <div className="p-5 flex flex-col gap-4">
      {rules.length > 0 && (
        <div className="flex justify-end">
          <ApplyDeadlineRuleDialog
            matterId={id}
            rules={rules.map((r) => ({ id: r.id, title: r.title, summary: r.summary }))}
          />
        </div>
      )}
      {canCreate && (
        <DeadlineComposer
          matterId={id}
          siblingKinds={captureAccess.kinds}
          canPin={captureAccess.canPin}
        />
      )}

      {deadlines.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No deadlines yet"
          description={canCreate ? "Add one above." : undefined}
          className="py-6"
        />
      ) : (
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Deadline</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4 w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deadlines.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="pl-4">
                  <div className="flex flex-col leading-tight gap-0.5">
                    <span className="font-medium text-ink">{d.title}</span>
                    {d.description && (
                      <span className="text-2xs text-ink-3 truncate max-w-md">
                        {d.description}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {d.spawnedFrom && (
                        <EntitySourceChip
                          source={d.spawnedFrom}
                          matterId={id}
                        />
                      )}
                      <RowAttachedNotes
                        notes={d.attachedNotes}
                        matterId={id}
                        compact
                      />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-ink-3">
                  {formatDateOnly(d.dueDate)}
                </TableCell>
                <TableCell className="text-right font-mono text-2xs">
                  {d.status !== "open" ? (
                    <span className="text-ink-4">—</span>
                  ) : d.daysLeft < 0 ? (
                    <span className="text-warn font-medium">
                      {Math.abs(d.daysLeft)}d late
                    </span>
                  ) : d.daysLeft === 0 ? (
                    <span className="text-warn font-medium">Today</span>
                  ) : d.daysLeft <= 7 ? (
                    <span className="text-warn font-medium">{d.daysLeft}d</span>
                  ) : (
                    <span className="text-ink-3">{d.daysLeft}d</span>
                  )}
                </TableCell>
                <TableCell>
                  <KindChip kind={d.kind} />
                </TableCell>
                <TableCell className="text-2xs font-mono text-ink-4">
                  {d.sourceType === "deadline_rule"
                    ? `Rule${d.sourceRef ? ` · ${d.sourceRef}` : ""}`
                    : (d.sourceRef ?? d.sourceType ?? "—")}
                </TableCell>
                <TableCell>
                  {d.ownerInitials ? (
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100"
                      title={d.ownerName ?? undefined}
                    >
                      {d.ownerInitials}
                    </span>
                  ) : (
                    <span className="text-2xs text-ink-4">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusChip status={d.status} />
                </TableCell>
                <TableCell className="pr-4">
                  <DeadlineRowMenu
                    canEdit={canEdit}
                    canDelete={canDelete}
                    canLogTime={canLogTime}
                    deadline={{
                      id: d.id,
                      title: d.title,
                      description: d.description,
                      kind: d.kind,
                      sourceRef: d.sourceRef,
                      dueDateKey: dateOnlyKey(d.dueDate),
                      updatedAt: updatedAtById.get(d.id) ?? "",
                      sourceType: d.sourceType,
                      // `overdue` is computed; persisted statuses are open/completed/waived.
                      // Coerce overdue → open so the menu radio shows the underlying state.
                      status: (d.status === "overdue"
                        ? "open"
                        : d.status) as DeadlineStatus,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      )}
    </div>
  );
}
