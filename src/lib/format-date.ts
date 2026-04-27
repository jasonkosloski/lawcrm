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
