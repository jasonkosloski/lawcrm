/**
 * Credentials `authorize` for Auth.js (src/auth.ts), extracted so it
 * can be tested against a real database.
 *
 * Security notes:
 *   - Returns `null` for EVERY failure mode (bad password, unknown
 *     email, deactivated account, no password set) — the caller can't
 *     tell which, so emails can't be enumerated.
 *   - Constant-time compare comes for free with argon2.verify.
 *   - `passwordHash === null` means "no credentials login" — reject
 *     without ever calling argon2.
 *   - Audit (src/lib/auth-events.ts): the admin-visible row records
 *     the real reason, but only for REAL accounts — failures for
 *     unknown emails write nothing, so bots can't flood the log.
 *   - Lockout: LOCKOUT_THRESHOLD failed sign-ins within
 *     LOCKOUT_WINDOW_MS (counting only failures since the last
 *     successful sign-in) refuse further attempts without checking
 *     the password, until the window passes. Counted from the audit
 *     rows — no extra schema. Refused attempts log as
 *     "sign_in_blocked", which doesn't count, so the lock lifts on
 *     schedule rather than sliding while an attacker keeps trying.
 */

import * as argon2 from "argon2";
import { z } from "zod";
import { AUTH_EVENT_TITLES, logAuthEvent } from "@/lib/auth-events";
import { prisma } from "@/lib/prisma";

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** Failed sign-ins in the window, since the last successful one. */
export async function isLockedOut(userId: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const lastSuccess = await prisma.activityLog.findFirst({
    where: {
      userId,
      type: "auth",
      title: AUTH_EVENT_TITLES.sign_in,
      timestamp: { gt: windowStart },
    },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  const failures = await prisma.activityLog.count({
    where: {
      userId,
      type: "auth",
      title: AUTH_EVENT_TITLES.sign_in_failed,
      timestamp: { gt: lastSuccess?.timestamp ?? windowStart },
    },
  });
  return failures >= LOCKOUT_THRESHOLD;
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function authorizeCredentials(raw: unknown) {
  // Auth.js hands us `Partial<Record<...>>` from the form — validate
  // shape before trusting it.
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      passwordHash: true,
      isActive: true,
    },
  });
  if (!user) return null;
  if (!user.isActive || !user.passwordHash) {
    await logAuthEvent({
      userId: user.id,
      kind: "sign_in_failed",
      reason: !user.isActive ? "account deactivated" : "no password set",
    });
    return null;
  }

  if (await isLockedOut(user.id)) {
    await logAuthEvent({ userId: user.id, kind: "sign_in_blocked" });
    return null;
  }

  const ok = await argon2.verify(user.passwordHash, parsed.data.password);
  if (!ok) {
    await logAuthEvent({
      userId: user.id,
      kind: "sign_in_failed",
      reason: "wrong password",
    });
    return null;
  }
  await logAuthEvent({ userId: user.id, kind: "sign_in" });

  // The shape returned here lands in the `jwt` callback as the `user`
  // arg on first sign-in. Only forward what the session needs.
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}
