/**
 * Matter Detail — Time & Expenses tab
 *
 * Time: billable + non-billable time entries on this matter, with
 * summary cards (total hours / billable hours / unbilled amount /
 * billed amount) and a dated table.
 *
 * Expenses: real Expense model + matter-level list. Mirrors the
 * time-entry layout — composer at top, table below, summary KPIs
 * inline. Each row carries its category + billable/client-advanced
 * flags + invoice link when billed.
 *
 * The expense section is the page-level enforcement point for
 * `matters.expense.view` — getMatterExpenses itself does no
 * permission check, so viewers without the key must not trigger
 * the fetch, let alone see the section.
 */

import Link from "next/link";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
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
import {
  ExpenseComposer,
  type ExpenseDocumentOption,
} from "@/components/matters/expenses/expense-composer";
import { ExpenseRowActions } from "@/components/matters/expenses/expense-row-actions";
import { prisma } from "@/lib/prisma";
import { RowAttachedNotes } from "@/components/matters/row-attached-notes";
import {
  EXPENSE_CATEGORY_LABEL,
  type ExpenseCategory,
} from "@/lib/expense-constants";
import { type TimeEntryStatus } from "@/lib/note-constants";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  getMatterExpenses,
  getMatterTimeEntries,
  getMatterTimeSummary,
  type ExpenseRow,
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
  const [
    entries,
    summary,
    canViewExpenses,
    canCreateExpense,
    canDeleteExpense,
  ] = await Promise.all([
    getMatterTimeEntries(id),
    getMatterTimeSummary(id),
    currentUserHasPermission("matters.expense.view"),
    currentUserHasPermission("matters.expense.create"),
    currentUserHasPermission("matters.expense.delete"),
  ]);
  // Expense data waits on the view gate: getMatterExpenses does no
  // permission check itself, so amounts/receipts must not be fetched
  // (never mind rendered) for viewers without matters.expense.view.
  // The document list rides along — it only feeds the expense
  // composer's receipt picker, which lives inside the gated section.
  const [expenses, matterDocuments] = canViewExpenses
    ? await Promise.all([
        getMatterExpenses(id),
        // Compact projection — name + id only — to keep the receipt
        // picker payload small.
        prisma.document.findMany({
          where: { matterId: id },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true },
        }),
      ])
    : [null, []];
  const expenseDocumentOptions: ExpenseDocumentOption[] = matterDocuments;

  if (entries.length === 0) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <TimeComposer matterId={id} />
        <div className="text-xs text-ink-4 text-center py-6">
          No time logged yet — add an entry above.
        </div>
        {expenses && (
          <ExpensesSection
            matterId={id}
            expenses={expenses}
            canCreate={canCreateExpense}
            canDelete={canDeleteExpense}
            documentOptions={expenseDocumentOptions}
          />
        )}
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

      {expenses && (
        <ExpensesSection
          matterId={id}
          expenses={expenses}
          canCreate={canCreateExpense}
          canDelete={canDeleteExpense}
          documentOptions={expenseDocumentOptions}
        />
      )}
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
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {entry.spawnedFrom && (
              <EntitySourceChip
                source={entry.spawnedFrom}
                matterId={matterId}
              />
            )}
            <RowAttachedNotes
              notes={entry.attachedNotes}
              matterId={matterId}
              compact
            />
          </div>
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

