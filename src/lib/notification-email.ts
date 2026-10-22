/**
 * Notification email delivery — server-only.
 *
 * Outbox: every `Notification` row carries `emailState`. New rows start
 * "pending" (column default), so every producer is covered, including
 * the deadline sweep, which writes rows in its own transaction rather
 * than through `createNotification`. The cron at /api/notification-email
 * calls `runNotificationEmailDelivery()` every 5 minutes.
 *
 * States: pending → (decided) skipped | held | sending → sent | failed.
 * Each pending row goes through `decideEmail`
 * (src/lib/notification-email-policy.ts):
 *   - skip  → "skipped" (category Off, matter muted, read in the app,
 *             recipient inactive, or recipient lost access to the
 *             matter — checked at send time so ethical walls hold).
 *   - hold  → "held" for the recipient's daily digest. Held rows leave
 *             the pending scan, so a pile of them never starves
 *             instant mail for everyone else.
 *   - send  → "sending" (claimed), then emailed.
 *
 * Claim, commit, then send. Deciding and claiming run in a SHORT
 * transaction behind a Postgres advisory lock, so overlapping runs
 * never claim the same row. Emails go out after that commit, outside
 * any transaction, and each row is stamped on its own as it sends. A
 * run that dies mid-batch (function timeout, crash) therefore never
 * rolls back stamps for mail already delivered; its unsent claims sit
 * in "sending" until RECLAIM_AFTER_MS passes and a later run takes
 * them back — at worst one duplicate for the row in flight. Sends are
 * paced (Resend allows ~2 requests/second) and a run stops claiming
 * new sends after its time budget, releasing the rest to the next run.
 *
 * Failures: an instant send retries on later runs and turns "failed" at
 * NOTIFICATION_EMAIL_MAX_ATTEMPTS. A failed digest counts an attempt on
 * each of its rows the same way and is retried on the next run.
 *
 * Digest: once the recipient's local time (profile zone) reaches
 * NOTIFICATION_EMAIL_DIGEST_HOUR and no digest went out on that local
 * day (`User.notificationDigestSentOn`), held rows created BEFORE that
 * morning's cutoff are re-decided (preferences may have changed) and
 * the survivors go out as one email. Rows created after the cutoff
 * wait for tomorrow's digest, so it is always "the last day's
 * summary", never a delayed copy of the first notice after 07:00.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { sendEmail } from "@/lib/email/send";
import { canAccessMatter } from "@/lib/matter-access";
import { staffAppUrl } from "@/lib/staff-authorized-parties";
import { dateOnlyKey, instantInTz, parseDateOnly, todayKey } from "@/lib/format-date";
import {
  categoryOf,
  effectiveMode,
  type NotificationCategory,
} from "@/lib/notification-categories";
import { decideEmail, type EmailDecision } from "@/lib/notification-email-policy";
import { digestNotificationEmail, instantNotificationEmail } from "@/lib/notification-emails";

export const NOTIFICATION_EMAIL_DIGEST_HOUR = 7;
export const NOTIFICATION_EMAIL_MAX_ATTEMPTS = 3;
/** Rows decided per run. With pacing, ~50 sends fit the time budget. */
export const NOTIFICATION_EMAIL_BATCH = 50;

/** A "sending" claim older than this belongs to a run that died. Well
 *  past the route's 60 s maxDuration. */
const RECLAIM_AFTER_MS = 10 * 60 * 1000;
/** Stop starting new sends after this long (route maxDuration is 60 s). */
const DEFAULT_BUDGET_MS = 30_000;
/** Minimum gap between sends: Resend's default limit is 2 requests/s. */
const DEFAULT_MIN_SEND_INTERVAL_MS = 600;

/** Arbitrary constant key for this worker's advisory lock (the
 *  deadline sweep uses 7_302_026). */
const EMAIL_LOCK_KEY = 7_302_027;

/** Recipients default to this zone when the user row has none. */
const FALLBACK_TIME_ZONE = "America/Denver";

