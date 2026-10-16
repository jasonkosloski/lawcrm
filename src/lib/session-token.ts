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
 *      server action calls `unstable_update()` (trigger "update" —
 *      the change-password flow re-stamps its own session). Any
 *      other mismatch means the password changed after this token
 *      was issued → strip it. Tokens with no fingerprint (minted
 *      before this check existed) are stripped too: one forced
 *      re-login, by design.
 */

import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { passwordFingerprint } from "@/lib/session-fingerprint";

export async function validateSessionToken(
  token: JWT,
  opts: { signInUserId?: string; trigger?: string } = {}
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
  if (opts.signInUserId || opts.trigger === "update") {
    token.pwv = fingerprint;
  } else if (token.pwv !== fingerprint) {
    delete token.userId;
  }
  return token;
}
