# ADR-020: Sign-in lockout is a reserve/settle under a per-email advisory lock; per-account (not per-IP) lock is an accepted DoS risk

**Date:** 2026-10-16
**Status:** Superseded — staff sign-in moved to Clerk (2026-10-19); passwords, JWT sessions and lockout no longer exist

**Context:** The lockout (5 failures / 15 min, counted from `ActivityLog` auth rows) was check-then-act: N parallel guesses could all pass the count before any failure row existed, so the threshold did not bound guessing. Separately, a lock keyed on the account lets anyone who knows an email lock that account on purpose.

**Decision:**
- `reserveAttempt` (`src/lib/credentials-authorize.ts`) opens a short transaction, takes `pg_advisory_xact_lock(hashtext(<key>))` (key = normalised email for sign-in, user id for password change), counts failures including in-flight ones, and inserts the failure row **before** the password is verified. `settleAttempt` deletes the row on success or annotates it with the reason on failure. The lock is released before argon2 runs. A crash mid-verify leaves a counted failure (fail closed).
- `changePasswordAction` reuses the same mechanism (`password_change_failed` rows) so a hijacked session can't brute-force the current password.
- `AUTH_EVENT_TITLES` values are query keys; never rename them.
- Unknown / inactive / passwordless / locked accounts burn one dummy argon2 verify so timing doesn't reveal account existence. Cost: those attempts now cost about a real attempt of CPU and ~64 MiB each — login spam is a resource amplifier, so edge rate limiting matters.
- **Accepted risk (F129):** the lock is per account. Anyone who knows staff emails can hold every account — admins included — locked (5 failures per 15 minutes; the lock lifts on its own, blocked attempts do not extend it, and blocked-attempt audit rows are throttled to one per account per minute). An IP factor is spoofable/shared and no lock exposes the password, so we keep it. Mitigations: `unlockFirmMemberSignIn` and `resetFirmMemberPassword` write a `sign_in_unlocked` event (counts like a successful sign-in; written with a throwing write so a failure is reported, not swallowed); Admin-class targets can only be unlocked/reset by an Admin. **Both need a signed-in directory manager, so a firm with every admin locked has no in-app recovery.** Break-glass: wait out the window, or insert a `sign_in_unlocked` row by SQL (header of `src/lib/credentials-authorize.ts`). Recommended real fix: a per-IP rate-limit rule on the sign-in route at the edge (Vercel Firewall).
- The unlock action exists server-side only; there is no button on the team page yet (follow-up: wire it in `member-row.tsx`).

**Trade-offs:**
- (+) The threshold actually bounds parallel guessing
- (+) No schema change; same audit rows drive the lock and the history
- (-) A deliberate lockout DoS against any known email remains possible until edge rate limiting is configured
- (-) Each login attempt takes a short DB transaction (pool size per ADR-032; the advisory lock is held only for the count + insert, never across argon2)
