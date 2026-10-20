# Clerk Staff Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Auth.js credentials sign-in for staff with Clerk (Google Workspace SSO only), keeping the local `User` table as the authority for access.

**Architecture:** Clerk proves identity; `src/lib/staff-auth.ts` maps a Clerk user to an active `User` by `clerkUserId` (linking once by verified email) and every existing guard (`getSession` → `getCurrentUserId` → `requireUser` / `requirePermission`) keeps its signature. `src/proxy.ts` short-circuits the portal host before Clerk ever runs, then delegates the staff host to `clerkMiddleware`. Admin actions call Clerk's Backend API through one thin wrapper (`src/lib/clerk-admin.ts`); sign-in/out history arrives by signed webhook.

**Tech Stack:** `@clerk/nextjs` 7.9.x (Core 3), Next.js 16.4 (`proxy.ts`), Prisma 7, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-clerk-staff-auth-design.md`

## Global Constraints

- Staff only. Portal auth (ADR-051, `src/lib/portal/*`, `PortalSession`) is not touched, except that `AUTH_SECRET` stays because `src/lib/portal/secrets.ts` uses it.
- Clerk instance config: Google only, `@kosloskilaw.com`; Access mode **Invite-only (restricted)**; inactivity timeout **12 hours**; maximum lifetime **7 days**.
- Guard signatures unchanged: `getSession(): Promise<{ user: { id: string } } | null>`, `getCurrentUserId(): Promise<string>`, `requireUser(): Promise<string>`.
- `@clerk/nextjs/server` `auth()` THROWS when `clerkMiddleware` did not run on the request. Never call it on the portal host or on `api/documents/upload` (excluded from the matcher); those paths use the request-based reader (Task 2).
- `clerkClient()` is async: `const c = await clerkClient()`.
- Audit rows: `ActivityLog` `type: "auth"`, `matterId: null`, via `logAuthEvent` (`src/lib/auth-events.ts`), fire-and-forget.
- Every Clerk Backend call goes through `src/lib/clerk-admin.ts` and returns `{ ok: true } | { ok: false; error: string }`; callers never throw on a Clerk failure after a DB commit.
- Commit with explicit pathspec: `git commit -m "…" -- <paths>`; never leave files staged. Test DB: `docker compose -f docker-compose.test.yml up -d`.
- Two migrations; the drop migration (Task 10) only runs when the user says the cutover is stable.

## Review Focus

1. **Portal host never reaches Clerk.** A portal-host request to any staff route or server action must read signed-out without `auth()` throwing → covered in Task 2 (`staff-auth.test.ts`: "portal host → signed_out without calling Clerk").
2. **Signed in to Clerk but not a firm member** (unknown email, inactive, email linked to another Clerk id) must never pass `requireUser()` and must not loop between `/login` and `/no-access` → Task 2 (`current-user.test.ts`: no_access redirects to `/no-access`) and Task 3 (`login/page.test.tsx`: no_access on `/login` redirects to `/no-access`, not back to `/`).
3. **Deactivated user with a live Clerk session** loses access on the next request even if the Clerk ban call fails → Task 4 (`team-clerk.test.ts`: ban failure still returns warning and `getStaffAuth` reports no_access).
4. **Revoking someone else's session id** from Settings → Security must be refused → Task 5 (`security-sessions.test.ts`: session owned by another Clerk user → error, no revoke call).
5. **Webhook replay / unknown user** (Svix retries, a session for a Clerk user we never linked) must not duplicate audit rows or throw → Task 6 (`route.test.ts`: same svix-id twice → one row; unknown user_id → row with `userId` null).

---

### Task 1: Clerk SDK, env and the `clerkUserId` column

**Files:**
- Modify: `package.json` (add `@clerk/nextjs@^7.9.17`; nothing removed yet)
- Modify: `prisma/schema.prisma` (`User`)
- Create: `prisma/migrations/<timestamp>_user_clerk_user_id/migration.sql` (generated)
- Modify: `src/lib/env-check.ts`, `.env.example` (if present)
- Test: `src/lib/env-check.test.ts`

**Interfaces:**
- Produces: `User.clerkUserId String? @unique` (doc comment: "Clerk user id; null until first Google sign-in links this row (src/lib/staff-auth.ts)").

- [ ] **Step 1:** `npm install @clerk/nextjs@^7.9.17`; `vercel env pull .env.local` and confirm `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are present (Marketplace-provisioned). If absent, stop and ask the user.
- [ ] **Step 2:** Add the column; `npx prisma migrate dev --name user_clerk_user_id`; `npm run check:migrations` → passes.
- [ ] **Step 3:** Failing test in `env-check.test.ts`: missing `CLERK_SECRET_KEY` or `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is reported like the existing required keys; `AUTH_SECRET` stays required (portal).
- [ ] **Step 4:** Add both keys to the required list in `src/lib/env-check.ts`; run `npx vitest run src/lib/env-check.test.ts` → PASS.
- [ ] **Step 5:** Commit `-- package.json package-lock.json prisma/schema.prisma prisma/migrations/<dir> src/lib/env-check.ts src/lib/env-check.test.ts`.

### Task 2: Staff identity resolver and guards

**Files:**
- Create: `src/lib/staff-auth.ts`, `src/lib/staff-auth.test.ts`, `src/lib/staff-auth.integration.test.ts`
- Modify: `src/lib/session.ts`, `src/lib/current-user.ts`, `src/lib/current-user.test.ts`, `src/app/(dashboard)/layout.tsx` (+ its test), `src/lib/auth-events.ts`
- Create: `src/app/no-access/page.tsx` (+ `page.test.tsx`)
- Modify (move off `@/auth` to `getSession` / `getStaffAuthFromRequest`): the route handlers in `src/app/api/{email-attachments/[id]/download,documents/[id]/download,documents/upload,documents/upload/blob,integrations/google/callback,integrations/google/connect}` and the 14 tests that `vi.mock("@/auth")` (list: `grep -rln 'vi.mock("@/auth"' src`) → they mock `@/lib/session` instead.

**Interfaces:**
- Produces (`src/lib/staff-auth.ts`, `import "server-only"`):
  ```ts
  export type StaffAuth =
    | { status: "signed_out" }
    | { status: "no_access"; clerkUserId: string }
    | { status: "ok"; userId: string; clerkUserId: string; sessionId: string };
  export const getStaffAuth: () => Promise<StaffAuth>;           // React cache()d
  export function getStaffAuthFromRequest(req: Request): Promise<StaffAuth>; // for matcher-excluded routes
  export function resolveStaffUser(clerkUserId: string, sessionId: string): Promise<StaffAuth>; // DB + linking, exported for tests
  ```
- Produces: `getSession()` returns `{ user: { id } }` only for `status: "ok"`, else `null`. `getCurrentUserId()` redirects `signed_out` → `/login`, `no_access` → `/no-access`.
- Produces: `AuthEventKind` gains `"account_linked" | "no_access" | "session_revoked" | "signed_out_everywhere" | "sign_in_link_reset" | "clerk_banned" | "clerk_unbanned"` with titles `"Linked Google sign-in"`, `"Signed in without firm access"`, `"Session revoked"`, `"Signed out everywhere by an administrator"`, `"Sign-in link reset by an administrator"`, `"Sign-in blocked (deactivated)"`, `"Sign-in unblocked (reactivated)"`. Password/lockout kinds are removed in Task 7, not here.

Behaviour of `getStaffAuth` (order matters):
1. `await requestIsOnPortalHost()` → `signed_out`, without importing-and-calling Clerk.
2. `auth()` from `@clerk/nextjs/server`; no `userId` → `signed_out`.
3. `resolveStaffUser(userId, sessionId)`:
   a. `User` where `clerkUserId` = id: active → `ok`; inactive → `no_access`.
   b. Not linked: `(await clerkClient()).users.getUser(id)`; take the primary email address whose `verification.status === "verified"` (none → `no_access`). Lowercase it. `updateMany({ where: { email, isActive: true, clerkUserId: null }, data: { clerkUserId: id } })`; count 1 → log `account_linked`, re-read → `ok`; count 0 → log `no_access` (with the matched `userId` when an email row exists, else null) → `no_access`.
   c. A Clerk API failure during linking → `no_access` and `console.error` (fail closed).

`getStaffAuthFromRequest(req)` does the same with `(await clerkClient()).authenticateRequest(req)` → `toAuth()` instead of `auth()`; used by `api/documents/upload/route.ts` only (the matcher excludes it so the proxy never buffers its body).

`/no-access` page: not a guard-protected page (add to the `page-guards.test.ts` allowlist with a comment). Copy: heading "No access to Kosloski Law CRM", body "You're signed in with Google, but this account isn't set up as a firm member. Ask an administrator to invite you.", a Sign out button (Task 3's `SignOutButton`). If `getStaffAuth()` is `ok`, redirect to `/`; if `signed_out`, redirect to `/login`.

- [ ] **Step 1: Failing unit tests** (`staff-auth.test.ts`, mocking `@clerk/nextjs/server` and `@/lib/portal/host`):
  - `portal host → signed_out without calling Clerk` (assert the `auth` mock was not called).
  - `no Clerk user → signed_out`.
- [ ] **Step 2: Failing integration tests** (`staff-auth.integration.test.ts`, real test DB, `clerkClient` mocked):
  - linked + active → `{ status: "ok", userId }`.
  - linked + inactive → `no_access`.
  - unlinked, verified email matches an active unlinked user → links (`clerkUserId` set), one `account_linked` row, `ok`.
  - verified email matches a user already linked to a different Clerk id → `no_access`, row unchanged.
  - email unverified → `no_access`.
  - **race:** two `resolveStaffUser` calls for two different Clerk ids with the same email via `Promise.all` → exactly one `ok`, one `no_access`; DB holds one `clerkUserId`.
  - `getUser` rejects → `no_access`.
- [ ] **Step 3:** Run both → FAIL (module missing).
- [ ] **Step 4:** Implement `src/lib/staff-auth.ts`; rewrite `src/lib/session.ts` (`getSession = cache(async () => { const a = await getStaffAuth(); return a.status === "ok" ? { user: { id: a.userId } } : null; })`); update `getCurrentUserId` for the two redirects; dashboard layout sends `no_access` to `/no-access` (keep the `?next=` logic for `signed_out`).
- [ ] **Step 5:** Add to `current-user.test.ts`: `no_access → redirect("/no-access")`; `signed_out → redirect("/login")`. Add `no-access/page.test.tsx` for the three branches.
- [ ] **Step 6:** Move the six route handlers and the 14 `@/auth` mocks over; upload route uses `getStaffAuthFromRequest(request)` and answers 401 for anything but `ok`.
- [ ] **Step 7:** `npx vitest run src/lib src/app/api src/app/no-access "src/app/(dashboard)/layout.test.tsx" src/app/page-guards.test.ts` → PASS. `npm run typecheck` may still fail only on files Task 3/7 replace (`src/auth.ts`, login, auth actions); note them, do not stub.
- [ ] **Step 8:** Commit with explicit paths.

### Task 3: Proxy, CSP, provider, sign-in / sign-out UI

**Files:**
- Modify: `src/proxy.ts` (+ `src/proxy.test.ts` if present, else create)
- Modify: `src/lib/csp.ts`, `src/lib/csp.test.ts`
- Create: `src/components/auth/staff-clerk-provider.tsx`, `src/components/auth/google-sign-in-button.tsx` (+ test), `src/components/auth/sign-out-button.tsx`
- Create: `src/app/sso-callback/page.tsx`
- Modify: `src/app/login/page.tsx`, `src/app/login/page.test.tsx`; `src/app/(dashboard)/layout.tsx`, `src/app/print/layout.tsx`, `src/app/no-access/page.tsx` (wrap in provider); `src/components/layout/sidebar-nav.tsx` (sign-out)

**Interfaces:**
- Consumes: `getStaffAuth` (Task 2).
- Produces: `clerkFrontendApiOrigin(publishableKey: string | undefined): string | null` in `src/lib/csp.ts` — decodes the base64 segment after `pk_test_`/`pk_live_`, strips the trailing `$`, returns `https://<host>`; null on malformed/missing. `pageCsp` adds, when non-null: that origin to `script-src` and `connect-src`; `https://challenges.cloudflare.com` and `https://*.protect.clerk.com` to `script-src` and `frame-src`; `https://*.protect.clerk.com` to `connect-src`; `https://img.clerk.com` is already covered by `img-src https:`. `worker-src 'self' blob:` already present.
- Produces: `<StaffClerkProvider>` — server component reading the nonce from the request CSP header (same source Next uses) and rendering `<ClerkProvider dynamic nonce={nonce} signInUrl="/login">`. Used only on staff surfaces, never the root layout (portal pages must not load Clerk).
- Produces: `<SignOutButton />` — client; `useClerk().signOut({ redirectUrl: "/login" })`.

Proxy shape (`src/proxy.ts`):
```ts
const staffProxy = clerkMiddleware(async (auth, request) => { /* existing staff-host logic */ });
export function proxy(request: NextRequest, event: NextFetchEvent) {
  // portal 404 for /portal on staff host, portal rewrite, static skip: unchanged, BEFORE Clerk
  if (onPortalHost || staticSkip) return /* existing response */;
  return staffProxy(request, event);
}
```
Inside the handler: public paths become `/login`, `/sso-callback`, `/no-access`, `/api/csp-report`, `/api/webhooks/clerk` (the last one is also added to `SELF_AUTHENTICATED_PATHS`); `/api/auth` is removed from the list. The cookie-presence check becomes `const { userId } = await auth(); if (!userId) redirect to /login?next=…` (same `next` construction). Keep `x-pathname` and CSP headers on every returned response. Matcher unchanged (still excludes `api/documents/upload$`).

Login page: `getStaffAuth()`; `ok` → `redirect(next)`; `no_access` → `redirect("/no-access")`; else render the Google button inside `StaffClerkProvider`. `GoogleSignInButton({ next })` calls `signIn.sso({ strategy: "oauth_google", redirectCallbackUrl: "/sso-callback", redirectUrl: next })` and shows "Sign-in is temporarily unavailable" on error. `/sso-callback` renders `<HandleSSOCallback>` (requires ≥7.9.13); verify the prop names against the installed `.d.ts` before writing.

- [ ] **Step 1: Failing tests:** `csp.test.ts` — `clerkFrontendApiOrigin("pk_test_" + btoa("foo-bar-1.clerk.accounts.dev$")) === "https://foo-bar-1.clerk.accounts.dev"`, malformed → null, `pageCsp` contains the origin in `script-src` and `connect-src` and `challenges.cloudflare.com` in `frame-src`. `proxy.test.ts` — portal-host request returns the rewrite and the Clerk middleware mock is never invoked; staff request with no Clerk user → 307 to `/login?next=%2Fmatters`; `/api/webhooks/clerk` passes without a session. `login/page.test.tsx` — the three `getStaffAuth` branches.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as above. Delete `src/components/auth/login-form.tsx` and its test.
- [ ] **Step 4:** Run the three test files → PASS; `npm run dev`, sign in at `http://localhost:3000/login` with the dev instance → lands on `/` as the seeded admin (`jkosloski@kosloskilaw.com` links); sign out returns to `/login`; `http://portal.localhost:3000/login` still shows the portal page and the browser console shows no CSP violations from Clerk on the staff host.
- [ ] **Step 5:** Commit.

