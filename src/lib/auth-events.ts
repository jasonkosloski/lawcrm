/**
 * Auth event audit — sign-ins, failed sign-ins, sign-outs, password
 * changes. Rows land in `ActivityLog` with `type: "auth"` (firm-wide,
 * no matter), so they show on /settings/activity under "Security"
 * (gated `firm.view_activity`) and in the user's own sign-in history
 * on /settings/security. The dashboard feed excludes them.
 *
 * Only events tied to a REAL account are recorded — failures for
 * unknown emails are not, so credential-stuffing bots can't flood the
 * log, and we never persist arbitrary attacker-supplied strings.
 *
 * Fire-and-forget like `logActivity`: an audit write must never block
 * or fail sign-in. Unlike `logActivity` there's no revalidatePath —
 * no cached page renders these rows on the hot path.
 */

import { headers } from "next/headers";
import { prisma, type Tx } from "@/lib/prisma";

export type AuthEventKind =
  | "sign_in"
  | "sign_in_failed"
  /** Refused during a lockout — password not even checked. Kept
   *  distinct from sign_in_failed so it doesn't extend the lock. */
  | "sign_in_blocked"
  | "sign_out"
  | "password_changed"
  | "password_change_failed"
  /** An admin cleared a (possibly attacker-induced) lockout, or reset
   *  the password. Counts like a successful sign-in for lockout
   *  purposes: failures before it are forgotten. */
  | "sign_in_unlocked";

/** Row titles — also the query keys for lockout counting
 *  (src/lib/credentials-authorize.ts), so change with care. */
export const AUTH_EVENT_TITLES: Record<AuthEventKind, string> = {
  sign_in: "Signed in",
  sign_in_failed: "Failed sign-in",
  sign_in_blocked: "Blocked sign-in (too many failures)",
  sign_out: "Signed out",
  password_changed: "Changed password",
  password_change_failed: "Failed password change",
  sign_in_unlocked: "Sign-in unlocked by an administrator",
};

/** Client IP + user agent for the detail line. Vercel sets
 *  x-forwarded-for itself (client value first), so it's trustworthy
 *  there; locally it's usually absent. */
async function requestContext(): Promise<string | null> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const ua = h.get("user-agent")?.slice(0, 160) || null;
    const parts = [ip && `IP ${ip}`, ua].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  } catch {
    // Outside a request scope (scripts/tests) — no context to add.
    return null;
  }
}

/** The audit-row `detail` line: reason + request context. Exported so
 *  the lockout path can write its reservation row inside a
 *  transaction with the same shape logAuthEvent produces. */
export async function authEventDetail(reason?: string): Promise<string | null> {
  const context = await requestContext();
  return [reason, context].filter(Boolean).join(" — ") || null;
}

type AuthEventInput = {
  userId: string;
  kind: AuthEventKind;
  /** Short reason, e.g. "wrong password" — admin-visible only. */
  reason?: string;
};

/**
 * Throwing variant of `logAuthEvent` for events that ARE the effect
 * (an admin unlock changes who may sign in): if the row isn't
 * written the action must report failure, not "ok". Pass a
 * transaction client to make the row atomic with another write.
 */
export async function recordAuthEvent(
  input: AuthEventInput,
  db: Pick<Tx, "activityLog"> = prisma
): Promise<void> {
  const detail = await authEventDetail(input.reason);
  await db.activityLog.create({
    data: {
      matterId: null,
      userId: input.userId,
      type: "auth",
      icon: "shield",
      source: "Security",
      title: AUTH_EVENT_TITLES[input.kind],
      detail,
    },
  });
}

export async function logAuthEvent(input: AuthEventInput): Promise<void> {
  try {
    await recordAuthEvent(input);
  } catch (err) {
    console.warn("[auth-events] failed to write entry", err);
  }
}
