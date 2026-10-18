# ADR-017: Password fingerprint in the JWT — revoke sessions on password change without a Session table

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Sessions are stateless JWTs (`docs/features/auth.md`). With no session row to delete, changing or resetting a password left every existing session — including a stolen one — valid until expiry. Switching to database sessions is the textbook fix but is a schema change plus a session-strategy change, and the credentials provider has caveats with DB sessions.

**Decision:**
- The JWT carries `pwv`, a 16-hex-char SHA-256 digest of the user's argon2 hash (`src/lib/session-fingerprint.ts`). It's stamped at sign-in.
- The `jwt` callback (`validateSessionToken`, `src/lib/session-token.ts`) already reads the user row on every request to reject deleted/deactivated users; it now also compares the fingerprint and strips the session on mismatch. No extra query.
- `changePasswordAction` calls `unstable_update({ pwv: passwordFingerprint(newHash) })` after writing the new hash. The callback runs with `trigger: "update"` and re-stamps the current session **only when the update payload's `pwv` equals the fingerprint freshly computed from the DB row**; otherwise it falls through to the normal mismatch check and the stale token is stripped. The payload check matters because `POST /api/auth/session` also reaches the callback with `trigger: "update"` for anyone holding a cookie plus a CSRF token (both obtainable by a cookie thief): a bare `unstable_update()` that re-stamped unconditionally would let a stolen, already-revoked cookie revive itself. Forging the payload needs the argon2 hash, which never leaves the server, and the `session` callback exposes only `user.id` — the fingerprint is never in the session object sent to the client. Pinned by `src/lib/session-token.test.ts` and `src/auth.test.ts`. An admin reset (`resetFirmMemberPassword`) signs the target out everywhere, as it should.
- Tokens minted before this shipped have no `pwv` and are dropped: one forced re-login per user at deploy.
- `getSession()` (`src/lib/session.ts`, a React-`cache()`d `auth()`) is the single per-request session read, so the `jwt` callback's user lookup runs once per request however many guards call it.

**Trade-offs:**
- (+) Real "sign out everywhere" on password change/reset with zero schema change
- (+) The cookie never contains the hash itself — only a digest of it
- (-) Revocation is all-or-nothing: no "sign out just that one device" — that still needs DB sessions (per-device session list stays deferred)
- (-) Relies on the per-request user lookup in the `jwt` callback; if that query is ever removed for performance, this check goes with it
