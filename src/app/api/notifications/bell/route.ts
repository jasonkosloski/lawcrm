/**
 * Notification bell state — READ endpoint for the topbar bell's poll.
 *
 * Why a route handler and not a Server Action: Next dispatches Server
 * Actions one at a time per client, so a polled read queues AHEAD of
 * the user's real mutations (Save waits behind the bell fetch). A
 * plain GET runs in parallel with them. Mutations (mark read / mark
 * all read) stay Server Actions in `src/app/actions/notifications.ts`.
 *
 * Auth: the proxy only checks that a session cookie exists, so this
 * handler validates the session itself and scopes the query to that
 * user (`getNotificationsBell` resolves the user id from the session;
 * no id is ever taken from the request). Responses are never cached.
 *
 * `createdAt` is a Date server-side and an ISO string on the wire;
 * the client provider revives it.
 */

import { getSession } from "@/lib/session";
import { getNotificationsBell } from "@/lib/queries/notifications";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session?.user?.id) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE }
    );
  }

  try {
    const bell = await getNotificationsBell();
    return Response.json(bell, { headers: NO_STORE });
  } catch (err) {
    console.error("[notifications/bell] failed", err);
    return Response.json(
      { error: "Could not load notifications." },
      { status: 500, headers: NO_STORE }
    );
  }
}
