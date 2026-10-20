# Authentication

Staff sign in with Google through Clerk (restricted, invite-only). Clerk proves who someone is; the `User` table decides whether they may use the app ([ADR-053](../decisions/053-clerk-proves-identity-the-user-table-grants-access.md)). There is no self sign-up. The client portal has its own, separate identity ([ADR-051](../decisions/051-client-portal-identity-is-separate-from-staff-auth.md), [client-portal.md](client-portal.md)).
Related: [ADR-028](../decisions/028-layouts-are-not-auth-gates-every-page.md), [ADR-022](../decisions/022-security-header-baseline-no-csp-yet-and.md), [PERMISSIONS.md](../PERMISSIONS.md), [settings-admin.md](settings-admin.md)

Status: live in production on `litgox.com` since 2026-10-20.

## Open work
- [ ] **Microsoft sign-in** — add as a second Clerk SSO connection if a firm member needs it; linking is by verified primary email, so no change to the resolver is expected.
- [ ] **Portal auth decision** — the portal keeps magic links for now. If it moves to Clerk, use a separate Clerk application (ADR-053).
- [ ] Not built, would sit on Clerk: idle timeout / absolute lifetime (Clerk session settings), re-auth challenge for sensitive actions, multi-tenancy (`firmId` would attach in `getStaffAuth()`).

