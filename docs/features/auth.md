# Authentication

Auth.js v5 email + password sign-in with argon2id and JWT sessions, change password, password-fingerprint session revocation, per-account lockout and an auth audit trail. There is no self sign-up (users are seeded or invited by an admin). 2FA, password reset by email, OAuth/SSO and similar are DELIBERATELY DEFERRED until a planned auth overhaul (project memory: do not start auth features before that).
Related: [ADR-017](../decisions/017-password-fingerprint-in-the-jwt-revoke-sessions.md), [ADR-020](../decisions/020-sign-in-lockout-is-a-reserve-settle.md), [ADR-028](../decisions/028-layouts-are-not-auth-gates-every-page.md), [ADR-022](../decisions/022-security-header-baseline-no-csp-yet-and.md), [PERMISSIONS.md](../PERMISSIONS.md), [settings-admin.md](settings-admin.md)

## Open work
- [~] **Authentication overhaul** (P2) — Phase 1 done. Everything below waits for the planned overhaul / concrete demand; where each would land:
  - Google OAuth sign-in: append `Google()` to `providers` in `src/auth.ts`, set `AUTH_GOOGLE_*`; the `Account` table exists. Other OAuth (Microsoft 365, GitHub): same drill.
  - Self-service password reset (email link): new `/forgot-password` + `/reset-password?token=...` routes; single-use hashed tokens in `VerificationToken`; invalidate sessions on reset. Today an admin resets from Settings -> Team (clears any lock, signs the target out everywhere). Needs an email delivery provider (Resend in prod / console in dev).
  - Email verification: send on signup + email change; consume via `VerificationToken`; flip `User.emailVerified`.
  - MFA / TOTP: `User.totpSecret` + `RecoveryCode` table; second login step; `/account/mfa` enroll.
  - Session list / revoke individual sessions: switch strategy `jwt` -> `database`, add `Session` table, `/account/sessions` UI. (Revoke-ALL-others on password change/reset already works via ADR-017.)
  - Idle timeout / absolute lifetime: session-callback timestamps, configurable in firm settings.
  - Pwned-passwords check: HaveIBeenPwned k-anonymity range API in the credentials authorize step.
  - Rate limiting per IP / route: nothing beyond the per-account lockout; use a Vercel Firewall rule on the sign-in route or a Redis/Upstash sliding window.
  - Re-auth challenge for sensitive actions: a `requireRecentAuth(maxAgeMin)` helper checking session age.
  - Multi-tenancy (`firmId` on session): add `Firm` model relations + `User.firmId`; extend `jwt`/`session` callbacks; audit every query for `where: { firmId }`.
  - SAML/OIDC SSO: Auth.js provider, likely only when a >50-user firm asks.

## Shipped
- [x] **Phase 1: email + password, JWT sessions** (2026-04-25) — Auth.js v5 (`next-auth@beta`) + Prisma adapter + argon2id (constant-time `argon2.verify`). `/login` with generic errors (no email enumeration), `?next=` round-trip via `src/proxy.ts`, sign-out in the sidebar profile strip. Seed users get hashed passwords from `SEED_ADMIN_PASSWORD` or a random one printed once. `Account` + `VerificationToken` tables provisioned for OAuth / reset later. Migration `20260425201311_auth_phase_1` added `User.passwordHash` (null = no credentials login), `User.emailVerified`, `User.image`, `Account`, `VerificationToken`.
- [x] **Phase 2 hardening** (2026-10-16) — change password (same throttle as sign-in, 5 failed attempts / 15 min via `reserveAttempt`), login lockout (5 failures / 15 min per account, atomic; unknown/inactive/passwordless/locked accounts burn a dummy argon2 verify; per-account not per-IP, an accepted availability trade-off, ADR-020), auth audit trail (`type: "auth"` ActivityLog rows), password change/reset signs out other sessions (ADR-017). Details and UI in [settings-admin.md](settings-admin.md).
- [x] **RBAC** — `Role` / `UserRole` / `RolePermission`, catalog in `src/lib/permissions.ts`, `requirePermission`. Matter-level team access shipped as ADR-039 (see [matter-access.md](matter-access.md)).

