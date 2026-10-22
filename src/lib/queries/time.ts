/**
 * Time-tracking Queries
 *
 * Server-only data access for the standalone /time page (week
 * hour-bars + day reconciliation views). Everything is scoped to
 * the CURRENT user — these are personal "where did my hours go"
 * surfaces, not firm reports (see src/lib/queries/dashboard.ts
 * `getFirmPulse` for the firm-wide rollup).
 *
 * Date handling follows ADR-012: `TimeEntry.date` is a date-only
 * value (a calendar date stored at UTC midnight, read in UTC), so
 * day keys are `YYYY-MM-DD` strings, range bounds come from
 * `dateOnlyRange`, and stored dates go back to keys via
 * `dateOnlyKey` — no server time zone ever enters. The user's TZ is
 * applied upstream, where the page resolves which calendar days the
 * viewer is looking at (`parseTimeParams` + `calendarWeekInTz`); by
 * the time a key reaches these queries it is already the user's day.
 *
 * Numeric safety: `hours` is Float by design (quarter-hour
 * increments, not money) — JS sums get rounded to 2 decimals to
 * shed float noise. `amount` is Decimal and converts to number at
 * this boundary, same as the dashboard/billing queries.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { dateOnlyKey, dateOnlyRange } from "@/lib/format-date";
import { optionalRecordAccessClause } from "@/lib/matter-access";
import { getCurrentTimerSession } from "@/lib/queries/timer";

/** Shed float-accumulation noise from summed hours (0.1 + 0.2 …). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Billable-for-totals test: a no-charge entry is written off, so
 *  it counts toward worked hours but not billable hours. */
const isBillable = (e: { billable: boolean; noCharge: boolean }): boolean =>
  e.billable && !e.noCharge;

// ── Week aggregate ──────────────────────────────────────────────────────

/** Neutral dot/bar color for intake (lead-scoped) time — leads have
 *  no color column, and intake work shouldn't visually compete with
 *  matter colors. Same fallback the calendar uses for matterless
 *  events. */
const INTAKE_COLOR = "var(--color-ink-3)";

/** One matter's (or lead's) slice of one day's bar. */
export type WeekMatterSegment = {
  /** Unique segment key: the matter's id, or — for intake time —
   *  the LEAD's id (mirrored into `leadId` below so views can link
   *  to `/intake/[id]/time` instead of a matter tab). */
  matterId: string;
  matterName: string;
  matterColor: string;
  /** Set iff this segment is a lead's intake time (exactly one of
   *  matterId-as-matter / leadId per the TimeEntry invariant). */
  leadId?: string;
  hours: number;
  billableHours: number;
};

export type WeekDayTime = {
  /** YYYY-MM-DD (user-calendar day, resolved upstream). */
  dayKey: string;
  totalHours: number;
  billableHours: number;
  /** Sorted by hours desc so the widest bar segment comes first. */
  segments: WeekMatterSegment[];
};

export type MyWeekTime = {
  /** One element per requested key, in the requested order. */
  days: WeekDayTime[];
  totalHours: number;
  billableHours: number;
};

/**
 * The current user's per-day / per-matter hour sums for the given
 * day keys (typically the 7 keys of a calendar week, in order).
 * Days with no entries come back as empty rows so the view renders
 * a stable 7-row grid.
 */
export async function getMyWeekTime(dayKeys: string[]): Promise<MyWeekTime> {
  const userId = await getCurrentUserId();
  if (dayKeys.length === 0) {
    return { days: [], totalHours: 0, billableHours: 0 };
  }

  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      date: dateOnlyRange(dayKeys[0]!, dayKeys[dayKeys.length - 1]!),
      // Matter wall: own entries on matters the user can no longer
      // access are hidden (intake / lead time has no matter and stays).
      AND: await optionalRecordAccessClause(userId),
    },
    select: {
      date: true,
      hours: true,
      billable: true,
      noCharge: true,
      matter: { select: { id: true, name: true, color: true } },
      lead: { select: { id: true, name: true } },
    },
  });

  // day key → matter/lead id → running segment.
  const byDay = new Map<string, Map<string, WeekMatterSegment>>();
  for (const key of dayKeys) byDay.set(key, new Map());

  for (const e of entries) {
    const day = byDay.get(dateOnlyKey(e.date));
    // Entries between requested keys' bounds always map to one of
    // the keys when the keys are contiguous (a week). A sparse key
    // list would drop in-between days here by design.
    if (!day) continue;
    // Exactly one of (matter, lead) is set per the TimeEntry
    // invariant; the "Intake" fallback keeps hours visible (never
    // silently dropped) if a breached row ever slips in.
    const key = e.matter?.id ?? e.lead?.id ?? "intake";
    let seg = day.get(key);
    if (!seg) {
      seg = e.matter
        ? {
            matterId: e.matter.id,
            matterName: e.matter.name,
            matterColor: e.matter.color,
            hours: 0,
            billableHours: 0,
          }
        : {
            matterId: key,
            matterName: e.lead ? `Intake · ${e.lead.name}` : "Intake",
            matterColor: INTAKE_COLOR,
            leadId: e.lead?.id,
            hours: 0,
            billableHours: 0,
          };
      day.set(key, seg);
    }
    seg.hours += e.hours;
    if (isBillable(e)) seg.billableHours += e.hours;
  }

  let totalHours = 0;
  let billableHours = 0;
  const days: WeekDayTime[] = dayKeys.map((dayKey) => {
    const segments = [...byDay.get(dayKey)!.values()]
      .map((s) => ({
        ...s,
        hours: round2(s.hours),
        billableHours: round2(s.billableHours),
      }))
      .sort((a, b) => b.hours - a.hours);
    const dayTotal = round2(segments.reduce((sum, s) => sum + s.hours, 0));
    const dayBillable = round2(segments.reduce((sum, s) => sum + s.billableHours, 0));
    totalHours += dayTotal;
    billableHours += dayBillable;
    return { dayKey, totalHours: dayTotal, billableHours: dayBillable, segments };
  });

  return {
    days,
    totalHours: round2(totalHours),
    billableHours: round2(billableHours),
  };
}

