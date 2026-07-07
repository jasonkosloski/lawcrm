/**
 * Time Day View — reconciliation lanes
 *
 * Three lanes for the selected day, all scoped to the viewer:
 *
 *   Logged   — hand-entered TimeEntry rows (source === "manual")
 *   Captured — TimeEntry rows spawned from email / calendar / task
 *              / timer / document activity (source !== "manual");
 *              same table, the split is purely source-based, so
 *              the "captured" chip shows where each came from
 *   Timer    — the viewer's live TimerSession, if running; a
 *              read-only snapshot (elapsed computed at render) —
 *              the timer widget owns start/stop interaction
 *
 * Above the lanes: the day's total vs the daily target line —
 * `dailyHoursGoal` from the Firm row (editable on /settings/firm),
 * threaded in by the page via `getFirmGoals()`.
 *
 * Read-only v1 (server component): every entry links to its
 * matter's Time tab for editing.
 */

import Link from "next/link";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";
import type { DayTimeEntry, MyDayTime, RunningTimer } from "@/lib/queries/time";
import { timeSourceLabel } from "./time-view-utils";

/** Same status-chip vocabulary as the matter Time tab
 *  (matters/[id]/time/page.tsx) so an entry reads identically on
 *  both surfaces. */
const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-paper-2 text-ink-4 border-line" },
  submitted: {
    label: "Submitted",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  billable: {
    label: "Billable",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  billed: { label: "Billed", className: "bg-ok-soft text-ok border-line" },
  written_off: {
    label: "Written off",
    className: "bg-paper-2 text-ink-3 border-line",
  },
};

export function TimeDayView({
  day,
  timer,
  userTz,
  dailyHoursGoal,
}: {
  day: MyDayTime;
  timer: RunningTimer | null;
  userTz: string;
  /** Firm-level daily target (Firm.dailyHoursGoal) — the page
   *  resolves it via `getFirmGoals()`. */
  dailyHoursGoal: number;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-5 flex flex-col gap-4">
      <TargetLine
        totalHours={day.totalHours}
        billableHours={day.billableHours}
        goal={dailyHoursGoal}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <Lane
          title="Logged"
          count={day.logged.length}
          empty="No manual entries this day."
        >
          {day.logged.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </Lane>

        <Lane
          title="Captured"
          count={day.captured.length}
          empty="Nothing auto-captured this day — email, calendar, task and timer work lands here."
        >
          {day.captured.map((e) => (
            <EntryCard key={e.id} entry={e} showSource />
          ))}
        </Lane>

        <Lane title="Timer" count={timer ? 1 : 0} empty="No timer running.">
          {timer && <TimerCard timer={timer} userTz={userTz} />}
        </Lane>
      </div>
    </div>
  );
}

/** Day total vs the daily goal, as a slim progress bar with the
 *  target tick. */
function TargetLine({
  totalHours,
  billableHours,
  goal,
}: {
  totalHours: number;
  billableHours: number;
  goal: number;
}) {
  const pct = Math.min(100, (totalHours / goal) * 100);
  const met = totalHours >= goal;
  return (
    <div className="rounded-md border border-line bg-card px-3 sm:px-4 py-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
          Day total
        </span>
        <span className="text-xs font-mono">
          <span className={met ? "text-ok" : "text-ink"}>
            {totalHours.toFixed(1)}h
          </span>
          <span className="text-ink-4">
            {" "}
            of {goal.toFixed(1)}h target ·{" "}
            {billableHours.toFixed(1)}h billable
          </span>
        </span>
      </div>
      <div className="relative h-2 rounded bg-paper-2 overflow-hidden">
        <div
          className={cn("h-full rounded", met ? "bg-ok" : "bg-brand-500")}
          style={{ width: `${pct}%` }}
        />
        {/* Target tick at 100% of the goal */}
        <div className="absolute inset-y-0 right-0 w-px bg-ink-3" />
      </div>
    </div>
  );
}

function Lane({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {title}
        </h2>
        <span className="text-2xs font-mono text-ink-4">{count}</span>
      </div>
      {count === 0 ? (
        <div className="text-xs text-ink-4 border border-dashed border-line rounded-md px-3 py-4 text-center">
          {empty}
        </div>
      ) : (
        <div className="flex flex-col gap-2">{children}</div>
      )}
    </section>
  );
}

function EntryCard({
  entry,
  showSource = false,
}: {
  entry: DayTimeEntry;
  showSource?: boolean;
}) {
  const status = STATUS_META[entry.status] ?? STATUS_META.draft!;
  return (
    <div className="rounded-md border border-line bg-card p-2.5 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-ink leading-tight">
          {entry.activity}
        </span>
        <span className="text-xs font-mono text-ink shrink-0">
          {entry.hours.toFixed(1)}h
        </span>
      </div>

      {entry.narrative && (
        <p className="text-2xs text-ink-3 leading-snug line-clamp-2">
          {entry.narrative}
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <Link
          href={`/matters/${entry.matterId}/time`}
          className="inline-flex items-center gap-1.5 min-w-0 text-2xs text-ink-2 hover:text-brand-700"
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: entry.matterColor }}
          />
          <span className="truncate max-w-44">{entry.matterName}</span>
        </Link>
        <span
          className={`inline-block text-2xs font-medium px-1.5 py-px rounded-full border ${status.className}`}
        >
          {status.label}
        </span>
        {showSource && (
          <span className="inline-block text-2xs font-medium px-1.5 py-px rounded-full border bg-paper-2 text-ink-3 border-line">
            via {timeSourceLabel(entry.source)}
          </span>
        )}
        {!entry.billable && (
          <span className="text-2xs text-ink-4">Non-billable</span>
        )}
        {entry.noCharge && <span className="text-2xs text-warn">No-charge</span>}
        {entry.privileged && (
          <span className="text-2xs text-brand-700">Privileged</span>
        )}
      </div>
    </div>
  );
}

/** Read-only snapshot of the live timer. Elapsed is computed at
 *  render time (server), so it's the value as of page load — the
 *  ticking display + start/stop controls belong to the timer
 *  widget, not this page. */
function TimerCard({ timer, userTz }: { timer: RunningTimer; userTz: string }) {
  const elapsedHours = Math.max(
    0,
    (Date.now() - timer.startedAt.getTime()) / (60 * 60 * 1000)
  );
  return (
    <div className="rounded-md border border-brand-200 bg-brand-soft/40 p-2.5 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700">
          <Radio size={12} className="animate-pulse" />
          Running
        </span>
        <span className="text-xs font-mono text-ink shrink-0">
          {elapsedHours.toFixed(1)}h
        </span>
      </div>
      <div className="text-2xs text-ink-3">
        Started {formatDate(timer.startedAt, "time", userTz)}
        {timer.activity ? ` · ${timer.activity}` : ""}
      </div>
      {timer.matterId ? (
        <Link
          href={`/matters/${timer.matterId}/time`}
          className="inline-flex items-center gap-1.5 min-w-0 text-2xs text-ink-2 hover:text-brand-700"
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: timer.matterColor ?? "var(--color-ink-3)" }}
          />
          <span className="truncate max-w-44">{timer.matterName}</span>
        </Link>
      ) : (
        <span className="text-2xs text-ink-4">No matter yet</span>
      )}
      <span className="text-2xs text-ink-4">
        Snapshot at page load — use the timer widget to stop or edit.
      </span>
    </div>
  );
}
