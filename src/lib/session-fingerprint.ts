/**
 * Password fingerprint stamped into the session JWT (ADR-017).
 *
 * Sessions are stateless JWTs, so there is no session row to delete
 * when a password changes. Instead, the token carries a short digest
 * of the user's password hash, and the `jwt` callback (which already
 * reads the user row on every request) drops the session when the
 * digest no longer matches. Changing or resetting a password
 * therefore signs the account out everywhere; the session that made
 * the change is re-stamped via `unstable_update()`.
 *
 * The input is the argon2 hash (salted, already one-way); digesting
 * it again just keeps the hash itself out of the cookie. 16 hex chars
 * (64 bits) is plenty to detect change — this is an equality check,
 * not a secret.
 */

import { createHash } from "node:crypto";

export function passwordFingerprint(passwordHash: string | null): string {
  return createHash("sha256")
    .update(passwordHash ?? "")
    .digest("hex")
    .slice(0, 16);
}
