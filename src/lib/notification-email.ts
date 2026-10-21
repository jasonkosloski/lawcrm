/**
 * Notification email delivery — server-only.
 *
 * Outbox: every `Notification` row carries `emailState`. New rows start
 * "pending" (column default), so every producer is covered, including
 * the deadline sweep, which writes rows in its own transaction rather
 * than through `createNotification`. The cron at /api/notification-email
 * calls `runNotificationEmailDelivery()` every 5 minutes; it decides
 * each pending row with `decideEmail` (src/lib/notification-email-policy.ts):
 *
 *   - send  → email now; "sent" on success, else emailAttempts + 1 and
 *             "failed" at NOTIFICATION_EMAIL_MAX_ATTEMPTS.
 *   - skip  → "skipped" (category Off, matter muted, read in the app,
 *             recipient inactive, or recipient lost access to the
 *             matter — checked at send time so ethical walls hold).
 *   - hold  → stays "pending" for the recipient's daily digest.
 *
 * Digest: once the recipient's local time (profile zone) reaches
 * NOTIFICATION_EMAIL_DIGEST_HOUR and no digest went out on that local
 * day (`User.notificationDigestSentOn`), every held row is re-decided
 * (preferences may have changed since) and the survivors go out in one
 * email. A failed digest stamps nothing and is retried next tick.
 *
 * Concurrency: the whole run holds a Postgres advisory lock, sends
 * included, so overlapping runs take turns and the later one finds the
 * rows already stamped — each row is emailed once. Volume is one firm's
 * notifications, capped at NOTIFICATION_EMAIL_BATCH rows per run.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import { canAccessMatter } from "@/lib/matter-access";
import { staffAppUrl } from "@/lib/staff-authorized-parties";
import { dateOnlyKey, parseDateOnly, todayKey } from "@/lib/format-date";
import {
  categoryOf,
  effectiveMode,
  type NotificationCategory,
} from "@/lib/notification-categories";
import { decideEmail, type EmailDecision } from "@/lib/notification-email-policy";
import {
  digestNotificationEmail,
  instantNotificationEmail,
} from "@/lib/notification-emails";

export const NOTIFICATION_EMAIL_DIGEST_HOUR = 7;
export const NOTIFICATION_EMAIL_MAX_ATTEMPTS = 3;
export const NOTIFICATION_EMAIL_BATCH = 200;

/** Arbitrary constant key for this worker's advisory lock (the
 *  deadline sweep uses 7_302_026). */
const EMAIL_LOCK_KEY = 7_302_027;

/** Recipients default to this zone when the user row has none. */
const FALLBACK_TIME_ZONE = "America/Denver";

export type EmailDeliveryResult = {
  sent: number;
  skipped: number;
  /** Rows the instant pass left pending for a digest. */
  held: number;
  failed: number;
  digests: number;
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

async function sendInstant(
  tx: Tx,
  row: Row,
  to: string,
  baseUrl: string,
  now: Date,
  result: EmailDeliveryResult
): Promise<void> {
  const res = await sendEmail({ to, ...instantNotificationEmail(row, baseUrl) });
  if (res.ok) {
    await tx.notification.update({
      where: { id: row.id },
      data: { emailState: "sent", emailedAt: now },
    });
    result.sent++;
    return;
  }
  const attempts = row.emailAttempts + 1;
  const failed = attempts >= NOTIFICATION_EMAIL_MAX_ATTEMPTS;
  await tx.notification.update({
    where: { id: row.id },
    data: { emailAttempts: attempts, ...(failed ? { emailState: "failed" } : {}) },
  });
  if (failed) {
    result.failed++;
    console.warn("[notification-email] giving up on notification", row.id, res.error);
  }
}

/**
 * One delivery run. Throws only on database failure (the cron route
 * turns that into a 500); email failures are counted and retried.
 * `now` is injectable for tests.
 */
export async function runNotificationEmailDelivery(
  now: Date = new Date()
): Promise<EmailDeliveryResult> {
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

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EMAIL_LOCK_KEY})`;

      // Instant pass over the oldest pending rows.
      const rows = await tx.notification.findMany({
        where: { emailState: "pending" },
        orderBy: { createdAt: "asc" },
        take: NOTIFICATION_EMAIL_BATCH,
        select: ROW_SELECT,
      });
      const handled = new Set<string>();
      if (rows.length > 0) {
        const ctx = await loadContext(tx, [...new Set(rows.map((r) => r.userId))]);
        for (const row of rows) {
          const decision = await ctx.decide(row);
          if (decision === "hold") {
            result.held++;
            continue;
          }
          handled.add(row.id);
          if (decision === "skip") {
            await tx.notification.update({
              where: { id: row.id },
              data: { emailState: "skipped" },
            });
            result.skipped++;
          } else {
            const to = ctx.recipients.get(row.userId)!.email;
            await sendInstant(tx, row, to, baseUrl, now, result);
          }
        }
      }

      // Digest pass: recipients with pending rows whose digest is due.
      const pendingUsers = await tx.notification.findMany({
        where: { emailState: "pending" },
        distinct: ["userId"],
        select: { userId: true },
      });
      if (pendingUsers.length === 0) return;
      const ctx = await loadContext(tx, pendingUsers.map((p) => p.userId));
      for (const [userId, user] of ctx.recipients) {
        const tz = user.timeZone || FALLBACK_TIME_ZONE;
        const today = todayKey(tz, now);
        if (localHour(now, tz) < NOTIFICATION_EMAIL_DIGEST_HOUR) continue;
        if (
          user.notificationDigestSentOn &&
          dateOnlyKey(user.notificationDigestSentOn) >= today
        ) {
          continue;
        }
        const held = await tx.notification.findMany({
          where: { userId, emailState: "pending", id: { notIn: [...handled] } },
          orderBy: { createdAt: "asc" },
          select: ROW_SELECT,
        });
        const digestRows: Row[] = [];
        for (const row of held) {
          const decision = await ctx.decide(row);
          if (decision === "hold") digestRows.push(row);
          else if (decision === "skip") {
            await tx.notification.update({
              where: { id: row.id },
              data: { emailState: "skipped" },
            });
            result.skipped++;
          } else {
            await sendInstant(tx, row, user.email, baseUrl, now, result);
          }
        }
        if (digestRows.length === 0) continue;
        const res = await sendEmail({
          to: user.email,
          ...digestNotificationEmail(digestRows, baseUrl),
        });
        if (!res.ok) {
          console.warn("[notification-email] digest failed", userId, res.error);
          continue;
        }
        await tx.notification.updateMany({
          where: { id: { in: digestRows.map((r) => r.id) } },
          data: { emailState: "sent", emailedAt: now },
        });
        await tx.user.update({
          where: { id: userId },
          data: { notificationDigestSentOn: parseDateOnly(today) },
        });
        result.sent += digestRows.length;
        result.digests++;
      }
    },
    { maxWait: 55_000, timeout: 55_000 }
  );

  return result;
}
