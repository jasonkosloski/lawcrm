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
import { prisma } from "@/lib/prisma";

export type AuthEventKind =
  | "sign_in"
  | "sign_in_failed"
  | "sign_out"
  | "password_changed"
  | "password_change_failed";

const TITLES: Record<AuthEventKind, string> = {
  sign_in: "Signed in",
  sign_in_failed: "Failed sign-in",
  sign_out: "Signed out",
  password_changed: "Changed password",
  password_change_failed: "Failed password change",
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

export async function logAuthEvent(input: {
  userId: string;
  kind: AuthEventKind;
  /** Short reason, e.g. "wrong password" — admin-visible only. */
  reason?: string;
}): Promise<void> {
  try {
    const context = await requestContext();
    const detail = [input.reason, context].filter(Boolean).join(" — ") || null;
    await prisma.activityLog.create({
      data: {
        matterId: null,
        userId: input.userId,
        type: "auth",
        icon: "shield",
        source: "Security",
        title: TITLES[input.kind],
        detail,
      },
    });
  } catch (err) {
    console.warn("[auth-events] failed to write entry", err);
  }
}