### Task 4: Clerk admin wrapper and Team actions

**Files:**
- Create: `src/lib/clerk-admin.ts`, `src/lib/clerk-admin.test.ts`
- Modify: `src/app/actions/team.ts`, `src/components/settings/member-row.tsx`
- Test: `src/app/actions/team-clerk.test.ts` (new); update `src/app/actions/team-integrity.test.ts` (drop reset/unlock cases)

**Interfaces:**
- Produces (`src/lib/clerk-admin.ts`, `server-only`), all returning `Promise<ClerkResult>` where `type ClerkResult = { ok: true } | { ok: false; error: string }`:
  - `inviteStaff(email: string)` — `invitations.createInvitation({ emailAddress, redirectUrl: <APP_URL>/login, notify: true, ignoreExisting: true })`.
  - `banStaff(clerkUserId: string)` — `users.banUser` THEN `revokeAllStaffSessions` (ban is not verified to revoke sessions).
  - `unbanStaff(clerkUserId: string)` — `users.unbanUser`.
  - `revokeAllStaffSessions(clerkUserId: string)` — page through `sessions.getSessionList({ userId, status: "active" })`, `sessions.revokeSession(id)` each.
  - `listActiveStaffSessions(clerkUserId: string): Promise<{ ok: true; sessions: StaffSessionInfo[] } | { ok: false; error: string }>` with `StaffSessionInfo = { id: string; lastActiveAt: Date; browser: string | null; device: string | null; location: string | null; ipAddress: string | null }` (from the session's `latestActivity`; check field names in `@clerk/backend` types).
  - `revokeStaffSession(clerkUserId: string, sessionId: string)` — `sessions.getSession(sessionId)`; refuse with `{ ok: false, error: "Not your session." }` if its `userId !== clerkUserId`; else revoke.
  - Errors: catch everything, `console.error`, return `{ ok: false, error: "Couldn't reach the sign-in service." }`.
- Produces (`src/app/actions/team.ts`):
  - `inviteFirmMember` — no temp password; after the transaction call `inviteStaff`; on failure the state carries `warning: "Member added, but the invitation email didn't send. Use Resend invite."`.
  - `resendFirmMemberInvite(userId: string)` — only when `clerkUserId` is null.
  - `updateFirmMember` — after commit, on `isActive` true→false with `clerkUserId`: `banStaff` + log `clerk_banned`; false→true: `unbanStaff` + `clerk_unbanned`; failure → `warning: "Signed out locally; Clerk didn't confirm. Retry from the member menu."`.
  - `signOutFirmMemberEverywhere(userId: string)` and `resetFirmMemberSignInLink(userId: string)` (sets `clerkUserId` null, then `revokeAllStaffSessions` on the old id).
  - All new actions: `requirePermissionResult("firm.manage_team_directory")`, the existing Admin-target escalation guard (`ADMIN_TARGET_MESSAGE`-style check used by `resetFirmMemberPassword`), no self-target for reset-link, `logAuthEvent`, `revalidatePath("/settings/team")`.
  - Removed: `resetFirmMemberPassword`, `unlockFirmMemberSignIn`, `generateTempPassword`, `hashPassword` use.

- [ ] **Step 1: Failing tests** (`clerk-admin.test.ts`, `clerkClient` mocked): `banStaff` calls `banUser` then revokes each active session across two pages; `revokeStaffSession` refuses a session whose `userId` differs and never calls `revokeSession`; a thrown Clerk error → `{ ok: false }`.
- [ ] **Step 2: Failing tests** (`team-clerk.test.ts`, test DB, `@/lib/clerk-admin` mocked): invite calls `inviteStaff(email)` and creates the user with `passwordHash` null; invite with `inviteStaff` failing still creates the user and returns the warning; deactivate calls `banStaff(clerkUserId)`; **ban failure returns the warning AND `resolveStaffUser(clerkUserId, "s")` reports `no_access`**; reactivate calls `unbanStaff`; non-admin cannot sign out / reset-link an Admin; reset-link nulls `clerkUserId`.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement; replace the Reset password / Unlock items in `member-row.tsx` with "Sign out everywhere", "Reset sign-in link" (both confirm dialogs via the existing confirm pattern) and "Resend invite" (only when never signed in — pass `hasSignedIn: clerkUserId != null` from the Team page query, never the id itself).
- [ ] **Step 5:** Run `npx vitest run src/lib/clerk-admin.test.ts src/app/actions/team-clerk.test.ts src/app/actions/team-integrity.test.ts` → PASS. **Step 6:** Commit.

### Task 5: Settings → Security devices

**Files:**
- Modify: `src/app/(dashboard)/settings/security/page.tsx` (+ `page.test.tsx`)
- Create: `src/app/actions/security-sessions.ts`, `src/app/actions/security-sessions.test.ts`, `src/components/settings/session-list.tsx`
- Delete: `src/components/settings/change-password-form.tsx`, `src/lib/security-form.ts` (+ tests)

**Interfaces:**
- Consumes: `getStaffAuth` (Task 2), `listActiveStaffSessions`, `revokeStaffSession` (Task 4).
- Produces: `revokeMySession(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }>` — identity-scoped (no permission key, like the page); requires `getStaffAuth()` `ok`; refuses `sessionId === auth.sessionId` with "Use Sign out for this device."; logs `session_revoked`; `revalidatePath("/settings/security")`.

Page: "Signed-in devices" card (browser · device · location · last active in the user's zone, "This device" badge on `auth.sessionId`, Revoke button on others); "Sign-in history" card stays, filtered by the remaining `AUTH_EVENT_TITLES`; Clerk unreachable → card shows "Couldn't load devices right now." Header doc comment updated (no more "change password").

- [ ] **Step 1: Failing tests:** `revokeMySession` with a session owned by another Clerk user → error, `revokeStaffSession` returned refusal and no audit row; current session → refusal; own other session → ok + one `session_revoked` row. Page test: renders devices from the mocked list; Clerk failure renders the fallback text.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit.

### Task 6: Clerk webhook → audit trail

**Files:**
- Create: `src/app/api/webhooks/clerk/route.ts`, `src/app/api/webhooks/clerk/route.test.ts`
- Modify: `src/lib/env-check.ts` (warn, not fail, when `CLERK_WEBHOOK_SIGNING_SECRET` is unset)

**Interfaces:**
- `POST` only. `verifyWebhook(request)` from `@clerk/nextjs/webhooks` (env `CLERK_WEBHOOK_SIGNING_SECRET`); throw → `401`. Handles `session.created` → `sign_in`, `session.ended` / `session.removed` → `sign_out`, `session.revoked` → `session_revoked`; other types → `200` no-op. Maps `data.user_id` to `User.clerkUserId` (null when unknown). Detail: `Session <data.id>`. Dedupe: skip when an `auth` row with the same title and detail already exists. Writes audit rows only; never updates `User`. Returns `200` on success.

- [ ] **Step 1: Failing tests** (`verifyWebhook` mocked): bad signature → 401, no rows; `session.created` for a linked user → one "Signed in" row with that `userId`; same payload delivered twice → still one row; unknown `user_id` → row with `userId` null; `user.updated` → 200, no rows; assert `prisma.user.update` never called.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** In Clerk dashboard (dev instance) add the endpoint for the four session events; put the signing secret in Vercel env + `.env.local`. For local delivery use a tunnel only if the user wants it; otherwise verify on the preview deploy. **Step 6:** Commit.

### Task 7: Remove Auth.js and passwords

**Files:**
- Delete: `src/auth.ts`, `src/auth.test.ts`, `src/app/api/auth/[...nextauth]/`, `src/types/next-auth.d.ts`, `src/app/actions/auth.ts` (+ test), `src/lib/credentials-authorize.ts`, `src/lib/session-token.ts`, `src/lib/session-fingerprint.ts`, `src/lib/argon2-options.ts`, `src/lib/password-policy.ts`, `src/lib/auth-form.ts` (each with its tests), and anything `grep -rln "next-auth\|argon2\|@/auth\"" src prisma scripts` still finds
- Modify: `package.json` (remove `next-auth`, `@auth/prisma-adapter`, `argon2`), `prisma/seed.ts` (no password hashing; drop `SEED_ADMIN_PASSWORD` handling and its printout; seeded staff keep their `@kosloskilaw.com` emails and `clerkUserId` null), `src/lib/auth-events.ts` (remove `sign_in_failed`, `sign_in_blocked`, `password_changed`, `password_change_failed`, `sign_in_unlocked`; keep existing rows readable — `/settings/activity` shows titles as stored), `src/proxy.ts` comments

- [ ] **Step 1:** Delete / edit; `npm install`.
- [ ] **Step 2:** `grep -rn "next-auth\|argon2\|passwordHash\|@/auth\"" src prisma/seed.ts scripts` → only the schema field and generated client remain.
- [ ] **Step 3:** `npm run typecheck && npm run lint` → clean. `npm test` → all pass (Docker test DB up).
- [ ] **Step 4:** `npm run db:reset` on the local DB → seed runs without argon2. **Step 5:** Commit.

### Task 8: Dev sign-in-as and the pre-flight script

**Files:**
- Create: `src/app/dev/sign-in-as/page.tsx`, `src/app/actions/dev-sign-in.ts` (+ test)
- Create: `scripts/clerk-preflight.ts`; add `"clerk:preflight": "tsx scripts/clerk-preflight.ts"` (or the repo's existing script runner) to `package.json`

**Interfaces:**
- `devSignInAs(userId: string)` — allowed only when `process.env.NODE_ENV !== "production"` AND the publishable key starts with `pk_test_`; else throws `notFound()`. Finds the active seeded `User`; if `clerkUserId` null, `users.createUser({ emailAddress: [email], skipPasswordRequirement: true })` and stores the id; `signInTokens.createSignInToken({ userId: clerkUserId, expiresInSeconds: 60 })`; returns the token for the client to complete with the `ticket` strategy, then `/`. Page lists active users with their job titles. (Clerk's dev instance accepts any email without verification for backend-created users; verify the `ticket` client call against the installed `.d.ts`.)
- Pre-flight prints active users whose email does not end with `@kosloskilaw.com`, and a count of users already linked. Read-only. Reads `DATABASE_URL`; refuses nothing (read-only) but prints the host it connected to first.

- [ ] **Step 1: Failing test:** `devSignInAs` in production mode or with a `pk_live_` key → `notFound`; in dev with a test key creates the Clerk user once (second call reuses `clerkUserId`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; add `/dev/sign-in-as` to the proxy public paths only when not production. **Step 4:** Run → PASS; manually sign in as `leo@kosloskilaw.com` and confirm his role's nav. **Step 5:** Commit.

### Task 9: Docs and ADRs

**Files:**
- Rewrite: `docs/features/auth.md` (end state: Clerk Google SSO, identity vs. access, linking, deactivation/ban, webhook audit, devices, dev sign-in-as, cutover checklist, open work: drop migration (Task 10), Microsoft sign-in, portal decision)
- Modify: `docs/features/settings-admin.md` (Team + Security sections), `docs/ROADMAP.md` (auth line → `[~]` Clerk staff auth), `docs/ARCHITECTURE.md` (auth flow paragraph, if it describes Auth.js), `docs/PERMISSIONS.md` (only if it mentions reset/unlock)
- Create: `docs/decisions/053-clerk-proves-identity-the-user-table-grants-access.md`; mark ADR-017 and ADR-020 `**Status:** Superseded by ADR-053`; update their rows and add 053 in `docs/decisions/README.md`
- Delete: `docs/superpowers/specs/2026-10-19-clerk-staff-auth-design.md`, this plan

The ADR records: Clerk for identity only; DB-authoritative deactivation (ban is belt-and-braces); one-time link by verified primary email with conditional update; portal host never reaches Clerk; staff-only scope and the recommendation that a future portal move use a separate Clerk application.

Cutover checklist in `auth.md` (for the user): create the Clerk production instance; Google Cloud OAuth client with Clerk's redirect URI and the app origin, set "In production"; enter it under Clerk → SSO connections → Google → custom credentials; add the DNS records from Clerk → Domains (DNS-only if behind Cloudflare); set restricted mode, Google-only, domain, session lifetimes; add the webhook and `CLERK_WEBHOOK_SIGNING_SECRET`; run `npm run clerk:preflight` against prod (read-only); deploy; confirm an invited Google account can sign in under restricted mode.

- [ ] **Step 1:** Write the docs. **Step 2:** Commit with explicit paths (`docs/decisions/README.md` may have another session's edits — commit only if the diff is ours, else ask).

### Task 10 (gated — only when the user confirms the cutover is stable): drop password columns

**Files:** `prisma/schema.prisma`, new migration, `docs/features/auth.md`, `docs/SCHEMA_NOTES.md` if it mentions these fields.

- [ ] **Step 1:** Remove `User.passwordHash`, `User.emailVerified`, `User.image`, `Account`, `VerificationToken`; `npx prisma migrate dev --name drop_authjs_tables`; `npm run check:migrations`; `npm test` → pass. **Step 2:** Remove the open-work line from `auth.md`. **Step 3:** Commit.
