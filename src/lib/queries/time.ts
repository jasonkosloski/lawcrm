/**
 * Time-tracking Queries
 *
 * Server-only data access for the standalone /time page (week
 * hour-bars + day reconciliation views). Everything is scoped to
 * the CURRENT user — these are personal "where did my hours go"
 * surfaces, not firm reports (see src/lib/queries/dashboard.ts
 * `getFirmPulse` for the firm-wide rollup).
 *
 * Date handling follows the committed convention for date-only
 * columns (see the header of src/lib/queries/dashboard.ts):
 * `TimeEntry.date` stores *server-local midnight* of its calendar
 * day (`parseLocalDate`), so day keys and range bounds here are
 * plain server-local date-part round-trips of "YYYY-MM-DD" keys.
 * The user's TZ is applied upstream, where the page resolves which
 * calendar days the viewer is looking at (`parseTimeParams` +
 * `calendarWeekInTz`); by the time a key reaches these queries it
 * is already the user's day.
 *
 * Numeric safety: `hours` is Float by design (quarter-hour
 * increments, not money) — JS sums get rounded to 2 decimals to
 * shed float noise. `amount` is Decimal and converts to number at
 * this boundary, same as the dashboard/billing queries.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Server-local midnight of a YYYY-MM-DD key — how date-only
 *  columns store their day (parseLocalDate convention). Throws on
 *  malformed keys: callers build keys from parsed dates, so a bad
 *  key is a programming error, not user input. */
const startOfDayKey = (key: string): Date => {
  const m = DAY_KEY_RE.exec(key);
  if (!m) throw new Error(`Invalid day key: ${key}`);
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
};

/** Server-local 23:59:59.999 of a YYYY-MM-DD key. */
const endOfDayKey = (key: string): Date => {
  const start = startOfDayKey(key);
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    23,
    59,
    59,
    999
  );
};

/** A stored entry date back to its YYYY-MM-DD key via server-local
 *  getters — the inverse of `startOfDayKey`. */
const dayKeyOfEntryDate = (d: Date): string => {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Shed float-accumulation noise from summed hours (0.1 + 0.2 …). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Billable-for-totals test: a no-charge entry is written off, so
 *  it counts toward worked hours but not billable hours. */
const isBillable = (e: { billable: boolean; noCharge: boolean }): boolean =>
  e.billable && !e.noCharge;

// ── Week aggregate ──────────────────────────────────────────────────────

/** One matter's slice of one day's bar. */
export type WeekMatterSegment = {
  matterId: string;
  matterName: string;
  matterColor: string;
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
      date: {
        gte: startOfDayKey(dayKeys[0]!),
        lte: endOfDayKey(dayKeys[dayKeys.length - 1]!),
      },
    },
    select: {
      date: true,
      hours: true,
      billable: true,
      noCharge: true,
      matter: { select: { id: true, name: true, color: true } },
    },
  });

  // day key → matter id → running segment.
  const byDay = new Map<string, Map<string, WeekMatterSegment>>();
  for (const key of dayKeys) byDay.set(key, new Map());

  for (const e of entries) {
    const day = byDay.get(dayKeyOfEntryDate(e.date));
    // Entries between requested keys' bounds always map to one of
    // the keys when the keys are contiguous (a week). A sparse key
    // list would drop in-between days here by design.
    if (!day) continue;
    let seg = day.get(e.matter.id);
    if (!seg) {
      seg = {
        matterId: e.matter.id,
        matterName: e.matter.name,
        matterColor: e.matter.color,
        hours: 0,
        billableHours: 0,
      };
      day.set(e.matter.id, seg);
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
    const dayBillable = round2(
      segments.reduce((sum, s) => sum + s.billableHours, 0)
    );
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
  matterId: string;
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
      date: { gte: startOfDayKey(dayKey), lte: endOfDayKey(dayKey) },
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
    },
  });

  const rows: DayTimeEntry[] = entries.map((e) => ({
    id: e.id,
    matterId: e.matter.id,
    matterName: e.matter.name,
    matterColor: e.matter.color,
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
    billableHours: round2(
      rows.filter(isBillable).reduce((sum, r) => sum + r.hours, 0)
    ),
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
 *  to the timer widget, which writes the TimeEntry on stop. */
export async function getMyRunningTimer(): Promise<RunningTimer | null> {
  const userId = await getCurrentUserId();
  const session = await prisma.timerSession.findUnique({
    where: { userId },
    select: {
      startedAt: true,
      activity: true,
      matter: { select: { id: true, name: true, color: true } },
    },
  });
  if (!session) return null;
  return {
    startedAt: session.startedAt,
    activity: session.activity,
    matterId: session.matter?.id ?? null,
    matterName: session.matter?.name ?? null,
    matterColor: session.matter?.color ?? null,
  };
}