## Decisions in force
- Library: Auth.js v5 (Credentials + any OAuth later; Prisma adapter first-class).
- Hashing: argon2id; seed hashes once, login uses constant-time verify.
- Sessions: JWT strategy, no `Session` table. Cannot revoke one session before expiry; revoke-all-others works through the password fingerprint (`pwv`) in the JWT (ADR-017). `changePasswordAction` re-stamps its own session via `unstable_update({ pwv })`; the `jwt` callback honors that only when the payload `pwv` equals the fingerprint freshly computed from the DB (proof-gated), so a stolen revoked cookie cannot revive itself via `POST /api/auth/session`. Tokens issued before ADR-017 carry no fingerprint (everyone signed in once more).
- Cookie: `authjs.session-token`, HttpOnly, SameSite=Lax, Secure in prod (Auth.js defaults, not overridden).
- Email delivery: none yet.
- Tenancy: single-tenant, structured for an additive `firmId`.

## Files to look at
- `src/auth.ts` — Auth.js config (Credentials, Prisma adapter, JWT, callbacks). The `jwt` callback re-validates `token.userId` against the DB on every request and strips it when the user is gone, inactive, or the fingerprint no longer matches.
- `src/app/api/auth/[...nextauth]/route.ts` — re-exports `handlers`.
- `src/proxy.ts` — Next.js 16 proxy (renamed from middleware); optimistic cookie-presence check only, never validates the JWT.
- `src/lib/current-user.ts` — `getCurrentUserId()` (redirects to `/login` on miss) and `requireUser()`. EVERY `page.tsx` / `layout.tsx` under `(dashboard)` and `print` must call a guard as its first `await` (a layout is not a gate: partial navigations skip parent layouts). Enforced by `src/app/page-guards.test.ts` (ADR-028).
- `src/lib/credentials-authorize.ts` — `authorize` + lockout/throttle (`reserveAttempt`/`settleAttempt`, `isLockedOut`; `LOCKOUT_THRESHOLD`/`LOCKOUT_WINDOW_MS`). `src/lib/session-token.ts` — `jwt` callback body. Both moved out so they are tested against a real DB.
- `src/app/actions/auth.ts` — `loginAction`, `logoutAction`, `changePasswordAction`. Generic "Invalid email or password" only for `CredentialsSignin`; other errors (e.g. DB outage) log server-side and show "Sign-in is temporarily unavailable".
- `src/app/login/page.tsx` + `src/components/auth/login-form.tsx`; skip-the-form check uses `session?.user?.id` so a stale cookie cannot loop. `src/types/next-auth.d.ts` types `session.user.id` optional (undefined = stale).

## Notes
- **Defense in depth against stale JWTs:** (1) the `jwt` callback validates the user on every request; (2) every page/layout calls `requireUser()` or stronger first; (3) the login page detects a valid-but-stale cookie and renders the form so re-auth overwrites it. The proxy stays optimistic (fast, Edge-compatible).
- **Multi-tenant seams:** `getCurrentUserId()`/`requireUser()` is the only chokepoint for identity; when `firmId` lands add `getCurrentUserContext(): { userId, firmId }` beside it. The `session` callback in `src/auth.ts` is where `firmId` attaches (one line). The `Account` table supports multi-firm. The real lift is auditing every query for `where: { firmId }`.
- **Operational:** rotating `AUTH_SECRET` (`openssl rand -base64 32`, replace, restart) logs everyone out. Password changes: users via `/settings/security`, admins via Settings -> Team. Re-seeding a dev DB resets every demo user (set `SEED_ADMIN_PASSWORD` to choose it; otherwise a random one prints once; none is stored in the repo). Dev login: the seeded admin email in `prisma/seed.ts`; other seed users share that password.
- **The seed is destructive and guarded:** `prisma/seed.ts` and `npm run db:reset` (guard in `prisma.config.ts`) refuse unless every database URL is localhost / 127.0.0.1 / ::1, or `ALLOW_SEED=1` for a known dev DB; production-looking environments are always refused (`src/lib/seed-guard.ts`).
- **Dev sign-in-as (Clerk):** `/dev/sign-in-as` lets a developer sign in as any active seeded user locally (mints a 60 s Clerk sign-in ticket). One switch, `isDevSignInAllowed()` in `src/lib/dev-sign-in.ts` (not production, `pk_test_` key, not on Vercel), checked independently by the page, the `devSignInAs` action and the proxy. Each use writes a "Signed in (dev impersonation)" audit row.
- **Cutover pre-flight:** `npm run clerk:preflight` is read-only; it prints the DB host/user prefix, active users not on `@kosloskilaw.com`, and how many are linked to Clerk.
