# Auth Plan

Living plan for authentication & authorization across LawCRM. Phase 1
(email + password) shipped 2026-04-25. Everything past Phase 1 is
deferred until concrete demand surfaces.

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
- `src/app/(dashboard)/layout.tsx` — **Authoritative auth gate.** Calls `auth()` and bounces to `/login` when `session.user.id` is undefined. The proxy is fast-path; this layer is where real validation happens.
- `src/lib/current-user.ts` — `getCurrentUserId()` reads from `auth()`, `redirect("/login")` on miss. Also enforced for completeness — the layout is the primary gate.
- `src/app/actions/auth.ts` — `loginAction` + `logoutAction` server actions.
- `src/app/login/page.tsx` + `src/components/auth/login-form.tsx` — form UI. Skip-the-form check uses `session?.user?.id` (not `session?.user`) so a stale cookie can't cause a redirect loop.
- `src/types/next-auth.d.ts` — module augmentation that types `session.user.id` as optional (undefined = stale / invalid session).

### Security: defense-in-depth against stale JWTs

Three layers cooperate:
1. **JWT callback** validates the user against the DB on every request. If gone or inactive, strips `userId` from the token.
2. **Dashboard layout** calls `auth()` and bounces to `/login` when `session.user.id` is undefined. Catches any page that doesn't explicitly call `getCurrentUserId()`.
3. **Login page** detects a stale-but-cryptographically-valid cookie (`session` exists but `session.user.id` is undefined) and renders the form so the user can re-auth — submitting overwrites the cookie with a fresh JWT.

The proxy remains optimistic (cookie-presence only) so it's fast and Edge-compatible; the heavy lifting happens in the layout.

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
- `getCurrentUserId()` reads the session, redirects to `/login` if absent.
- Sign-out button in the sidebar profile strip.
- Seed users get hashed passwords; the dev password is printed once at seed end.
- `Account` + `VerificationToken` tables exist so adding Google later is config-only.

## What's deferred (and where it'd go when we revisit)

| Feature | Where it lands later |
|---|---|
| Google OAuth | Append `Google()` to `providers` in `src/auth.ts`, set `AUTH_GOOGLE_*` envs. The `Account` table is already there. |
| Other OAuth (Microsoft 365, GitHub, etc.) | Same drill — Auth.js providers list. |
| Password reset | New `/forgot-password` + `/reset-password?token=…` routes; emit single-use hashed tokens via the `VerificationToken` table; invalidate sessions on reset. |
| Email verification | Send-on-signup + on-email-change; consume tokens via `VerificationToken`; flip `User.emailVerified`. |
| MFA / TOTP | New `User.totpSecret` + `RecoveryCode` table; second step in the login flow; `/account/mfa` enroll. |
| Session list / revoke individual sessions | Switch `session.strategy` from `"jwt"` to `"database"`, add `Session` table, build `/account/sessions` UI. |
| Idle timeout / absolute lifetime | Session callback timestamps; configurable in firm settings. |
| Account lockout | Counter on `User` (or separate `LoginAttempt` table) + cooldown window. |
| Pwned-passwords corpus check | Call HaveIBeenPwned k-anonymity range API in the credentials authorize step. |
| RBAC / roles / permissions | `User.role` already exists. Add `requirePermission(perm)` helper, codify role→permission map in `src/lib/permissions.ts`, gate UI + actions. |
| Audit log of auth events | Reuse `ActivityLog` (or new `AuthEvent` table) — write on login_success, login_failure, logout, password_change, role_change. |
| Rate limiting | In-process bucket today (none); Redis/Upstash sliding window in prod. |
| Re-auth challenge for sensitive actions | Custom `requireRecentAuth(maxAgeMin)` helper checking session age. |
| Multi-tenancy (`firmId` on session) | Add `Firm` model + `User.firmId`; extend the `jwt` + `session` callbacks to put `firmId` on the session; audit every query for `where: { firmId }`. |
| SAML/OIDC SSO | Auth.js provider — likely only when a >50-user firm asks. |

## Multi-tenant readiness notes

The current setup is single-firm but the seams are in place:
- `getCurrentUserId()` is the only chokepoint app code uses to learn who the user is. When `firmId` lands, expose `getCurrentUserContext(): { userId, firmId }` alongside it; existing callers keep working.
- The `session` callback in `src/auth.ts` is where we'll attach `firmId` to the JWT — one line.
- The `Account` adapter table already supports the multi-firm pattern (a Google account belongs to a `userId`, that userId can later belong to a `firmId`).
- The bigger lift is the per-query audit (`where: { firmId }` everywhere); not blocking auth work.

## Operational notes

- **Rotating `AUTH_SECRET`**: generate a new value with `openssl rand -base64 32`, replace in `.env`, restart. Every existing session is invalidated (everyone gets logged out). Acceptable in dev; in prod we'd plan around it.
- **Resetting a forgotten password in dev**: re-run `npm run db:seed` — every dev user is reset to `ChangeMe2026!`.
- **Dev login**: `jkosloski@kosloskilaw.com` / `ChangeMe2026!`. Other seed users (`leo`, `rachel`, `marco`, `elena` `@kosloskilaw.com`) use the same password.