export type EmailDeliveryResult = {
  sent: number;
  skipped: number;
  /** Rows moved to "held" for a later digest this run. */
  held: number;
  failed: number;
  digests: number;
};

export type EmailDeliveryOptions = {
  /** Stop starting new sends after this many ms of wall-clock time. */
  budgetMs?: number;
  /** Minimum ms between two sends. */
  minSendIntervalMs?: number;
};

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type Row = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  matterId: string | null;
  readAt: Date | null;
  emailAttempts: number;
};

type Recipient = {
  email: string;
  isActive: boolean;
  timeZone: string;
  notificationDigestSentOn: Date | null;
};

type InstantJob = { row: Row; to: string };
type DigestJob = {
  userId: string;
  to: string;
  rows: Row[];
  previousSentOn: Date | null;
  /** Recipient-local digest day (YYYY-MM-DD). */
  day: string;
};

const ROW_SELECT = {
  id: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  link: true,
  matterId: true,
  readAt: true,
  emailAttempts: true,
} as const;

function localHour(now: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: tz,
  }).format(now);
  return Number(h);
}

/** The instant the digest hour starts on local day `dayKey`. */
function digestCutoff(dayKey: string, tz: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  return instantInTz(y, m, d, NOTIFICATION_EMAIL_DIGEST_HOUR, 0, tz);
}

/** Loads recipients, preferences and mutes for `userIds`, and returns a
 *  decider bound to them (matter access memoised per user + matter). */
async function loadContext(tx: Tx, userIds: string[]) {
  const [users, prefs, mutes] = await Promise.all([
    tx.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        email: true,
        isActive: true,
        timeZone: true,
        notificationDigestSentOn: true,
      },
    }),
    tx.notificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, category: true, emailMode: true },
    }),
    tx.notificationMatterMute.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, matterId: true },
    }),
  ]);
  const recipients = new Map<string, Recipient>(users.map((u) => [u.id, u]));
  const modes = new Map(prefs.map((p) => [`${p.userId}:${p.category}`, p.emailMode]));
  const muted = new Set(mutes.map((m) => `${m.userId}:${m.matterId}`));
  const access = new Map<string, Promise<boolean>>();

  async function decide(row: Row): Promise<EmailDecision> {
    const user = recipients.get(row.userId);
    if (!user) return "skip";
    const category: NotificationCategory = categoryOf(row.type);
    let hasMatterAccess = true;
    if (row.matterId && user.isActive) {
      const key = `${row.userId}:${row.matterId}`;
      if (!access.has(key)) access.set(key, canAccessMatter(row.userId, row.matterId));
      hasMatterAccess = await access.get(key)!;
    }
    return decideEmail({
      userActive: user.isActive,
      read: row.readAt !== null,
      hasMatterAccess,
      category,
      mode: effectiveMode(category, modes.get(`${row.userId}:${category}`)),
      muted: row.matterId !== null && muted.has(`${row.userId}:${row.matterId}`),
    });
  }

  return { recipients, decide };
}

const LOCKED_TX = { maxWait: 15_000, timeout: 15_000 };

