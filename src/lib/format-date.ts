/**
 * Centralized date / time formatting.
 *
 * Every callsite in the app should funnel through one of these
 * helpers instead of building strings with `toLocaleDateString` or
 * `date-fns` ad-hoc. Two reasons:
 *
 *  1. **Consistency.** "Apr 15, 2026", "April 15", "4/15" all
 *     mean the same thing but reading three flavors across the
 *     UI is friction. Variants are named ("short", "medium",
 *     "long", "datetime", "time") so callers pick one and the
 *     result is uniform across pages.
 *
 *  2. **Time-zone correctness.** The user's preferred zone lives
 *     on `User.timeZone`. Without piping it through, every date
 *     renders in the server's TZ (which would be UTC in
 *     production), so "today's agenda" would silently misclassify
 *     items for any user not on UTC. These helpers default to the
 *     user's TZ via the optional `tz` arg; pages that already
 *     loaded it pass it in, the rest fall back to the server's
 *     local TZ until they're migrated.
 *
 * Helpers are pure — no async DB lookups. The TZ string is the
 * caller's responsibility to thread in (typically via a getter
 * like `getCurrentUserTimeZone()` server-side).
 */

export type DateFormatVariant =
  | "short" // "Apr 15"
  | "medium" // "Apr 15, 2026"
  | "long" // "April 15, 2026"
  | "full" // "Wed, April 15, 2026"
  | "iso" // "2026-04-15" (ISO date — date inputs)
  | "time" // "3:42 PM"
  | "datetime" // "Apr 15, 3:42 PM"
  | "datetime_long"; // "April 15, 2026 at 3:42 PM"

const FORMAT_OPTS: Record<
  DateFormatVariant,
  Intl.DateTimeFormatOptions
> = {
  short: { month: "short", day: "numeric" },
  medium: { month: "short", day: "numeric", year: "numeric" },
  long: { month: "long", day: "numeric", year: "numeric" },
  full: {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  },
  iso: { year: "numeric", month: "2-digit", day: "2-digit" },
  time: { hour: "numeric", minute: "2-digit" },
  datetime: {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  datetime_long: {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  },
};

/**
 * Format a date for display. Pass a TZ string (IANA name like
 * "America/Denver") to anchor the output to a specific zone — the
 * default falls through to the runtime's local TZ.
 *
 * Returns "—" for null/undefined so callers can render the result
 * directly without a per-callsite null guard.
 */
export function formatDate(
  d: Date | null | undefined,
  variant: DateFormatVariant = "medium",
  tz?: string | null
): string {
  if (!d) return "—";
  if (variant === "iso") {
    // ISO format intentionally ignores the user's TZ — it's used
    // for date <input type="date"> values which are TZ-naive
    // calendar dates. Compute in UTC to match what the input
    // expects.
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }
  const opts: Intl.DateTimeFormatOptions = { ...FORMAT_OPTS[variant] };
  if (tz) opts.timeZone = tz;
  return d.toLocaleString("en-US", opts);
}

/**
 * "5m ago" / "3h ago" / "yesterday" / "Apr 15" — picks the most
 * compact form that's still unambiguous. Useful for activity
 * feeds and timeline entries where the exact timestamp matters
 * less than recency.
 */
export function formatRelative(
  d: Date | null | undefined,
  tz?: string | null
): string {
  if (!d) return "—";
  const now = Date.now();
  const ts = d.getTime();
  const diffMs = now - ts;

  if (diffMs < 60 * 1000) return "just now";
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  // Fall back to a calendar date for older entries.
  return formatDate(d, "medium", tz ?? null);
}

/**
 * Compact day-bucket label for journal-style listings: "Today"
 * / "Yesterday" / "Tuesday" (this week) / "Apr 15" (further
 * back). Caller passes the comparison anchor for testability.
 */
export function formatDayBucket(
  d: Date | null | undefined,
  options: { now?: Date; tz?: string | null } = {}
): string {
  if (!d) return "—";
  const now = options.now ?? new Date();
  const tz = options.tz ?? undefined;

  const startOfDay = (date: Date): number => {
    const c = new Date(date);
    c.setHours(0, 0, 0, 0);
    return c.getTime();
  };
  const today = startOfDay(now);
  const target = startOfDay(d);
  const diffDays = Math.round((today - target) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 0 && diffDays < 7) {
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      ...(tz ? { timeZone: tz } : {}),
    });
  }
  return formatDate(d, "medium", tz);
}

// ── Time-zone arithmetic ───────────────────────────────────────────────
//
// The calendar surfaces (week / month / agenda) need to think in the
// user's TZ end-to-end: build day columns that match what the user
// calls "today", bucket events into the right column regardless of
// where the server runs, and compute DB query bounds that cover the
// user's local week. The helpers below give us that without pulling
// in date-fns-tz — Intl.DateTimeFormat already knows every IANA zone
// + its DST rules.
//
// Key trick: every "Date for a calendar day" we hand around uses
// **noon UTC** of that calendar day instead of midnight. Noon UTC is
// the same calendar day in any zone from UTC-12 to UTC+11 (the only
// regularly-inhabited exception being NZ DST at UTC+13). That makes
// `format(day, "yyyy-MM-dd")` server-side give the right calendar
// date for any user TZ without needing the TZ at the formatting site.

/**
 * Format an instant as a YYYY-MM-DD calendar key in the given TZ.
 *
 * Used to bucket events into day columns: two events at the same
 * instant share a key only if they're on the same calendar day in
 * the user's TZ. Pure Intl call — no library needed.
 */
