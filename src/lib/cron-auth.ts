/**
 * Bearer check for the platform-scheduler (cron) endpoints.
 *
 * Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. The routes
 * are exempt from the cookie gate in src/proxy.ts (SELF_AUTHENTICATED
 * _PATHS), so this is their only control: fail CLOSED when the secret
 * is unset, and compare in constant time (equal-length guard first —
 * `timingSafeEqual` throws on a length mismatch).
 */

import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (header === null) return false;

  const provided = Buffer.from(header, "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