/** Decide pending (and abandoned) rows; claim the ones to send now. */
async function claimInstant(now: Date, result: EmailDeliveryResult): Promise<InstantJob[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EMAIL_LOCK_KEY})`;
    const rows = await tx.notification.findMany({
      where: {
        OR: [
          { emailState: "pending" },
          {
            emailState: "sending",
            emailClaimedAt: { lt: new Date(now.getTime() - RECLAIM_AFTER_MS) },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: NOTIFICATION_EMAIL_BATCH,
      select: ROW_SELECT,
    });
    if (rows.length === 0) return [];
    const ctx = await loadContext(tx, [...new Set(rows.map((r) => r.userId))]);
    const jobs: InstantJob[] = [];
    for (const row of rows) {
      const decision = await ctx.decide(row);
      if (decision === "send") {
        await tx.notification.update({
          where: { id: row.id },
          data: { emailState: "sending", emailClaimedAt: now },
        });
        jobs.push({ row, to: ctx.recipients.get(row.userId)!.email });
      } else {
        await tx.notification.update({
          where: { id: row.id },
          data: { emailState: decision === "hold" ? "held" : "skipped" },
        });
        if (decision === "hold") result.held++;
        else result.skipped++;
      }
    }
    return jobs;
  }, LOCKED_TX);
}

/** For recipients whose digest is due: re-decide their held rows and
 *  claim the survivors plus the local day. */
async function claimDigests(now: Date, result: EmailDeliveryResult): Promise<DigestJob[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EMAIL_LOCK_KEY})`;
    const heldUsers = await tx.notification.findMany({
      where: { emailState: "held" },
      distinct: ["userId"],
      select: { userId: true },
    });
    if (heldUsers.length === 0) return [];
    const ctx = await loadContext(
      tx,
      heldUsers.map((h) => h.userId),
    );
    const jobs: DigestJob[] = [];
    for (const [userId, user] of ctx.recipients) {
      const tz = user.timeZone || FALLBACK_TIME_ZONE;
      const today = todayKey(tz, now);
      if (localHour(now, tz) < NOTIFICATION_EMAIL_DIGEST_HOUR) continue;
      const previous = user.notificationDigestSentOn;
      if (previous && dateOnlyKey(previous) >= today) continue;
      const held = await tx.notification.findMany({
        where: {
          userId,
          emailState: "held",
          createdAt: { lt: digestCutoff(today, tz) },
        },
        orderBy: { createdAt: "asc" },
        select: ROW_SELECT,
      });
      const rows: Row[] = [];
      for (const row of held) {
        const decision = await ctx.decide(row);
        if (decision === "hold") rows.push(row);
        else {
          // "send": the category went back to Instant; the next instant
          // pass emails it on its own.
          await tx.notification.update({
            where: { id: row.id },
            data: { emailState: decision === "skip" ? "skipped" : "pending" },
          });
          if (decision === "skip") result.skipped++;
        }
      }
      if (rows.length === 0) continue;
      await tx.notification.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { emailState: "sending", emailClaimedAt: now },
      });
      await tx.user.update({
        where: { id: userId },
        data: { notificationDigestSentOn: parseDateOnly(today) },
      });
      jobs.push({ userId, to: user.email, rows, previousSentOn: previous, day: today });
    }
    return jobs;
  }, LOCKED_TX);
}

/** Records a failed attempt on claimed rows: back to `retryState`, or
 *  "failed" once a row reaches the attempt cap. */
async function recordFailure(rows: Row[], retryState: "pending" | "held"): Promise<number> {
  let failed = 0;
  for (const row of rows) {
    const attempts = row.emailAttempts + 1;
    const giveUp = attempts >= NOTIFICATION_EMAIL_MAX_ATTEMPTS;
    await prisma.notification.updateMany({
      where: { id: row.id, emailState: "sending" },
      data: {
        emailAttempts: attempts,
        emailState: giveUp ? "failed" : retryState,
        emailClaimedAt: null,
      },
    });
    if (giveUp) failed++;
  }
  return failed;
}

/** Hands unsent digest claims back: rows to "held", day un-claimed. */
async function releaseDigests(jobs: DigestJob[]): Promise<void> {
  for (const rest of jobs) {
    await prisma.notification.updateMany({
      where: { id: { in: rest.rows.map((r) => r.id) }, emailState: "sending" },
      data: { emailState: "held", emailClaimedAt: null },
    });
    await prisma.user.update({
      where: { id: rest.userId },
      data: { notificationDigestSentOn: rest.previousSentOn },
    });
  }
}

/** Stable across retries/reclaims of the same digest: user + local day
 *  + the exact row set. */
function digestIdempotencyKey(job: DigestJob): string {
  const ids = job.rows
    .map((r) => r.id)
    .sort()
    .join(",");
  const hash = createHash("sha256").update(ids).digest("hex").slice(0, 24);
  return `notification-digest-${job.userId}-${job.day}-${hash}`;
}

