/**
 * Clerk webhook: session events -> sign-in/sign-out audit rows.
 *
 * The proxy exempts this path (SELF_AUTHENTICATED_PATHS), so the Svix
 * signature check (`verifyWebhook`, env CLERK_WEBHOOK_SIGNING_SECRET)
 * is the only control. Writes audit rows only; never touches `User`.
 *
 * The row is written directly rather than through `logAuthEvent`: that
 * helper appends the request's IP/UA to `detail`, which for a webhook
 * is Clerk's server and would also defeat the exact-`detail` dedupe.
 * Svix retries the same event, so one row per (kind, session).
 */

import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { prisma } from "@/lib/prisma";
import { AUTH_EVENT_TITLES, type AuthEventKind } from "@/lib/auth-events";

const KIND_BY_EVENT: Record<string, AuthEventKind> = {
  "session.created": "sign_in",
  "session.ended": "sign_out",
  "session.removed": "sign_out",
  "session.revoked": "session_revoked",
};

export async function POST(request: NextRequest) {
  let evt;
  try {
    // Trimmed: a secret pasted into the Vercel dashboard with a trailing
    // newline otherwise fails every signature.
    evt = await verifyWebhook(request, {
      signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim(),
    });
  } catch (err) {
    // The reason only (never the secret or payload), so a mismatched
    // secret is distinguishable from a stale timestamp or bad header.
    console.warn(
      "[clerk-webhook] verification failed:",
      err instanceof Error ? err.message : String(err)
    );
    return new Response("Invalid signature", { status: 401 });
  }

  const kind = KIND_BY_EVENT[evt.type];
  if (!kind) return new Response("Ignored", { status: 200 });

  const data = evt.data as { id: string; user_id?: string | null };
  const title = AUTH_EVENT_TITLES[kind];
  const detail = `Session ${data.id}`;

  try {
    const existing = await prisma.activityLog.findFirst({
      where: { type: "auth", title, detail },
      select: { id: true },
    });
    if (!existing) {
      const user = data.user_id
        ? await prisma.user.findFirst({
            where: { clerkUserId: data.user_id },
            select: { id: true },
          })
        : null;
      await prisma.activityLog.create({
        data: {
          matterId: null,
          userId: user?.id ?? null,
          type: "auth",
          icon: "shield",
          source: "Security",
          title,
          detail,
        },
      });
    }
  } catch (err) {
    // 500 so Svix retries; the dedupe makes a retry safe.
    console.warn("[clerk-webhook] failed to write audit row", err);
    return new Response("Error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
}
