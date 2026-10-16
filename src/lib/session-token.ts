/**
 * Per-request session-token validation — the body of the Auth.js
 * `jwt` callback (src/auth.ts), extracted so it can be tested
 * against a real database.
 *
 * Runs on sign-in AND on every request that reads the session:
 *   1. The user must still exist and be active — otherwise `userId`
 *      is stripped and downstream guards treat the session as
 *      signed out (stale-JWT defense, see docs/AUTH_PLAN.md).
 *   2. Password fingerprint (ADR-017): stamped at sign-in and when a
 *      server action calls `unstable_update({ pwv })` (trigger
 *      "update" — the change-password flow re-stamps its own
 *      session). An update only re-stamps when the payload's `pwv`
 *      equals the fingerprint freshly computed from the DB row:
 *      POST /api/auth/session also reaches the jwt callback with
 *      trigger "update" for anyone holding a cookie + a CSRF token
 *      (both obtainable by a cookie thief), but computing the
 *      fingerprint needs the argon2 hash, which never leaves the
 *      server (and the fingerprint is never put in the session
 *      object sent to the client). Any other mismatch means the
 *      password changed after this token was issued → strip it.
 *      Tokens with no fingerprint (minted before this check
 *      existed) are stripped too: one forced re-login, by design.
 */

import { timingSafeEqual } from "node:crypto";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { passwordFingerprint } from "@/lib/session-fingerprint";

function sameFingerprint(claimed: unknown, actual: string): boolean {
  if (typeof claimed !== "string") return false;
  const a = Buffer.from(claimed);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function validateSessionToken(
  token: JWT,
  opts: {
    signInUserId?: string;
    trigger?: string;
    /** `session?.pwv` from the jwt callback — the fingerprint the
     *  caller of `unstable_update` claims is current. Untrusted;
     *  only honoured on trigger "update" and only if it matches the
     *  DB-derived value. */
    updatePwv?: unknown;
  } = {}
): Promise<JWT> {
  if (opts.signInUserId) {
    token.userId = opts.signInUserId;
  }
  if (!token.userId) return token;

  const row = await prisma.user.findUnique({
    where: { id: token.userId },
    select: { isActive: true, passwordHash: true },
  });
  if (!row || !row.isActive) {
    delete token.userId;
    return token;
  }

  const fingerprint = passwordFingerprint(row.passwordHash);
  const provenUpdate =
    opts.trigger === "update" && sameFingerprint(opts.updatePwv, fingerprint);
  if (opts.signInUserId || provenUpdate) {
    token.pwv = fingerprint;
  } else if (token.pwv !== fingerprint) {
    delete token.userId;
  }
  return token;
}