/**
 * One delivery run. Throws only on database failure (the cron route
 * turns that into a 500); email failures are counted and retried.
 * `now` is injectable for tests; the time budget and pacing use the
 * real clock.
 */
export async function runNotificationEmailDelivery(
  now: Date = new Date(),
  opts: EmailDeliveryOptions = {},
): Promise<EmailDeliveryResult> {
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const interval = opts.minSendIntervalMs ?? DEFAULT_MIN_SEND_INTERVAL_MS;
  const startedAt = Date.now();
  const result: EmailDeliveryResult = {
    sent: 0,
    skipped: 0,
    held: 0,
    failed: 0,
    digests: 0,
  };
  const baseUrl = staffAppUrl();
  if (!baseUrl) {
    console.warn("[notification-email] no staff app URL (STAFF_ORIGINS); nothing sent");
    return result;
  }

  let sends = 0;
  let lastSendAt = 0;
  /** Waits out the pacing gap; false once the run is over budget. */
  const mayStartSend = async (): Promise<boolean> => {
    if (sends > 0 && Date.now() - startedAt >= budgetMs) return false;
    const wait = lastSendAt + interval - Date.now();
    if (sends > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait));
    sends++;
    lastSendAt = Date.now();
    return true;
  };

  const instant = await claimInstant(now, result);
  for (let i = 0; i < instant.length; i++) {
    if (!(await mayStartSend())) {
      // Over budget: hand the unsent claims straight back.
      await prisma.notification.updateMany({
        where: { id: { in: instant.slice(i).map((j) => j.row.id) }, emailState: "sending" },
        data: { emailState: "pending", emailClaimedAt: null },
      });
      return result;
    }
    const { row, to } = instant[i];
    const res = await sendEmail({
      to,
      ...instantNotificationEmail(row, baseUrl),
      idempotencyKey: `notification-${row.id}`,
    });
    if (!res.ok && res.code === "not_configured") {
      // Deployment problem, not a delivery failure: no attempt is
      // burned. Hand every unsent claim back and stop the run.
      console.warn("[notification-email] email is not configured; releasing claims", res.error);
      await prisma.notification.updateMany({
        where: { id: { in: instant.slice(i).map((j) => j.row.id) }, emailState: "sending" },
        data: { emailState: "pending", emailClaimedAt: null },
      });
      return result;
    }
    if (res.ok) {
      await prisma.notification.updateMany({
        where: { id: row.id, emailState: "sending" },
        data: { emailState: "sent", emailedAt: now, emailClaimedAt: null },
      });
      result.sent++;
    } else {
      const failed = await recordFailure([row], "pending");
      if (failed) {
        result.failed++;
        console.warn("[notification-email] giving up on notification", row.id, res.error);
      }
    }
  }

  const digests = await claimDigests(now, result);
  for (let i = 0; i < digests.length; i++) {
    const job = digests[i];
    if (!(await mayStartSend())) {
      // Over budget: release every unsent digest and its day claim.
      await releaseDigests(digests.slice(i));
      return result;
    }
    const res = await sendEmail({
      to: job.to,
      ...digestNotificationEmail(job.rows, baseUrl),
      idempotencyKey: digestIdempotencyKey(job),
    });
    if (!res.ok && res.code === "not_configured") {
      // Deployment problem, not a delivery failure: no attempt burned.
      console.warn("[notification-email] email is not configured; releasing digests", res.error);
      await releaseDigests(digests.slice(i));
      return result;
    }
    if (res.ok) {
      await prisma.notification.updateMany({
        where: { id: { in: job.rows.map((r) => r.id) }, emailState: "sending" },
        data: { emailState: "sent", emailedAt: now, emailClaimedAt: null },
      });
      result.sent += job.rows.length;
      result.digests++;
    } else {
      console.warn("[notification-email] digest failed", job.userId, res.error);
      result.failed += await recordFailure(job.rows, "held");
      // Un-claim the day so the next run retries.
      await prisma.user.update({
        where: { id: job.userId },
        data: { notificationDigestSentOn: job.previousSentOn },
      });
    }
  }

  return result;
}
