/**
 * Deadline notification sweep — SYSTEM endpoint.
 *
 * NOTE: this is one of the sanctioned API-route exceptions to the
 * "mutations are server actions" rule — that rule targets USER
 * mutations; this is a system endpoint (like the NextAuth and
 * document-download handlers) driven by a platform scheduler, not
 * by a signed-in user's click.
 *
 * Vercel-cron convention: schedule a GET to
 * `/api/notification-sweep` in `vercel.json` and Vercel attaches
 * `Authorization: Bearer <CRON_SECRET>` from the project env.
 * Requests without the exact bearer are rejected 401; an unset
 * CRON_SECRET rejects everything (fail closed) rather than leaving
 * the endpoint open.
 *
 * The route calls the UNthrottled sweep — the cron's own schedule
 * is the throttle. The sweep is idempotent and serialized by an
 * advisory lock, so overlap with the dashboard's opportunistic
 * hourly run is harmless (the later one waits, then finds nothing
 * new to write).
 */

import { isAuthorizedCron } from "@/lib/cron-auth";
import { runDeadlineNotificationSweep } from "@/lib/notification-sweeps";

/** Headroom for waiting on the sweep's advisory lock behind an
 *  overlapping run. */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDeadlineNotificationSweep(new Date(), {
      revalidate: true,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[notification-sweep] sweep failed", err);
    return Response.json({ ok: false, error: "Sweep failed" }, { status: 500 });
  }
}