function ExpensesSection({
  matterId,
  expenses,
  canCreate,
  canDelete,
  documentOptions,
}: {
  matterId: string;
  expenses: { rows: ExpenseRow[]; totalAmount: number; billableUnbilledAmount: number };
  canCreate: boolean;
  canDelete: boolean;
  documentOptions: ExpenseDocumentOption[];
}) {
  const { rows, totalAmount, billableUnbilledAmount } = expenses;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            Expenses
          </h2>
          <span className="text-2xs font-mono text-ink-4">{rows.length}</span>
        </div>
        <div className="text-2xs text-ink-4 font-mono">
          {rows.length === 0
            ? "—"
            : `total ${formatMoney(totalAmount)} · unbilled ${formatMoney(billableUnbilledAmount)}`}
        </div>
      </div>

      {canCreate && (
        <ExpenseComposer
          matterId={matterId}
          documentOptions={documentOptions}
        />
      )}

      {rows.length === 0 ? (
        <div className="text-xs text-ink-4 text-center py-6 border border-dashed border-line rounded-md">
          No expenses logged on this matter yet.
          {canCreate && " Use \"Log expense\" above to add one."}
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>UTBMS</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="pr-4 w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <ExpenseTableRow
                  key={e.id}
                  expense={e}
                  matterId={matterId}
                  canDelete={canDelete}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}

function ExpenseTableRow({
  expense,
  matterId,
  canDelete,
}: {
  expense: ExpenseRow;
  matterId: string;
  canDelete: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="pl-4 text-xs text-ink-3 whitespace-nowrap">
        {format(expense.date, "MMM d, yyyy")}
      </TableCell>
      <TableCell className="text-xs text-ink">
        {expense.description}
        {expense.notes && (
          <div className="text-2xs text-ink-4 mt-0.5">{expense.notes}</div>
        )}
      </TableCell>
      <TableCell className="text-2xs text-ink-3 whitespace-nowrap">
        {EXPENSE_CATEGORY_LABEL[expense.category as ExpenseCategory] ??
          expense.category}
      </TableCell>
      <TableCell className="text-2xs font-mono text-ink-4">
        {expense.utbmsCode ?? "—"}
      </TableCell>
      <TableCell className="text-xs font-mono text-ink text-right whitespace-nowrap">
        {formatMoney(expense.amount)}
      </TableCell>
      <TableCell className="text-2xs whitespace-nowrap">
        <div className="flex flex-col gap-0.5">
          {expense.billable ? (
            expense.invoiceId && expense.invoiceNumber ? (
              <Link
                href={`/matters/${matterId}/billing?invoice=${expense.invoiceId}`}
                className="inline-flex w-fit text-2xs px-1.5 py-0.5 rounded-full border bg-ok-soft text-ok border-line hover:underline"
              >
                Billed · {expense.invoiceNumber}
              </Link>
            ) : (
              <span className="inline-flex w-fit text-2xs px-1.5 py-0.5 rounded-full border bg-brand-soft text-brand-700 border-brand-200">
                Billable
              </span>
            )
          ) : (
            <span className="inline-flex w-fit text-2xs px-1.5 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line">
              Non-billable
            </span>
          )}
          {expense.clientAdvanced && (
            <span className="inline-flex w-fit text-2xs px-1.5 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line">
              Client-advanced
            </span>
          )}
          {expense.receiptDocumentId && (
            // The chip links to the file when a blob exists, else
            // falls back to a non-link annotation. Either way it
            // tells the user a receipt is attached.
            expense.receiptHasFile ? (
              <a
                href={`/api/documents/${expense.receiptDocumentId}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line hover:border-brand-300 hover:text-brand-700"
                title={
                  expense.receiptDocumentName
                    ? `Receipt: ${expense.receiptDocumentName}`
                    : "Receipt attached"
                }
              >
                📎 Receipt
              </a>
            ) : (
              <span
                className="inline-flex w-fit text-2xs px-1.5 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line"
                title={
                  expense.receiptDocumentName ?? "Receipt attached (no file)"
                }
              >
                📎 Receipt (no file)
              </span>
            )
          )}
        </div>
      </TableCell>
      <TableCell className="text-2xs font-mono text-ink-4">
        {expense.loggerInitials ?? "—"}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <ExpenseRowActions
          expenseId={expense.id}
          description={expense.description}
          isBilled={!!expense.invoiceId}
          canDelete={canDelete}
        />
      </TableCell>
    </TableRow>
  );
}
