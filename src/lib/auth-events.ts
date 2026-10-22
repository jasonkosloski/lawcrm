/**
 * Auth event audit — sign-ins, sign-outs, and admin sign-in actions
 * (revoke, ban/unban, link reset). Rows land in `ActivityLog` with `type: "auth"` (firm-wide,
 * no matter), so they show on /settings/activity under "Security"
 * (gated `firm.view_activity`) and in the user's own sign-in history
 * on /settings/security. The dashboard feed excludes them.
 *
 * Only events tied to a REAL account are recorded, so we never
 * persist arbitrary attacker-supplied strings. Historical rows from
 * the Auth.js era (failed sign-in, password change, unlock) keep their
 * stored titles and still show on /settings/activity.
 *
 * Fire-and-forget like `logActivity`: an audit write must never block
 * or fail sign-in. Unlike `logActivity` there's no revalidatePath —
 * no cached page renders these rows on the hot path.
 */

import { headers } from "next/headers";
import { prisma, type Tx } from "@/lib/prisma";

export type AuthEventKind =
  | "sign_in"
  | "sign_out"
  /** Dev-only "sign in as" impersonation (src/app/actions/dev-sign-in.ts). */
  | "dev_sign_in"
  /** First Google sign-in matched a verified email to an existing
   *  firm user and linked the Clerk identity. */
  | "account_linked"
  /** Signed in with Clerk but no active firm user matches. */
  | "no_access"
  | "session_revoked"
  | "signed_out_everywhere"
  | "sign_in_link_reset"
  | "clerk_banned"
  | "clerk_unbanned";

/** Row titles — also the query keys for the /settings/security
 *  history filter, so change with care. */
export const AUTH_EVENT_TITLES: Record<AuthEventKind, string> = {
  sign_in: "Signed in",
  sign_out: "Signed out",
  dev_sign_in: "Signed in (dev impersonation)",
  account_linked: "Linked Google sign-in",
  no_access: "Signed in without firm access",
  session_revoked: "Session revoked",
  signed_out_everywhere: "Signed out everywhere by an administrator",
  sign_in_link_reset: "Sign-in link reset by an administrator",
  clerk_banned: "Sign-in blocked (deactivated)",
  clerk_unbanned: "Sign-in unblocked (reactivated)",
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

/** The audit-row `detail` line: reason + request context. */
async function authEventDetail(reason?: string): Promise<string | null> {
  const context = await requestContext();
  return [reason, context].filter(Boolean).join(" — ") || null;
}

type AuthEventInput = {
  /** Null when the event is not tied to a known account. */
  userId: string | null;
  kind: AuthEventKind;
  /** Short reason, e.g. "revoked by admin" — admin-visible only. */
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
  db: Pick<Tx, "activityLog"> = prisma,
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
