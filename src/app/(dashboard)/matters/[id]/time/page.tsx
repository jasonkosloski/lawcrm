/**
 * Matter Detail — Time & Expenses tab
 *
 * Time: billable + non-billable time entries on this matter, with
 * summary cards (total hours / billable hours / unbilled amount /
 * billed amount) and a dated table.
 *
 * Expenses: placeholder section — the schema doesn't have an Expense
 * model yet. When we add one, the placeholder card becomes a real
 * list in the same layout.
 */

import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimeComposer } from "@/components/matters/captures/time-composer";
import { TimeEntryRowMenu } from "@/components/time-entries/time-entry-row-actions";
import { EntitySourceChip } from "@/components/matters/entity-source-chip";
import { type TimeEntryStatus } from "@/lib/note-constants";
import {
  getMatterTimeEntries,
  getMatterTimeSummary,
  type TimeEntryRow,
} from "@/lib/queries/matter-detail";

const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-paper-2 text-ink-4 border-line",
  },
  submitted: {
    label: "Submitted",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  billable: {
    label: "Billable",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  billed: {
    label: "Billed",
    className: "bg-ok-soft text-ok border-line",
  },
  written_off: {
    label: "Written off",
    className: "bg-paper-2 text-ink-3 border-line",
  },
};

const formatMoney = (n: number | null): string => {
  if (n === null) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export default async function MatterTimePage({
  params,
}: PageProps<"/matters/[id]/time">) {
  const { id } = await params;
  const [entries, summary] = await Promise.all([
    getMatterTimeEntries(id),
    getMatterTimeSummary(id),
  ]);

  if (entries.length === 0) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <TimeComposer matterId={id} />
        <div className="text-xs text-ink-4 text-center py-6">
          No time logged yet — add an entry above.
        </div>
        <ExpensesPlaceholder />
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <TimeComposer matterId={id} />

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          label="Total hours"
          value={summary.totalHours.toFixed(1)}
          sub="all entries"
        />
        <SummaryCard
          label="Billable hours"
          value={summary.billableHours.toFixed(1)}
          sub={`of ${summary.totalHours.toFixed(1)} total`}
        />
        <SummaryCard
          label="Unbilled"
          value={formatMoney(summary.unbilledAmount)}
          sub="WIP to invoice"
        />
        <SummaryCard
          label="Billed"
          value={formatMoney(summary.billedAmount)}
          sub="on sent invoices"
        />
      </div>

      {/* Time entries table */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            Time entries
          </h2>
          <span className="text-2xs font-mono text-ink-4">
            {entries.length}
          </span>
        </div>
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>UTBMS</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} matterId={id} />
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <ExpensesPlaceholder />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="p-3">
      <div className="text-2xs font-semibold uppercase tracking-wider text-ink-3 mb-1">
        {label}
      </div>
      <div className="text-xl font-display font-medium tracking-tight text-ink">
        {value}
      </div>
      <div className="text-2xs text-ink-4 mt-0.5">{sub}</div>
    </Card>
  );
}

function EntryRow({
  entry,
  matterId,
}: {
  entry: TimeEntryRow;
  matterId: string;
}) {
  const status = STATUS_META[entry.status] ?? STATUS_META.draft;
  return (
    <TableRow>
      <TableCell className="pl-4 text-xs text-ink-3 whitespace-nowrap">
        {format(entry.date, "MMM d, yyyy")}
      </TableCell>
      <TableCell>
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100"
          title={entry.userName}
        >
          {entry.userInitials}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col leading-tight max-w-xl">
          <span className="text-xs font-medium text-ink truncate">
            {entry.activity}
          </span>
          {entry.narrative && (
            <span className="text-2xs text-ink-3 truncate">
              {entry.narrative}
            </span>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            {!entry.billable && (
              <span className="text-2xs text-ink-4">Non-billable</span>
            )}
            {entry.noCharge && (
              <span className="text-2xs text-warn">No-charge</span>
            )}
            {entry.privileged && (
              <span className="text-2xs text-brand-700">Privileged</span>
            )}
          </div>
          {entry.spawnedFrom && (
            <EntitySourceChip
              source={entry.spawnedFrom}
              matterId={matterId}
              className="self-start mt-1"
            />
          )}
        </div>
      </TableCell>
      <TableCell className="text-2xs font-mono text-ink-4">
        {entry.utbmsCode ?? "—"}
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-ink">
        {entry.hours.toFixed(1)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-ink">
        {entry.billable && !entry.noCharge
          ? formatMoney(entry.amount)
          : "—"}
      </TableCell>
      <TableCell>
        <span
          className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${status.className}`}
        >
          {status.label}
        </span>
      </TableCell>
      <TableCell className="pr-4">
        <TimeEntryRowMenu
          entry={{
            id: entry.id,
            date: entry.date,
            hours: entry.hours,
            activity: entry.activity,
            narrative: entry.narrative,
            billable: entry.billable,
            noCharge: entry.noCharge,
            privileged: entry.privileged,
            status: entry.status as TimeEntryStatus,
          }}
        />
      </TableCell>
    </TableRow>
  );
}

function ExpensesPlaceholder() {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          Expenses
        </h2>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Expense tracking coming
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-ink-3 leading-relaxed mb-3">
            Reimbursable and billable expenses on this matter will live
            here once the schema has an `Expense` model. Expect:
          </p>
          <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4">
            <li>Date + description + amount + category (filing fees, expert costs, travel, deposition transcripts, etc.)</li>
            <li>Billable / non-billable + markup rules</li>
            <li>Receipt attachment per expense</li>
            <li>Invoice line-item generation alongside time entries</li>
            <li>Client-advanced vs firm-absorbed distinction (for contingent matters)</li>
          </ul>
          <div className="mt-4 pt-3 border-t border-line text-2xs text-ink-4">
            Captured in <code className="font-mono text-ink-3">docs/SCHEMA_NOTES.md</code>{" "}
            under open questions.
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
