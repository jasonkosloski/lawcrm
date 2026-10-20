# Clerk staff authentication — design

**Date:** 2026-10-19
**Tier:** Full (auth, permissions, schema change)
**Scope:** staff / firm-user sign-in only. The client portal keeps its own magic-link sign-in (ADR-051) unchanged; whether it moves to Clerk is a separate, later decision.

## Intent

Stop owning password auth. Clerk proves *who* a staff member is (Google Workspace SSO only) and manages their sessions; the app's own `User` table keeps deciding *what* they can do (roles, permissions, matter teams, ethical walls). Day-one wins: Google SSO and real session management (device list, per-device revoke, idle / absolute timeouts).

Constraints carried forward:
- Invite only; no self sign-up.
- Every page authenticates itself (ADR-028); guard signatures (`getSession`, `getCurrentUserId`, `requireUser`, `requirePermission`) stay the same so their ~300 callers do not change.
- Portal isolation (ADR-051): a staff session must read as signed out on the portal host.
- Google Calendar sync keeps its own OAuth tokens (ADR-011); signing in with Google grants no calendar access.

## 1. Clerk configuration (dashboard, not code)

- Clerk installed via the Vercel Marketplace (done 2026-10-19); keys arrive as Vercel env vars. Separate dev and production instances.
- Sign-in methods: **Google only**, restricted to `@kosloskilaw.com`. Email/password, email codes, other social providers off.
- Sign-up mode: **Restricted** (invitation only).
- Sessions: inactivity timeout **12 hours**, maximum lifetime **7 days**.
- Session token customised with the user's primary email as a claim, so first-sign-in linking needs no Backend API call.
- Production instance: own Google OAuth client (Google Cloud Console) and Clerk's DNS CNAMEs on `kosloskilaw.com`. Exact steps go in the plan.

## 2. App wiring

- `src/proxy.ts` wraps the existing proxy logic (portal-host rewrite, CSP nonce, self-authenticated paths) in `clerkMiddleware`. Staff host: optimistic gate only — no Clerk session → redirect to `/login?next=…`. Portal host: Clerk is not consulted.
- `/login`: one "Sign in with Google" button (custom button using Clerk's `signIn.authenticateWithRedirect`, in our design language), preserving `?next=`.
- Sidebar sign-out calls Clerk `signOut`.
- **Settings → Security:** the user's own signed-in devices with per-device revoke (Clerk `<UserProfile>` security section). Change-password removed.
- **CSP** (`src/lib/csp.ts`): add Clerk's Frontend API / script / image domains; pinned by CSP tests.

## 3. Identity mapping

**Schema:** `User.clerkUserId String? @unique`.

**`getSession()`** (still React-`cache()`d per request):
1. Portal host → `null`.
2. Clerk `auth()` → no Clerk user → `null`.
3. Active `User` with that `clerkUserId` → `{ user: { id } }` (same shape as today).
4. Otherwise try **linking**; on failure the request is "signed in to Clerk, not a firm member": guards send it to a **No access** page (explains, offers sign-out). `requireUser()` never passes it.

**Linking (first sign-in):** match the Clerk session's verified primary email to a `User` that is active and has `clerkUserId` null. Write it with a conditional update (`where: { id, clerkUserId: null }`) so concurrent first sign-ins link once. Log an `auth` ActivityLog row. After linking, matching is by Clerk id only (a later Google email change does not break it).

**Email already linked to another Clerk user** (e.g. Google account recreated) → No access. Settings → Team gets **Reset sign-in link** (clears `clerkUserId`; next sign-in relinks). Gated by `firm.manage_team_directory`, Admin targets admin-only (existing escalation guard).

**Invite** (`inviteFirmMember`): creates the `User` row as today minus the temp password, then creates a Clerk invitation for the email via the Backend API. If the Clerk call fails the row still exists; the admin sees a warning and can resend.

## 4. Deactivation, revocation, audit

- **Deactivate** (`updateFirmMember`, `isActive` off): DB is authoritative — `getSession()` only accepts active users, so access ends on the next request. After commit, **ban the user in Clerk** (kills sessions, blocks sign-in). Reactivate → unban. Clerk failure: user is still locked out locally; admin sees "Signed out locally; Clerk didn't confirm — retry"; failure logged.
- **Sign out everywhere** (Team page) replaces Reset password: revokes all of the user's Clerk sessions. Same permission and escalation guards.
- **Unlock sign-in** removed (no passwords; Clerk/Google own brute-force protection).
- **Audit** (`type: "auth"` ActivityLog): link, no-access attempt, ban/unban, sign-out-everywhere, link reset — from our code. Sign-in / sign-out from a **Clerk webhook** at `/api/webhooks/clerk` (`session.created`, `session.ended`, `session.revoked`): signature-verified, added to the proxy's self-authenticated paths, writes audit rows only, never mutates users. Unknown Clerk ids are logged with `userId` null.

## 5. Removal and schema

Two migrations, for rollback safety:
1. **Cutover:** add `User.clerkUserId`. Nothing dropped.
2. **~1 week later**, once stable: drop `User.passwordHash`, `User.emailVerified`, `User.image`, `Account`, `VerificationToken`.

Removed code: `next-auth`, `@auth/prisma-adapter`, `argon2`; `src/auth.ts`; `src/app/api/auth/[...nextauth]`; credentials-authorize, lockout, session fingerprint, session-token, argon2-options, auth-form libs; login form; `changePasswordAction`; `resetFirmMemberPassword`, `unlockFirmMemberSignIn`, temp-password generation; `src/types/next-auth.d.ts`. Every `auth()` / `session.user` caller (Google integration routes, document upload/download routes, dashboard layout, login page) moves to `getSession()`.

`AUTH_SECRET` stays: the portal's link-request HMAC (`src/lib/portal/secrets.ts`) uses it. Docs note it is portal-only now.

## 6. Dev, seed, cutover

- Seed: `SEED_ADMIN_EMAIL` (a real Google address) for the admin so local sign-in links; other seed users are demo data. Test users for other roles via Clerk dev instance (verify the mechanism during planning).
- Pre-flight script: list active users whose `email` is not a `@kosloskilaw.com` address (they would land on No access).
- At deploy everyone is signed out once and signs back in with Google, which links them.

## 7. Testing (Vitest, Docker test DB)

- `getSession`: linked; unlinked-but-linkable; inactive; email linked elsewhere → no access; portal host → null.
- Linking race: two concurrent links, exactly one wins (integration).
- Deactivate calls Clerk ban (mocked client); ban failure still blocks access; reactivate unbans.
- Sign-out-everywhere and reset-link: permission + Admin-target guards.
- Webhook: valid signature writes an audit row; bad signature → 401; no user mutation.
- CSP includes Clerk domains.
- `page-guards.test.ts` unchanged and passing.

## 8. Docs

- Rewrite `docs/features/auth.md` to the end state; update `settings-admin.md` and the ROADMAP auth line.
- New ADR: "Clerk proves identity; the app's User table grants access" (incl. DB-authoritative deactivation, link-by-verified-email, staff-only scope, note that a future portal move should use a separate Clerk application for isolation).
- Mark ADR-017 and ADR-020 Superseded; update `decisions/README.md`.
- Delete this spec and the plan in the commit that finishes the feature.

## Out of scope

Client portal auth; MFA policy beyond what Google Workspace enforces; Microsoft sign-in; multi-tenancy (`firmId` on session); per-route rate limiting.
