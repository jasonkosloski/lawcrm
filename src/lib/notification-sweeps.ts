/**
 * Notification sweeps — server-only.
 *
 * Scheduled-ish notification producers that don't hang off a user
 * mutation. Today: the deadline sweep — "deadline_approaching" at
 * 7 days, 1 day and on the due day itself, and a one-time
 * "deadline_overdue" once the due date has fully passed while the
 * deadline is still open.
 *
 * Calendar days, not instants (ADR-012): `Deadline.dueDate` is a
 * date-only value (UTC midnight of the due day). "Days until due" is
 * the whole-calendar-day distance from the RECIPIENT's today (their
 * profile time zone) to that date — 0 = due today, negative = overdue
 * — so a deadline due Oct 20 is overdue from Oct 21, never at the
 * start of Oct 20 (or the evening of Oct 19 in Denver).
 *
 * Recipients: the deadline's owner when the owner is still active;
 * otherwise (ownerless, or the owner was deactivated) every ACTIVE
 * member of the matter's team (removedAt = null, isActive = true) —
 * a departed associate must not swallow notices the team needs.
 *
 * Idempotency — the sweep may run any number of times (every
 * dashboard load races with the cron): before writing, it checks for
 * an existing notification with the same (userId, type, link). The
 * link encodes the deadline id, the bucket (`due=7d` / `1d` /
 * `today` / `overdue`) AND the due date it was computed for
 * (`on=YYYY-MM-DD`), so each threshold is a distinct one-time event
 * PER due date: rescheduling a deadline (an extension, an SOL
 * correction) starts a fresh 7d/1d/today/overdue cycle instead of
 * being silenced by notices sent for the old date. The link stays a
 * working click-target (the deadlines tab ignores unknown params).
 * Rollout note: notices written before `on=` existed carry no date,
 * so each in-window deadline gets one extra notice per bucket the
 * first time the new sweep runs — deliberately accepted over the
 * alternative of missing a re-notice.
 *
 * Concurrency — the whole read-check-write runs in one transaction
 * behind a Postgres advisory lock (`pg_advisory_xact_lock`), so the
 * cron and a dashboard-triggered sweep on another instance take turns
 * and the second one sees the first one's rows. (No unique index
 * exists to enforce it in the schema: the table legitimately repeats
 * (user, type, link) for other notification types.)
 *
 * Throttle — `maybeRunDeadlineNotificationSweep()` (the dashboard
 * entry point) skips when a sweep already ran in the last hour.
 * Mechanism: a module-level in-memory timestamp, i.e. per server
 * instance. Chosen over the "newest sweep-created notification's
 * createdAt" derivation because a firm with no qualifying deadlines
 * never creates a sweep notification and would re-scan on every
 * page load forever. The trade-off (serverless cold starts / extra
 * instances reset the clock) is fine: a redundant run is cheap and
 * the (userId, type, link) check keeps it duplicate-free. The
 * platform cron at /api/notification-sweep bypasses the throttle —
 * its schedule IS the throttle.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/lib/notifications";
import {
  daysBetweenKeys,
  dateOnlyKey,
  todayKey,
} from "@/lib/format-date";

/** First heads-up: deadline due within a week. */
export const DEADLINE_SOON_THRESHOLD_DAYS = 7;
/** Second, louder heads-up: deadline due within a day. */
export const DEADLINE_IMMINENT_THRESHOLD_DAYS = 1;
/** Dashboard-load throttle — at most one sweep per instance/hour. */
export const SWEEP_MIN_INTERVAL_MS = 60 * 60 * 1000;

/** Recipients default to this zone when the user row has none. */
const FALLBACK_TIME_ZONE = "America/Denver";

