/**
 * Lead Detail — Time & Expenses tab
 *
 * The lead-scoped mirror of the matter Time tab: intake time
 * (evaluation calls, conflict checks, meeting prep) logged against
 * the lead via `TimeEntry.leadId` before a matter exists. Composer
 * on top, summary cards, dated table below — same idiom as
 * /matters/[id]/time. Rows reuse TimeEntryRowMenu, so edit / status
 * / delete work here too (those actions are scope-aware and
 * revalidate this tab). On conversion, every entry re-homes onto
 * the new matter (convertLeadToMatter) and this list empties.
 *
 * NO expense section, deliberately: `Expense.matterId` is still
 * required in the schema (`Expense.leadId` is an unwired
 * placeholder), so lead-only expenses can't exist yet. When that
 * column relaxes, mirror the matter tab's ExpensesSection here.
 */

import Link from "next/link";
import { Briefcase } from "lucide-react";
import { prisma } from "@/lib/prisma";
// Entry dates are date-only values (server-local midnight) — the
// centralized "medium" variant with no TZ override keeps them on
// the day grid they were saved on.
import { formatDate } from "@/lib/format-date";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LeadTimeComposer } from "@/components/intake/lead-time-composer";
import { TimeEntryRowMenu } from "@/components/time-entries/time-entry-row-actions";
import { utbmsCodeLabel } from "@/lib/time-entry-constants";
import { type TimeEntryStatus } from "@/lib/note-constants";
import {
  getLeadTimeEntries,
  summarizeLeadTime,
  type LeadTimeEntryRow,
} from "@/lib/queries/lead-time";

const STATUS_META: Record<string, { label: string; className: string }> = {
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

/** TimeEntry.source → short human label ("manual" stays implicit
 *  as the common case). */
const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  timer: "Timer",
  email: "Email",
  calendar: "Event",
  document: "Document",
  task: "Task",
  evidence: "Evidence",
};

export default async function LeadTimePage({
  params,
}: PageProps<"/intake/[id]/time">) {
  const { id } = await params;
  const [lead, entries] = await Promise.all([
    // Stage decides whether the composer renders: converted leads
    // are read-only here (their intake time already rolled forward
    // to the matter; createLeadTimeEntry refuses them server-side).
    prisma.lead.findUnique({
      where: { id },
      select: { stage: true, convertedMatterId: true },
    }),
    getLeadTimeEntries(id),
  ]);
  // The layout notFound()s missing leads; render nothing if the row
  // vanished between the layout's fetch and ours.
  if (!lead) return null;

  const summary = summarizeLeadTime(entries);
  const isConverted = lead.stage === "converted";

  return (
    <div className="p-5 flex flex-col gap-5">
      {isConverted ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <p className="text-xs text-ink-3">
            This lead converted — its intake time was carried forward to
            the matter. Log new work there.
          </p>
          {lead.convertedMatterId && (
            <Link
              href={`/matters/${lead.convertedMatterId}/time`}
              className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand-700 hover:underline"
            >
              <Briefcase size={13} />
              Open matter time
            </Link>
          )}
        </div>
      ) : (
        <LeadTimeComposer leadId={id} />
      )}

      {entries.length === 0 ? (
        <div className="text-xs text-ink-4 text-center py-6">
          {isConverted
            ? "No intake time remains on this lead."
            : "No intake time logged yet — add an entry above. Entries carry forward to the matter if the lead converts."}
        </div>
      ) : (
        <>
          {/* Summary cards — hours only: intake work has no billing
              rate until a matter exists, so there are no amounts to
              roll up (unlike the matter tab's WIP/billed cards). */}
          <div className="grid grid-cols-3 gap-4">
            <SummaryCard
              label="Total hours"
              value={summary.totalHours.toFixed(1)}
              sub="all intake entries"
            />
            <SummaryCard
              label="Billable hours"
              value={summary.billableHours.toFixed(1)}
              sub={`of ${summary.totalHours.toFixed(1)} total`}
            />
            <SummaryCard
              label="Entries"
              value={String(entries.length)}
              sub={isConverted ? "on this lead" : "carry forward on conversion"}
            />
          </div>

          <section>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                Intake time entries
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
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-4 w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <EntryRow key={e.id} entry={e} />
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        </>
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

function EntryRow({ entry }: { entry: LeadTimeEntryRow }) {
  const status = STATUS_META[entry.status] ?? STATUS_META.draft;
  return (
    <TableRow>
      <TableCell className="pl-4 text-xs text-ink-3 whitespace-nowrap">
        {formatDate(entry.date, "medium")}
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
        </div>
      </TableCell>
      <TableCell className="text-2xs font-mono text-ink-4">
        {entry.utbmsCode ? (
          <span
            title={utbmsCodeLabel(entry.utbmsCode)}
            className="inline-block px-1.5 py-0.5 rounded-full border border-line bg-paper-2 text-ink-3"
          >
            {entry.utbmsCode}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-ink">
        {entry.hours.toFixed(1)}
      </TableCell>
      <TableCell className="text-2xs text-ink-4">
        {SOURCE_LABEL[entry.source] ?? entry.source}
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
            utbmsCode: entry.utbmsCode,
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