// ── Day detail (reconciliation lanes) ───────────────────────────────────

export type DayTimeEntry = {
  id: string;
  /** Null for intake (lead-scoped) entries — see `leadId`. */
  matterId: string | null;
  /** Set iff the entry is intake time on a lead; views link these
   *  to `/intake/[id]/time`. Exactly one of matterId / leadId is
   *  set (TimeEntry invariant). */
  leadId: string | null;
  /** Context label: the matter's name, or "Intake · {lead name}"
   *  for lead-scoped entries ("Intake" if scope is missing). */
  matterName: string;
  matterColor: string;
  activity: string;
  narrative: string | null;
  hours: number;
  billable: boolean;
  noCharge: boolean;
  privileged: boolean;
  status: string;
  /** manual | timer | email | calendar | document | task | evidence */
  source: string;
  /** Decimal → number at the query boundary (dashboard pattern). */
  amount: number | null;
};

export type MyDayTime = {
  /** Hand-logged entries (source === "manual"). */
  logged: DayTimeEntry[];
  /** Auto-captured entries (source !== "manual") — same TimeEntry
   *  table, the lane split is purely source-based. */
  captured: DayTimeEntry[];
  /** Across BOTH lanes — the day's reconciliation total. */
  totalHours: number;
  billableHours: number;
};

/** The current user's entries for one calendar day, split into the
 *  reconciliation lanes. */
export async function getMyDayTime(dayKey: string): Promise<MyDayTime> {
  const userId = await getCurrentUserId();

  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      date: dateOnlyRange(dayKey, dayKey),
      AND: await optionalRecordAccessClause(userId),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      activity: true,
      narrative: true,
      hours: true,
      billable: true,
      noCharge: true,
      privileged: true,
      status: true,
      source: true,
      amount: true,
      matter: { select: { id: true, name: true, color: true } },
      lead: { select: { id: true, name: true } },
    },
  });

  const rows: DayTimeEntry[] = entries.map((e) => ({
    id: e.id,
    matterId: e.matter?.id ?? null,
    leadId: e.lead?.id ?? null,
    matterName: e.matter?.name ?? (e.lead ? `Intake · ${e.lead.name}` : "Intake"),
    matterColor: e.matter?.color ?? INTAKE_COLOR,
    activity: e.activity,
    narrative: e.narrative,
    hours: e.hours,
    billable: e.billable,
    noCharge: e.noCharge,
    privileged: e.privileged,
    status: e.status,
    source: e.source,
    amount: e.amount?.toNumber() ?? null,
  }));

  return {
    logged: rows.filter((r) => r.source === "manual"),
    captured: rows.filter((r) => r.source !== "manual"),
    totalHours: round2(rows.reduce((sum, r) => sum + r.hours, 0)),
    billableHours: round2(rows.filter(isBillable).reduce((sum, r) => sum + r.hours, 0)),
  };
}

// ── Live timer ──────────────────────────────────────────────────────────

export type RunningTimer = {
  startedAt: Date;
  activity: string | null;
  matterId: string | null;
  matterName: string | null;
  matterColor: string | null;
};

/** The current user's live TimerSession, if one is running. The
 *  /time page renders this read-only — starting/stopping belongs
 *  to the timer widget, which writes the TimeEntry on stop.
 *
 *  Built from `getCurrentTimerSession`, which the app shell already
 *  loaded (and React-cached) for this request — a second query here
 *  would be a redundant round trip on the 1-connection pool. */
export async function getMyRunningTimer(): Promise<RunningTimer | null> {
  const session = await getCurrentTimerSession();
  if (!session) return null;
  return {
    startedAt: new Date(session.startedAt),
    activity: session.activity,
    matterId: session.matterId,
    matterName: session.matterName,
    matterColor: session.matterColor ?? null,
  };
}