export type SweepResult = {
  /** Open deadlines inside the widest window (incl. overdue). */
  scanned: number;
  /** Notification rows actually written this run. */
  created: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Arbitrary constant key for the sweep's advisory lock. */
const SWEEP_LOCK_KEY = 7_302_026;

/** The sweep buckets a deadline can fall into. Exactly one applies
 *  per recipient per run — a deadline due tomorrow gets its 1d
 *  notice, not a simultaneous 7d + 1d double-ping. Each bucket is
 *  its own one-time event keyed by the link's `due` param (and the
 *  due date in `on`). */
type Bucket = {
  type: NotificationType;
  /** Link token that makes this bucket's notification unique. */
  dueToken: "7d" | "1d" | "today" | "overdue";
  title: (deadlineTitle: string) => string;
};

/**
 * Bucket for a deadline `days` calendar days from the recipient's
 * today (0 = due today, negative = overdue); null when it is more
 * than a week out.
 */
export function bucketForDaysUntil(days: number): Bucket | null {
  if (days < 0) {
    return {
      type: "deadline_overdue",
      dueToken: "overdue",
      title: (t) => `Deadline overdue: ${t}`,
    };
  }
  if (days === 0) {
    return {
      type: "deadline_approaching",
      dueToken: "today",
      title: (t) => `Deadline due today: ${t}`,
    };
  }
  if (days <= DEADLINE_IMMINENT_THRESHOLD_DAYS) {
    return {
      type: "deadline_approaching",
      dueToken: "1d",
      title: (t) => `Deadline due within 1 day: ${t}`,
    };
  }
  if (days <= DEADLINE_SOON_THRESHOLD_DAYS) {
    return {
      type: "deadline_approaching",
      dueToken: "7d",
      title: (t) => `Deadline due within 7 days: ${t}`,
    };
  }
  return null;
}

/**
 * The sweep proper — scan open deadlines, write the missing
 * notifications. Idempotent (see module docstring) and serialized by
 * an advisory lock, so it is safe to call concurrently or
 * repeatedly. Throws on DB failure so the cron route can surface a
 * 500; the dashboard entry point below wraps it fire-and-forget.
 *
 * `now` is injectable for tests ("advance a week, sweep again").
 */
export async function runDeadlineNotificationSweep(
  now: Date = new Date(),
  opts: {
    /** Refresh cached layouts so the bell badge updates. Only valid
     *  from a Route Handler / Server Action (the cron route passes
     *  true) — Next refuses revalidatePath during a page render,
     *  which is where the dashboard's fire-and-forget call runs. */
    revalidate?: boolean;
  } = {}
): Promise<SweepResult> {
  // Widest window across recipient zones: "today" can be a day ahead
  // of (or behind) UTC, so over-fetch by two days and let the
  // per-recipient day math decide.
  const soonCutoff = new Date(
    now.getTime() + (DEADLINE_SOON_THRESHOLD_DAYS + 2) * DAY_MS
  );

  const result = await prisma.$transaction(
    async (tx): Promise<SweepResult> => {
      // Serialize overlapping sweeps (cron vs. dashboard, or two
      // instances). Blocking, not try-lock: the second run waits and
      // then sees the first run's rows, so it still completes
      // correctly. Released automatically at commit/rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SWEEP_LOCK_KEY})`;

      // Everything open and due within the widest window — including
      // already-past due dates (status "open" with a past dueDate is
      // the overdue case).
      const deadlines = await tx.deadline.findMany({
        where: { status: "open", dueDate: { lte: soonCutoff } },
        select: {
          id: true,
          title: true,
          dueDate: true,
          ownerId: true,
          matterId: true,
          owner: { select: { isActive: true, timeZone: true } },
          matter: {
            select: {
              name: true,
              isArchived: true,
              teamMembers: {
                where: { removedAt: null, user: { isActive: true } },
                select: { userId: true, user: { select: { timeZone: true } } },
              },
            },
          },
        },
      });

      type Candidate = {
        userId: string;
        type: NotificationType;
        title: string;
        body: string;
        link: string;
        matterId: string;
      };
      const candidates: Candidate[] = [];

      for (const d of deadlines) {
        // Archived matters keep their rows but shouldn't ping anyone.
        if (d.matter.isArchived) continue;

        // Active owner → just them. Ownerless, or the owner was
        // deactivated → the matter's active team instead.
        const recipients: { userId: string; tz: string }[] =
          d.ownerId && d.owner?.isActive
            ? [
                {
                  userId: d.ownerId,
                  tz: d.owner.timeZone || FALLBACK_TIME_ZONE,
                },
              ]
            : d.matter.teamMembers.map((m) => ({
                userId: m.userId,
                tz: m.user.timeZone || FALLBACK_TIME_ZONE,
              }));
        if (recipients.length === 0) continue;

        const dueKey = dateOnlyKey(d.dueDate);
        const seenRecipient = new Set<string>();
        for (const r of recipients) {
          if (seenRecipient.has(r.userId)) continue;
          seenRecipient.add(r.userId);

          // Whole calendar days from the recipient's today to the
          // due date — never an instant comparison.
          const days = daysBetweenKeys(todayKey(r.tz, now), dueKey);
          const bucket = bucketForDaysUntil(days);
          if (!bucket) continue;

          // `due` = threshold, `on` = the due date it was computed
          // for: together with `deadline` they are the idempotency
          // key. A rescheduled deadline gets a new `on`, hence a new
          // cycle of notices.
          const link = `/matters/${d.matterId}/deadlines?deadline=${d.id}&due=${bucket.dueToken}&on=${dueKey}`;
          candidates.push({
            userId: r.userId,
            type: bucket.type,
            title: bucket.title(d.title),
            body: d.matter.name,
            link,
            matterId: d.matterId,
          });
        }
      }

      if (candidates.length === 0) {
        return { scanned: deadlines.length, created: 0 };
      }

      // One-time-per-(user, type, link): drop candidates that already
      // have a row. The link encodes deadline id + threshold + due
      // date, so this is exactly the "same notice for the same event"
      // check.
      const existing = await tx.notification.findMany({
        where: {
          link: { in: Array.from(new Set(candidates.map((c) => c.link))) },
          type: { in: ["deadline_approaching", "deadline_overdue"] },
        },
        select: { userId: true, type: true, link: true },
      });
      const seen = new Set(
        existing.map((e) => `${e.userId}|${e.type}|${e.link}`)
      );
      const fresh = candidates.filter(
        (c) => !seen.has(`${c.userId}|${c.type}|${c.link}`)
      );

      if (fresh.length > 0) {
        await tx.notification.createMany({ data: fresh });
      }
      return { scanned: deadlines.length, created: fresh.length };
    },
    // Waiting on the advisory lock counts against the interactive
    // transaction's clock; a sweep is a handful of queries.
    { timeout: 30_000, maxWait: 30_000 }
  );

  // Without revalidation (dashboard path) the bell's 60s poll still
  // picks the new rows up.
  if (opts.revalidate && result.created > 0) revalidatePath("/", "layout");
  return result;
}

// Per-instance throttle clock. See module docstring for why this is
// in-memory rather than derived from notification rows.
let lastSweepStartedAt: number | null = null;

/** Test hook — clears the throttle clock between cases. */
export function resetSweepThrottleForTests(): void {
  lastSweepStartedAt = null;
}

/**
 * Throttled, non-throwing entry point for high-traffic page loads
 * (the dashboard calls this fire-and-forget). Skips entirely when a
 * sweep started within the last `SWEEP_MIN_INTERVAL_MS` on this
 * instance; swallows failures with a warn so a broken sweep can
 * never take down the page.
 */
export async function maybeRunDeadlineNotificationSweep(
  now: Date = new Date()
): Promise<SweepResult & { ran: boolean }> {
  if (
    lastSweepStartedAt !== null &&
    now.getTime() - lastSweepStartedAt < SWEEP_MIN_INTERVAL_MS
  ) {
    return { ran: false, scanned: 0, created: 0 };
  }
  // Stamp BEFORE running so concurrent page loads don't stampede and
  // a throwing sweep doesn't retry on every request for the hour.
  lastSweepStartedAt = now.getTime();
  try {
    const result = await runDeadlineNotificationSweep(now);
    return { ran: true, ...result };
  } catch (err) {
    console.warn("[notification-sweeps] deadline sweep failed", err);
    return { ran: true, scanned: 0, created: 0 };
  }
}