## What Clerk does vs what the User table does
- **Clerk:** Google sign-in, MFA (Google's), session issue and revoke, invitations, restricted sign-up, ban, the signed session webhook.
- **User table:** whether the Clerk identity is a firm member (`clerkUserId` link, `isActive`), roles and permissions, matter walls, and the audit trail. Clerk never grants anything; an unlinked, inactive or unverifiable identity is `no_access` (the `/no-access` page).
- **Fail closed:** a Clerk API error, an unverified primary email or an inactive user all resolve to `no_access`, never `ok`.

## How a request is authenticated
1. `src/proxy.ts` runs `clerkMiddleware` on the staff host: a cheap, DB-free redirect to `/login?next=…` when there is no verified Clerk session. It is a UX gate, not the authority.
2. Every page, layout, server action and route handler resolves the user through `getStaffAuth()` (`src/lib/staff-auth.ts`), request-cached, returning `signed_out`, `no_access` or `ok`. `getSession()` (`src/lib/session.ts`) adapts that to `{ user: { id } }` and is null unless `ok`. `getCurrentUserId()` / `requireUser()` (`src/lib/current-user.ts`) sit on it; every `page.tsx` / `layout.tsx` under `(dashboard)` and `print` must call a guard as its first `await` (ADR-028, enforced by `src/app/page-guards.test.ts`).
3. Public paths: `/login`, `/sso-callback`, `/no-access`, `/api/csp-report`. Machine endpoints that carry their own credential (cron, blob callback, Clerk webhook) are exact-match exemptions in the proxy.

## First-sign-in linking
The first time a Clerk user signs in, an ACTIVE `User` whose email matches the Clerk user's verified primary email (case-insensitive) and has no `clerkUserId` gets the Clerk id written by one conditional `updateMany` (`clerkUserId IS NULL`). Racing identities cannot both win; a linked row is never re-pointed; afterwards the Clerk id is the identity and email is never consulted. Success logs `account_linked`. If nothing can be linked, the resolver returns `no_access` and writes at most one `no_access` audit row per Clerk id per 15 minutes (every request from that visitor lands here, so it is deduped).

## Deactivation and Clerk ban
The database is authoritative: `isActive = false` denies on the very next request whatever the Clerk session says. Settings -> Team deactivate/reactivate also bans/unbans the Clerk user after the DB commit, as belt-and-braces (a member who never signed in has no Clerk user, so their pending invitation is revoked instead); a Clerk failure is reported as a warning because access is already denied. Wrapper: `src/lib/clerk-admin.ts` (`inviteStaff`, `revokeStaffInvitation`, `banStaff`, `unbanStaff`, `revokeAllStaffSessions`, `listActiveStaffSessions`, `revokeStaffSession`).

## Team sign-in management
`src/app/actions/team.ts`, gated by `firm.manage_team_directory` (Admin-class targets are Admin-only):
- **Invite** (`inviteFirmMember`): creates the `User` row and sends a Clerk invitation whose redirect is `staffAppUrl()`. **Resend invite** (`resendFirmMemberInvite`) re-sends it.
- **Edit** (`updateFirmMember`): profile, role and active flag (ban sync above).
- **Sign out everywhere** (`signOutFirmMemberEverywhere`): revokes all the member's Clerk sessions.
- **Reset sign-in link** (`resetFirmMemberSignInLink`): for when a person's Google/Clerk identity changed (e.g. the account was recreated). Revokes the old identity's sessions FIRST and only on success clears `clerkUserId` (a surviving session would otherwise re-link itself); a revoke failure returns an error and changes nothing. The same verified email links again on the next sign-in, so this is NOT a response to a compromised account: deactivate the member for that.

## Settings -> Security devices
`/settings/security` is identity-scoped (no permission key). It lists the user's live Clerk sessions (browser, device, location, last active, "This device" badge) and lets them revoke any other one via `revokeMySession` (`src/app/actions/security-sessions.ts`). The Clerk user id comes only from `getStaffAuth()` on the server; the client sends a session id and `revokeStaffSession` refuses a session that is not the caller's. The current device uses Sign out.

## Audit
`type: "auth"` `ActivityLog` rows via `src/lib/auth-events.ts`. Sign-in, sign-out and session-revoked rows come from `POST /api/webhooks/clerk` (Svix-verified with `CLERK_WEBHOOK_SIGNING_SECRET`; the signature is its only control, it never touches `User`, and rows are deduped per event and session). Link, no-access, invite, update, sign-out-everywhere, link reset and ban sync are written by the app. A first sign-in's `session.created` webhook row may have `userId` null if it arrives before the account is linked. Rows from the Auth.js era keep their titles on `/settings/activity`.

## Origins (STAFF_ORIGINS / authorizedParties)
Session tokens are verified against an explicit authorized-parties list from `staffAuthorizedParties()` (`src/lib/staff-authorized-parties.ts`), shared by the middleware and `authenticateRequest` so both agree. `STAFF_ORIGINS` (comma-separated bare origins, e.g. `https://crm.example.com`) is authoritative when set; otherwise it falls back to Vercel URLs and `AUTH_URL` minus anything on `PORTAL_HOST`. `localhost:3000` is added outside production. The list is never empty (Clerk treats empty as "skip the check"): with nothing configured, production rejects every token. A wrong list signs everyone out in a login loop. `staffAppUrl()` derives the invitation redirect from the same list.

## Portal-host isolation
The portal host never reaches Clerk. `src/proxy.ts` handles portal 404/rewrite/static paths before invoking `clerkMiddleware`, and `getStaffAuth()` / `getStaffAuthFromRequest()` return `signed_out` on the portal host before calling Clerk (whose `auth()` throws when its middleware did not run). Both session readers enforce it, not only the proxy (ADR-051).

## Upload route's request-based reader
`/api/documents/upload` is excluded from the proxy matcher so Next does not buffer (and truncate at 10 MB) multi-GB streamed bodies. With no middleware state to read, it authenticates with `getStaffAuthFromRequest(req)` (`authenticateRequest` with the same authorized parties), then checks `documents.upload`, answering JSON 401/403 instead of redirecting. `/api/documents/upload/blob` stays matched and is exempt as a self-authenticating path.

## Dev sign-in-as
`/dev/sign-in-as` signs a developer in as any active seeded user locally by minting a 60 s Clerk sign-in ticket and writes a "Signed in (dev impersonation)" audit row. One switch, `isDevSignInAllowed()` (`src/lib/dev-sign-in.ts`): explicit opt-in `DEV_SIGN_IN=1` (unset by default; with it on, anyone who can reach the dev server can sign in as any active user), not `NODE_ENV=production`, a `pk_test_` publishable key, not on Vercel, and a database `checkDestructiveDbAllowed` accepts (localhost, or a known dev DB via `ALLOW_SEED=1`). The page, the `devSignInAs` action and the proxy each check it independently, so any one alone keeps the backdoor shut.

## Cutover checklist (production)
1. Create the Clerk production instance.
2. Google Cloud: create an OAuth client with Clerk's redirect URI and the app origin, and set the consent screen to "In production". Enter it in Clerk -> SSO connections -> Google -> custom credentials.
3. Add the DNS records from Clerk -> Domains (DNS-only if the domain is behind Cloudflare).
4. Clerk settings: restricted sign-up mode, Google only, allowed domain, session lifetimes.
5. Add the webhook (session events) pointing at `/api/webhooks/clerk`; set `CLERK_WEBHOOK_SIGNING_SECRET`.
6. Vercel env: production `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`; set `STAFF_ORIGINS=https://litgox.com,https://www.litgox.com` (never `portal.litgox.com`); Clerk production is DNS-verified on `litgox.com` (`clerk.litgox.com`). `AUTH_SECRET` stays set: no longer used for staff sessions; keys the portal link-request HMAC and the Google integration's OAuth state. `src/lib/env-check.ts` flags missing values.
7. Run `npm run clerk:preflight` with an explicit production `DATABASE_URL`. It is read-only: it prints the DB host and the first 6 chars of the DB user, active users not on `@kosloskilaw.com`, and how many are already linked to Clerk. Confirm it is the production DB before trusting it.
8. Deploy; confirm an invited Google account signs in under restricted mode and links, and that an uninvited one lands on `/no-access`.

## Files to look at
- `src/proxy.ts` — host routing, Clerk gate, CSP nonce.
- `src/lib/staff-auth.ts` — `getStaffAuth`, `getStaffAuthFromRequest`, `resolveStaffUser` (linking).
- `src/lib/staff-authorized-parties.ts` — origins list, `staffAppUrl`.
- `src/lib/clerk-admin.ts` — Clerk Backend API wrapper (invite, ban, sessions, dev ticket).
- `src/lib/session.ts`, `src/lib/current-user.ts` — request-cached session and guards.
- `src/app/actions/team.ts` (sign-in management), `src/app/actions/security-sessions.ts`.
- `src/app/api/webhooks/clerk/route.ts` — audit webhook.
- `src/app/login`, `src/app/sso-callback`, `src/app/no-access`, `src/components/auth/` — sign-in UI.
- `src/lib/dev-sign-in.ts`, `src/app/dev/sign-in-as` — dev impersonation.
- `scripts/clerk-preflight.ts` — cutover pre-flight.

## Notes
- **The seed is destructive and guarded:** `prisma/seed.ts` and `npm run db:reset` (guard in `prisma.config.ts`) refuse unless every database URL is localhost / 127.0.0.1 / ::1, or `ALLOW_SEED=1` for a known dev DB; production-looking environments are always refused (`src/lib/seed-guard.ts`). Seeded users have no password; sign in locally with `/dev/sign-in-as`.
- **Multi-tenant seam:** `getStaffAuth()` is the only identity chokepoint; `firmId` would attach there. The real lift is auditing every query for `where: { firmId }`.
- **RBAC:** `Role` / `UserRole` / `RolePermission`, catalog in `src/lib/permissions.ts`, `requirePermission`. Matter-level team access is ADR-039 ([matter-access.md](matter-access.md)).
