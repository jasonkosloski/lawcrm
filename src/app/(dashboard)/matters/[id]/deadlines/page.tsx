/**
 * Matter Detail — Deadlines tab
 *
 * Statute-driven, rule-driven, and manual deadlines for this matter.
 * Open deadlines surface first, then completed/waived, each sorted by
 * due date.
 */

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
import { type DeadlineStatus } from "@/lib/note-constants";
import { getMatterDeadlines } from "@/lib/queries/matter-detail";

const KIND_LABEL: Record<string, string> = {
  critical: "Critical",
  auto_rule: "Auto-rule",
  manual: "Manual",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  completed: "Completed",
  overdue: "Overdue",
  waived: "Waived",
};

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

const formatDate = (d: Date): string =>
  d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default async function MatterDeadlinesPage({
  params,
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const deadlines = await getMatterDeadlines(id);

  return (
    <div className="p-5 flex flex-col gap-4">
      <DeadlineComposer matterId={id} />

      {deadlines.length === 0 ? (
        <div className="text-xs text-ink-4 text-center py-6">
          No deadlines yet — add one above.
        </div>
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
                    {d.spawnedFrom && (
                      <EntitySourceChip
                        source={d.spawnedFrom}
                        matterId={id}
                        className="self-start mt-0.5"
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-ink-3">
                  {formatDate(d.dueDate)}
                </TableCell>
                <TableCell className="text-right font-mono text-2xs">
                  {d.status !== "open" ? (
                    <span className="text-ink-4">—</span>
                  ) : d.isOverdue ? (
                    <span className="text-warn font-medium">
                      {Math.abs(d.daysUntil)}d late
                    </span>
                  ) : d.daysUntil <= 7 ? (
                    <span className="text-warn font-medium">{d.daysUntil}d</span>
                  ) : (
                    <span className="text-ink-3">{d.daysUntil}d</span>
                  )}
                </TableCell>
                <TableCell>
                  <KindChip kind={d.kind} />
                </TableCell>
                <TableCell className="text-2xs font-mono text-ink-4">
                  {d.sourceRef ?? d.sourceType ?? "—"}
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
                    deadline={{
                      id: d.id,
                      title: d.title,
                      description: d.description,
                      kind: d.kind,
                      sourceRef: d.sourceRef,
                      dueDate: d.dueDate,
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
