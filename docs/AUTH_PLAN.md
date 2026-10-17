# Auth Plan

Living plan for authentication & authorization across LawCRM. Phase 1
(email + password) shipped 2026-04-25; Phase 2 hardening (below) is
partly shipped. Items in the deferred table that are not struck through
are still open and wait for concrete demand.

## Decisions in force

| Decision | Choice | Why |
|---|---|---|
| Library | `next-auth@beta` (Auth.js v5) | Battle-tested, supports Credentials + every OAuth provider we'd want, Prisma adapter is first-class. |
| Password hashing | argon2id via `argon2` | Tunable, memory-hard, recommended over bcrypt. One-shot in seed (`argon2.hash`), constant-time `argon2.verify` on login. |
| Session strategy | JWT (HS256-ish via Auth.js default) | No `Session` table needed yet. Trade-off: can't revoke a single session before its expiry. Acceptable for solo dev; revisit when multi-user. |
| Session cookie | `authjs.session-token`, `HttpOnly`, `SameSite=Lax`, `Secure` in prod | Auth.js defaults; we don't override. |
| Email delivery | None (deferred — password reset isn't wired) | Resend in prod / console in dev when Phase 2 lands. |
| Multi-tenant | Single-tenant today, structured for additive `firmId` later | `firmId` will go on `User` + every scoped query; the session callback in `src/auth.ts` is a one-line change. |

## Files to look at

- `src/auth.ts` — Auth.js config (Credentials provider, Prisma adapter, JWT strategy, session callbacks). The `jwt` callback re-validates `token.userId` against the DB on every request and strips it when the user no longer exists / is deactivated — closes the stale-JWT gap.
- `src/app/api/auth/[...nextauth]/route.ts` — catch-all handler, just re-exports `handlers`.
- `src/proxy.ts` — Next.js 16 proxy (renamed from middleware). Optimistic cookie-presence check only, never validates the JWT itself.
- `src/lib/current-user.ts` — `getCurrentUserId()` reads from `auth()` and `redirect("/login")`s on miss; `requireUser()` is the same check named for page guards. **Every `page.tsx` / `layout.tsx` under `(dashboard)` and `print` must call a guard as its first `await`** (a layout is not a gate: Next renders pages on partial navigations without re-running parent layouts). Enforced by `src/app/page-guards.test.ts` (ADR-028; see `docs/PERMISSIONS.md`). The old sidebar user reader `getCurrentUser` no longer exists; display data comes from `getSidebarData` (`src/lib/queries/sidebar.ts`).
- `src/lib/credentials-authorize.ts` — Credentials `authorize` plus the lockout/throttle machinery (`reserveAttempt` / `settleAttempt`, `isLockedOut`). `src/lib/session-token.ts` — the `jwt` callback body (stale-user and password-fingerprint checks).
- `src/app/actions/auth.ts` — `loginAction`, `logoutAction`, `changePasswordAction`. `loginAction` shows the generic "Invalid email or password" text only for `CredentialsSignin`; any other error (e.g. a DB outage) logs server-side and shows "Sign-in is temporarily unavailable".
- `src/app/login/page.tsx` + `src/components/auth/login-form.tsx` — form UI. Skip-the-form check uses `session?.user?.id` (not `session?.user`) so a stale cookie can't cause a redirect loop.
- `src/types/next-auth.d.ts` — module augmentation that types `session.user.id` as optional (undefined = stale / invalid session).

### Security: defense-in-depth against stale JWTs

Three layers cooperate:
1. **JWT callback** validates the user against the DB on every request. If gone, inactive, or the password fingerprint no longer matches (ADR-017), strips `userId` from the token.
2. **Page guards.** Every page and layout calls `requireUser()` (or a stronger guard) first, which bounces to `/login` when `session.user.id` is undefined. The dashboard layout does this too but is not relied on.
3. **Login page** detects a stale-but-cryptographically-valid cookie (`session` exists but `session.user.id` is undefined) and renders the form so the user can re-auth — submitting overwrites the cookie with a fresh JWT.

The proxy remains optimistic (cookie-presence only) so it's fast and Edge-compatible; the real validation happens in the JWT callback and the page guards.

## Schema additions (migration `20260425201311_auth_phase_1`)

- `User.passwordHash String?` — argon2id hash; null = no credentials login.
- `User.emailVerified DateTime?` — Auth.js standard. Null today; the verify flow that flips it is deferred.
- `User.image String?` — Auth.js standard. Empty until OAuth providers populate it.
- `Account` table — Auth.js standard, empty today; lights up the moment we add an OAuth provider, no migration needed.
- `VerificationToken` table — empty today; lights up when we wire email verification or magic links.

## What ships in Phase 1 ("now")

- Email + password sign-in via the Credentials provider.
- `/login` page with generic error messages (no email enumeration).
- `?next=` round-trip so the proxy can land users back where they were heading.
- `getCurrentUserId()` / `requireUser()` read the session, redirect to `/login` if absent.
- Sign-out button in the sidebar profile strip.
- Seed users get hashed passwords from `SEED_ADMIN_PASSWORD`, or a random one printed once at seed end.
- There is no self-service sign-up. Users are created by the seed or invited by an admin (Settings, Team).
- `Account` + `VerificationToken` tables exist so adding Google later is config-only.

## Phase 2 progress (2026-10-16)

- **Change password** on `/settings/security` (`changePasswordAction` in `src/app/actions/auth.ts`; policy in `src/lib/password-policy.ts`). It uses the same throttle as sign-in (5 failed current-password attempts / 15 min, keyed per user via `reserveAttempt`).
- **Login lockout**: 5 failed sign-ins per 15 minutes per account (`LOCKOUT_THRESHOLD` / `LOCKOUT_WINDOW_MS`). The check-and-record is atomic: `reserveAttempt` takes a per-email Postgres advisory lock in a short transaction and inserts the failure row before the password is verified, so parallel guesses cannot all slip past the check. Unknown, inactive, passwordless and locked accounts burn a dummy argon2 verify so response time does not reveal whether an email exists. An admin unlock or password reset writes `sign_in_unlocked`, which clears the count. The lock is per account, not per IP: an accepted availability trade-off (ADR-020); per-IP limiting belongs at the edge (Vercel Firewall rule on the sign-in route) and is still open.
- **Auth audit trail** + the user's own recent activity list (see the deferred table below).
- **Password change/reset signs out other sessions** — ADR-017. The JWT carries a password fingerprint (`pwv`). `changePasswordAction` re-stamps its own session via `unstable_update({ pwv })`, and the `jwt` callback honors that only when the payload's `pwv` equals the fingerprint freshly computed from the DB row (proof-gated), so a stolen, already-revoked cookie cannot revive itself through `POST /api/auth/session`. Tokens issued before this shipped carry no fingerprint, so every user signs in once more after the deploy.
- Credentials `authorize` and the `jwt` callback body moved to `src/lib/credentials-authorize.ts` / `src/lib/session-token.ts` so they're tested against a real DB.

## What's deferred (and where it'd go when we revisit)

| Feature | Where it lands later |
|---|---|
| Google OAuth | Append `Google()` to `providers` in `src/auth.ts`, set `AUTH_GOOGLE_*` envs. The `Account` table is already there. |
| Other OAuth (Microsoft 365, GitHub, etc.) | Same drill — Auth.js providers list. |
| Self-service password reset (email link) | Not built; an admin can reset a member's password from Settings, Team (clears any lock, signs the target out everywhere). Email-link flow would need: New `/forgot-password` + `/reset-password?token=…` routes; emit single-use hashed tokens via the `VerificationToken` table; invalidate sessions on reset. |
| Email verification | Send-on-signup + on-email-change; consume tokens via `VerificationToken`; flip `User.emailVerified`. |
| MFA / TOTP | New `User.totpSecret` + `RecoveryCode` table; second step in the login flow; `/account/mfa` enroll. |
| Session list / revoke individual sessions | Switch `session.strategy` from `"jwt"` to `"database"`, add `Session` table, build `/account/sessions` UI. (Revoke-ALL-other-sessions on password change/reset already works without this — password fingerprint in the JWT, ADR-017.) |
| Idle timeout / absolute lifetime | Session callback timestamps; configurable in firm settings. |
| ~~Account lockout~~ | **Shipped 2026-10-16** — see Phase 2 progress: 5 failures / 15 min per account, atomic, counted from `auth` audit rows (no schema). Per-IP throttling across many accounts is still open (see Rate limiting). |
| Pwned-passwords corpus check | Call HaveIBeenPwned k-anonymity range API in the credentials authorize step. |
| ~~RBAC / roles / permissions~~ | **Shipped** - `Role` / `UserRole` / `RolePermission`, the catalog in `src/lib/permissions.ts`, `requirePermission`. See [PERMISSIONS.md](./PERMISSIONS.md). Matter-level (team) access is still planned, not built. |
| ~~Audit log of auth events~~ | **Shipped 2026-10-16** — `ActivityLog` rows with `type: "auth"` via `src/lib/auth-events.ts` (sign-in, failed sign-in for real accounts, sign-out, password change) + team invite/update/reset. |
| Rate limiting (per IP / per route) | Not built beyond the per-account lockout. Edge rule (Vercel Firewall) or Redis/Upstash sliding window. |
| Re-auth challenge for sensitive actions | Custom `requireRecentAuth(maxAgeMin)` helper checking session age. |
| Multi-tenancy (`firmId` on session) | Add `Firm` model + `User.firmId`; extend the `jwt` + `session` callbacks to put `firmId` on the session; audit every query for `where: { firmId }`. |
| SAML/OIDC SSO | Auth.js provider — likely only when a >50-user firm asks. |

## Multi-tenant readiness notes

The current setup is single-firm but the seams are in place:
- `getCurrentUserId()` / `requireUser()` is the only chokepoint app code uses to learn who the user is. When `firmId` lands, expose `getCurrentUserContext(): { userId, firmId }` alongside it; existing callers keep working.
- The `session` callback in `src/auth.ts` is where we'll attach `firmId` to the JWT — one line.
- The `Account` adapter table already supports the multi-firm pattern (a Google account belongs to a `userId`, that userId can later belong to a `firmId`).
- The bigger lift is the per-query audit (`where: { firmId }` everywhere); not blocking auth work.

## Operational notes

- **Rotating `AUTH_SECRET`**: generate a new value with `openssl rand -base64 32`, replace in `.env`, restart. Every existing session is invalidated (everyone gets logged out). Acceptable in dev; in prod we'd plan around it.
- **Changing or resetting a password**: signed-in users use the change-password page (`/settings/security`); an admin can reset a member from Settings, Team. In a dev database, re-seeding also resets every demo user, but only do that deliberately: set `SEED_ADMIN_PASSWORD` to choose the password, otherwise the seed generates a random one and prints it once at the end of the run (no password is stored in the repo).
- **Dev login**: the seeded admin email (see `prisma/seed.ts`) with the password from `SEED_ADMIN_PASSWORD` or the one-time printed password. The other seed users share that password.
- **The seed is destructive and guarded**: `prisma/seed.ts` (and `npm run db:reset`, via the guard in `prisma.config.ts`) refuse to run unless every configured database URL points at localhost / 127.0.0.1 / ::1, or you set `ALLOW_SEED=1` for a known dev database. Production-looking environments are always refused. See `src/lib/seed-guard.ts`.
