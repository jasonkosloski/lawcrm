/**
 * Notification email delivery — SYSTEM endpoint.
 *
 * NOTE: one of the sanctioned API-route exceptions to the "mutations
 * are server actions" rule (like /api/notification-sweep): a system
 * endpoint driven by the platform scheduler, not a signed-in user.
 *
 * Vercel cron GETs this every 5 minutes (vercel.json) with
 * `Authorization: Bearer <CRON_SECRET>`; anything else is 401, and an
 * unset CRON_SECRET rejects everything (fail closed). The proxy exempts
 * the exact path, so that bearer check is the only control.
 *
 * The worker (src/lib/notification-email.ts) is serialized by an
 * advisory lock, so an overlapping run waits and then finds nothing
 * left to send.
 */

import { isAuthorizedCron } from "@/lib/cron-auth";
import { runNotificationEmailDelivery } from "@/lib/notification-email";

/** Headroom for waiting on the worker's advisory lock and on Resend. */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runNotificationEmailDelivery();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[notification-email] delivery failed", err);
    return Response.json({ ok: false, error: "Delivery failed" }, { status: 500 });
  }
}