export function dateKeyInTz(d: Date, tz: string): string {
  // en-CA locale formats dates as YYYY-MM-DD natively, so we don't
  // have to reorder month/day parts.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * UTC instant of a wall-clock time on a given calendar date in the
 * given TZ. e.g. `instantInTz(2026, 4, 26, 0, 0, "America/Denver")`
 * returns `2026-04-26T06:00:00.000Z` (Sunday MDT midnight).
 *
 * Handles DST transitions by iterating: the first guess may land on
 * a different offset than the target, so we apply the offset and
 * try again. Two passes is enough — if a single DST step is wider
 * than 24 hours we have bigger problems.
 */
export function instantInTz(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 2; i++) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(candidate);
    const lookup = (type: string): number => {
      const part = parts.find((p) => p.type === type);
      return part ? Number(part.value) : 0;
    };
    let h = lookup("hour");
    if (h === 24) h = 0; // Some Intl impls emit 24 for midnight.
    const localAtCandidate = Date.UTC(
      lookup("year"),
      lookup("month") - 1,
      lookup("day"),
      h,
      lookup("minute")
    );
    const target = Date.UTC(year, month - 1, day, hour, minute);
    const drift = target - localAtCandidate;
    if (drift === 0) break;
    candidate = new Date(candidate.getTime() + drift);
  }
  return candidate;
}

/**
 * Compute the calendar week containing `focal` in the given TZ.
 *
 * Returns an array of seven day-noon-UTC Dates (one per column —
 * ready to feed into `format(day, "EEE")` / `format(day, "d")`
 * server-side without TZ leakage), plus the UTC instants for the
 * exact start (Sunday 00:00 in TZ) and end (Saturday 23:59 in TZ)
 * of the user's week — those are what the DB query needs.
 *
 * Week starts on Sunday to match the rest of the calendar.
 */
export function calendarWeekInTz(
  focal: Date,
  tz: string
): { days: Date[]; rangeStart: Date; rangeEnd: Date } {
  const focalKey = dateKeyInTz(focal, tz);
  const [fy, fm, fd] = focalKey.split("-").map(Number) as [number, number, number];
  // Noon UTC of the focal date — used purely to compute the weekday.
  // Safe across every TZ from UTC-12 to UTC+11.
  const focalNoon = new Date(Date.UTC(fy, fm - 1, fd, 12));
  const dow = focalNoon.getUTCDay(); // 0 = Sunday
  const sundayNoon = new Date(focalNoon);
  sundayNoon.setUTCDate(sundayNoon.getUTCDate() - dow);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sundayNoon);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d);
  }

  const sunday = days[0]!;
  const saturday = days[6]!;
  const rangeStart = instantInTz(
    sunday.getUTCFullYear(),
    sunday.getUTCMonth() + 1,
    sunday.getUTCDate(),
    0,
    0,
    tz
  );
  const rangeEnd = instantInTz(
    saturday.getUTCFullYear(),
    saturday.getUTCMonth() + 1,
    saturday.getUTCDate(),
    23,
    59,
    tz
  );
  return { days, rangeStart, rangeEnd };
}

/**
 * Compute the month-grid range containing `focal` in the given TZ.
 *
 * Returns the full month-grid (always 6 weeks = 42 day-noon-UTC
 * Dates) plus the UTC instants for the exact start (Sunday of week
 * containing the 1st) and end (Saturday of week containing the
 * last day) of the grid — what the DB query needs.
 */
export function calendarMonthGridInTz(
  focal: Date,
  tz: string
): { days: Date[]; rangeStart: Date; rangeEnd: Date } {
  const focalKey = dateKeyInTz(focal, tz);
  const [fy, fm] = focalKey.split("-").map(Number) as [number, number, number];
  // First day of the month at noon UTC.
  const firstNoon = new Date(Date.UTC(fy, fm - 1, 1, 12));
  // Sunday of the week containing the 1st.
  const dowFirst = firstNoon.getUTCDay();
  const gridStart = new Date(firstNoon);
  gridStart.setUTCDate(gridStart.getUTCDate() - dowFirst);

  // 6 rows × 7 days — covers every month including the rare 6-row
  // ones (a Sunday-start month with 31 days needs the 6th row).
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d);
  }

  const first = days[0]!;
  const last = days[41]!;
  const rangeStart = instantInTz(
    first.getUTCFullYear(),
    first.getUTCMonth() + 1,
    first.getUTCDate(),
    0,
    0,
    tz
  );
  const rangeEnd = instantInTz(
    last.getUTCFullYear(),
    last.getUTCMonth() + 1,
    last.getUTCDate(),
    23,
    59,
    tz
  );
  return { days, rangeStart, rangeEnd };
}

/** Server-side helper that resolves the current user's TZ from
 *  the DB. Returns the schema default when no user is logged in
 *  yet (build-time / seed paths). */
export async function getCurrentUserTimeZone(): Promise<string> {
  // Lazy-imported to keep this file usable from client components
  // that bring in the formatters but never call this getter.
  const { prisma } = await import("@/lib/prisma");
  const { getCurrentUserId } = await import("@/lib/current-user");
  try {
    const userId = await getCurrentUserId();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timeZone: true },
    });
    return user?.timeZone ?? "America/Denver";
  } catch {
    return "America/Denver";
  }
}
