/**
 * Notification sweeps — server-only.
 *
 * Scheduled-ish notification producers that don't hang off a user
 * mutation. Today: the deadline sweep — "deadline_approaching" at
 * 7 days and again at 1 day before the due date, and a one-time
 * "deadline_overdue" once the due date passes while the deadline is
 * still open.
 *
 * Recipients: the deadline's owner; ownerless deadlines fan out to
 * every ACTIVE member of the matter's team (removedAt = null).
 *
 * Idempotency — the sweep may run any number of times (every
 * dashboard load races with the cron): before writing, it checks for
 * an existing notification with the same (userId, type, link). The
 * threshold is encoded in the link's `due` query param
 * (`due=7d` / `due=1d` / `due=overdue`), which makes the 7-day and
 * 1-day notices distinct one-time events while keeping the link a
 * working click-target (the deadlines tab ignores unknown params).
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

/** First heads-up: deadline due within a week. */
export const DEADLINE_SOON_THRESHOLD_DAYS = 7;
/** Second, louder heads-up: deadline due within a day. */
export const DEADLINE_IMMINENT_THRESHOLD_DAYS = 1;
/** Dashboard-load throttle — at most one sweep per instance/hour. */
export const SWEEP_MIN_INTERVAL_MS = 60 * 60 * 1000;

export type SweepResult = {
  /** Open deadlines inside the widest window (incl. overdue). */
  scanned: number;
  /** Notification rows actually written this run. */
  created: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The three sweep buckets a deadline can fall into. Exactly one
 *  applies per run — a deadline due tomorrow gets its 1d notice, not
 *  a simultaneous 7d + 1d double-ping. The 7d notice still lands for
 *  deadlines seen while further out; each bucket is its own one-time
 *  event keyed by the link's `due` param. */
type Bucket = {
  type: NotificationType;
  /** Link token that makes this bucket's notification unique. */
  dueToken: "7d" | "1d" | "overdue";
  title: (deadlineTitle: string) => string;
};

function bucketFor(dueDate: Date, now: Date): Bucket | null {
  const delta = dueDate.getTime() - now.getTime();
  if (delta < 0) {
    return {
      type: "deadline_overdue",
      dueToken: "overdue",
      title: (t) => `Deadline overdue: ${t}`,
    };
  }
  if (delta <= DEADLINE_IMMINENT_THRESHOLD_DAYS * DAY_MS) {
    return {
      type: "deadline_approaching",
      dueToken: "1d",
      title: (t) => `Deadline due within 1 day: ${t}`,
    };
  }
  if (delta <= DEADLINE_SOON_THRESHOLD_DAYS * DAY_MS) {
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
 * notifications. Idempotent (see module docstring); safe to call
 * concurrently or repeatedly. Throws on DB failure so the cron
 * route can surface a 500; the dashboard entry point below wraps it
 * fire-and-forget.
 *
 * `now` is injectable for tests ("advance a week, sweep again").
 */
export async function runDeadlineNotificationSweep(
  now: Date = new Date()
): Promise<SweepResult> {
  const soonCutoff = new Date(
    now.getTime() + DEADLINE_SOON_THRESHOLD_DAYS * DAY_MS
  );

  // Everything open and due within the widest window — including
  // already-past due dates (status "open" with dueDate < now is the
  // overdue-flip case).
  const deadlines = await prisma.deadline.findMany({
    where: { status: "open", dueDate: { lte: soonCutoff } },
    select: {
      id: true,
      title: true,
      dueDate: true,
      ownerId: true,
      matterId: true,
      matter: {
        select: {
          name: true,
          isArchived: true,
          teamMembers: {
            where: { removedAt: null },
            select: { userId: true },
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
    const bucket = bucketFor(d.dueDate, now);
    if (!bucket) continue;

    const recipients = d.ownerId
      ? [d.ownerId]
      : d.matter.teamMembers.map((m) => m.userId);
    if (recipients.length === 0) continue;

    // `due` token in the link = the idempotency discriminator per
    // threshold. `deadline` pins the link to the specific row so two
    // deadlines on the same matter don't collide.
    const link = `/matters/${d.matterId}/deadlines?deadline=${d.id}&due=${bucket.dueToken}`;
    for (const userId of new Set(recipients)) {
      candidates.push({
        userId,
        type: bucket.type,
        title: bucket.title(d.title),
        body: d.matter.name,
        link,
        matterId: d.matterId,
      });
    }
  }

  if (candidates.length === 0) return { scanned: deadlines.length, created: 0 };

  // One-time-per-(user, type, link): drop candidates that already
  // have a row. The link encodes deadline id + threshold, so this is
  // exactly the "same notice for the same event" check.
  const existing = await prisma.notification.findMany({
    where: {
      link: { in: Array.from(new Set(candidates.map((c) => c.link))) },
      type: { in: ["deadline_approaching", "deadline_overdue"] },
    },
    select: { userId: true, type: true, link: true },
  });
  const seen = new Set(existing.map((e) => `${e.userId}|${e.type}|${e.link}`));
  const fresh = candidates.filter(
    (c) => !seen.has(`${c.userId}|${c.type}|${c.link}`)
  );

  if (fresh.length > 0) {
    await prisma.notification.createMany({ data: fresh });
    // Refresh the bell badge. Guarded: revalidatePath is a no-go in
    // some invocation contexts (e.g. mid-render on the dashboard
    // fire-and-forget path) — the rows are already written and the
    // bell's 60s poll picks them up regardless.
    try {
      revalidatePath("/", "layout");
    } catch (err) {
      console.warn("[notification-sweeps] revalidate skipped", err);
    }
  }

  return { scanned: deadlines.length, created: fresh.length };
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
