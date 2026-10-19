# Client Portal Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invited contacts sign in to a host-isolated client portal by email magic link and see a list of the matters they were invited to. Staff invite and revoke them per matter.

**Architecture:**
- Same Next.js 16 app. `src/proxy.ts` rewrites requests for `PORTAL_HOST` into a `src/app/(portal)/portal` route group and 404s everything else on that host.
- Client identity, tokens and sessions are their own Prisma models with SHA-256-hashed secrets and a host-only cookie. None of it touches Auth.js.
- Staff manage access through permission-gated server actions behind matter-access walls.

**Tech Stack:** Next.js 16 (App Router, proxy.ts), Prisma 7 + Postgres, Vitest, Resend (HTTP API via `fetch`, no SDK), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-18-client-portal-foundation-design.md`. Read it first; this plan does not repeat its rationale.

## Global Constraints

- Login token lifetime: **15 minutes**. Invite token lifetime: **7 days**. Session idle window: **7 days**, absolute cap: **30 days** from creation, so `expiresAt = min(now + 7d, createdAt + 30d)`. Slide at most once per **60 s**.
- Throttles: **3 link requests per email per 15 min**; **20 per IP per 15 min**. Both are counted from `PortalLinkRequest` rows (hashed email and IP only). This replaces the spec's "count from the activity log": the house rule (`src/lib/auth-events.ts`) is never to log attempts for unknown accounts.
- Audit: portal events go through `logPortalEvent` (Task 6). It writes `ActivityLog` rows with `type: "auth"`, `userId: null` (the column is nullable), and a detail starting `portal identity <id>`. They are written only for real identities and never contain a token.
- Secrets: tokens are 32 random bytes (base64url). Only `sha256(hex)` is stored. The raw value appears only in the email link or the cookie.
- Cookie name: `__Host-portal_session` in production. In development (`NODE_ENV !== "production"`) it is `portal_session`, not Secure. Both are HttpOnly, SameSite=Lax, Path=/, with no Domain.
- Uniform link-request copy, exactly: `If that email has portal access, a link is on its way.`
- Used/expired link copy, exactly: `This link has expired or was already used.`
- Portal off copy, exactly: `The client portal is not available right now.`
- Permission keys: `portal.view`, `portal.invite`, `portal.revoke`, all granted by migration to roles holding `matters.edit`. The firm switch is gated on `firm.edit_info`.
- Every mutation lives in `src/app/actions/*.ts`, is logged with `logActivity` (type `"auth"` for sign-in events), and calls `revalidatePath`. Never query a matter by id alone: staff paths use `assertMatterAccess`, portal paths use `assertPortalMatterAccess`.
- Dates follow ADR-012. Docs are updated in the same commit (AGENTS.md). Commit with an explicit pathspec and never leave files staged; other sessions share the index.
- The next free ADR number is **051** (049 is reserved by the restricted-intake-walls work, 050 is taken).

## Review Focus

1. **Email case and whitespace:** `" Jane@Example.com "` must match an identity stored as `jane@example.com`, on both the request and the invite. (Task 6 and Task 8 tests.)
2. **Revoked-then-reinvited person:** they must regain access with the same `PortalMatterAccess` row, and their old invite tokens must not work. (Task 8 test.)
3. **Old link after a new one is requested:** the older token is dead. (Task 3 test.)
4. **Staff cookie on the portal host, portal cookie on the staff host:** neither authenticates. (Task 5 proxy test, Task 4 helper test.)
5. **Merged contact with a portal identity:** after `mergeContacts`, the survivor holds the identity and access, and nothing points at the retired contact. (Task 10 test.)

---

### Task 1: Schema, migration, permission keys

**Files:**
- Modify: `prisma/schema.prisma`: the four models exactly as in the spec "Data model" section, plus `model PortalLinkRequest { id String @id @default(cuid()); emailHash String; ipHash String; createdAt DateTime @default(now()); @@index([emailHash, createdAt]); @@index([ipHash, createdAt]) }`, back-relations on `Contact` (`portalIdentity PortalIdentity?`) and `Matter` (`portalAccess PortalMatterAccess[]`), and `Firm.portalEnabled Boolean @default(false)`.
- Create: `prisma/migrations/20261019090000_client_portal_foundation/migration.sql`, generated with `npx prisma migrate dev --create-only --name client_portal_foundation` against the **local test DB** (`DATABASE_URL=postgresql://lawcrm_test:lawcrm_test@localhost:5433/lawcrm_test`). Then append the data grant:
  ```sql
  INSERT INTO "role_permissions" ("roleId", "permission")
  SELECT DISTINCT "roleId", k FROM "role_permissions", unnest(ARRAY['portal.view','portal.invite','portal.revoke']) AS k
  WHERE "permission" = 'matters.edit'
  ON CONFLICT ("roleId", "permission") DO NOTHING;
  ```
- Modify: `src/lib/permissions.ts`: add a `portal` group with the three keys, labels "View client portal access", "Invite to client portal" and "Revoke client portal access", and one-line descriptions.
- Modify: `prisma/seed.ts`: delete the portal rows before contacts and matters.

**Interfaces:**
- Produces: Prisma models `PortalIdentity`, `PortalMatterAccess`, `PortalLoginToken`, `PortalSession`, `PortalLinkRequest` and the field `Firm.portalEnabled`.

- [ ] **Step 1:** Edit the schema and generate the migration as above, then append the grant SQL.
- [ ] **Step 2:** Run `npm run check:migrations`. Expected: `migrations match schema.prisma`.
- [ ] **Step 3:** Run `npx vitest run src/lib/permissions` (the catalog tests). Expected: PASS, and if a snapshot lists keys, update it to include the three new ones.
- [ ] **Step 4:** Commit: `git commit -m "feat(portal): schema, migration and permission keys for the client portal" -- prisma/ src/lib/permissions.ts`

### Task 2: Email driver

**Files:**
- Create: `src/lib/email/send.ts`, `src/lib/email/drivers.ts`, `src/lib/email/send.test.ts`
- Create: `src/test/email-capture.ts`, a test helper.

**Interfaces:**
- Produces:
  - `type OutgoingEmail = { to: string; subject: string; text: string; html: string }`
  - `sendEmail(msg: OutgoingEmail): Promise<{ ok: true } | { ok: false; error: string }>`
  - `src/test/email-capture.ts`: `captureEmails(): { sent: OutgoingEmail[]; restore(): void }`

- [ ] **Step 1: Write the failing tests**
  - `"console driver is used when RESEND_API_KEY is unset and logs the message"`: stub env, spy on `console.info`, call `sendEmail`, and expect `{ ok: true }` with the log containing the subject.
  - `"resend driver POSTs to https://api.resend.com/emails with bearer key and EMAIL_FROM"`: stub `fetch` to resolve `{ ok: true, json: async () => ({ id: "x" }) }`, then assert the URL, the `Authorization: Bearer k`, and a body with `from` taken from `EMAIL_FROM`.
  - `"resend non-2xx returns ok:false without throwing"`.
  - `"captureEmails records messages instead of sending"`.
- [ ] **Step 2:** Run `npx vitest run src/lib/email`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement.
  - Choose the driver per call: `RESEND_API_KEY` set means resend, otherwise console. The capture helper swaps in an in-memory driver via an exported `__setDriverForTests(driver | null)`.
  - Use `import "server-only"`.
- [ ] **Step 4:** Run `npx vitest run src/lib/email`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(email): sendEmail with Resend and console drivers`

### Task 3: Token and session core

**Files:**
- Create: `src/lib/portal/secrets.ts` (pure): `newSecret(): string` (32 bytes, base64url) and `hashSecret(s: string): string` (sha256 hex).
- Create: `src/lib/portal/tokens.ts`, `src/lib/portal/sessions.ts`
- Test: `src/lib/portal/tokens.integration.test.ts`, `src/lib/portal/sessions.integration.test.ts`

**Interfaces:**
- Produces:
  - `issueToken(identityId: string, purpose: "login" | "invite"): Promise<string>` returns the raw token. It marks the identity's other unused tokens of **either** purpose as used, and sets expiry to 15 min (login) or 7 days (invite).
  - `consumeToken(raw: string): Promise<{ identityId: string } | null>`: one conditional `updateMany` on `tokenHash`, `usedAt: null`, `expiresAt > now`.
  - `createSession(identityId: string): Promise<string>` returns the raw cookie value.
  - `resolveSession(raw: string): Promise<{ sessionId: string; identityId: string } | null>`: returns null if the session is expired or the identity is disabled. When `lastSeenAt` is older than 60 s it sets `lastSeenAt = now` and `expiresAt = min(now + 7d, createdAt + 30d)`.
  - `deleteSession(raw: string): Promise<void>`
  - `deleteSessionsFor(identityId: string): Promise<number>`

- [ ] **Step 1: Write the failing tests** (seed an identity with `prisma.portalIdentity.create` on a `seedContact`):
  - `"a token works once"`: the first `consumeToken` returns `{identityId}`, the second returns `null`.
  - `"two concurrent consumes: exactly one wins"`: `Promise.all` of two consumes yields exactly one non-null result.
  - `"expired token is rejected"`: set `expiresAt` in the past and expect `null`.
  - `"issuing a new token kills the old one"` (Review Focus 3).
  - `"only the hash is stored"`: no row's `tokenHash` equals the raw token.
  - `"login tokens last 15 minutes, invite tokens 7 days"`: assert `expiresAt - createdAt` within ±5 s.
  - `"session resolves, then fails after expiry"`.
  - `"session for a disabled identity does not resolve"`.
  - `"use slides expiry to now + 7 days"`: set `lastSeenAt` 2 min ago, resolve, and expect `expiresAt` ≈ now + 7d.
  - `"sliding never passes createdAt + 30 days"`: set `createdAt` 29d23h ago and expect `expiresAt <= createdAt + 30d`.
  - `"deleteSessionsFor removes every session"`.
- [ ] **Step 2:** Run `npx vitest run src/lib/portal`. Expected: FAIL.
- [ ] **Step 3:** Implement. `createSession` sets `expiresAt = now + 7d`.
- [ ] **Step 4:** Run `npx vitest run src/lib/portal`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(portal): hashed single-use tokens and database sessions`

### Task 4: Portal access helpers

**Files:**
- Create: `src/lib/portal-access.ts`, `src/lib/portal-access.integration.test.ts`
- Create: `src/lib/portal/cookie.ts`: `PORTAL_COOKIE` (name per Global Constraints), `portalCookieOptions(): { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/" }`.

**Interfaces:**
- Consumes: `resolveSession` (Task 3).
- Produces:
  - `getPortalIdentity(): Promise<{ identityId: string; contactId: string; email: string } | null>`: reads `(await cookies()).get(PORTAL_COOKIE)`, and also returns null when `Firm.portalEnabled` is false.
  - `requirePortalIdentity(): Promise<{ identityId: string; contactId: string; email: string }>`: `redirect("/login")` on a miss. Because the portal host rewrites, `/login` means the portal login.
  - `assertPortalMatterAccess(identityId: string, matterId: string): Promise<void>`: `notFound()` unless there is a live access row.
  - `portalMatterWhere(identityId: string): Prisma.MatterWhereInput` = `{ portalAccess: { some: { identityId, revokedAt: null } } }`.

- [ ] **Step 1: Write the failing tests** (mock `next/headers` `cookies()` to return a jar; mock `next/navigation` `redirect` and `notFound` to throw tagged errors, as other tests do):
  - `"no cookie → null; requirePortalIdentity redirects to /login"`
  - `"valid session → identity"`
  - `"portal disabled firm-wide → null even with a valid session"`
  - `"a staff Auth.js cookie alone is not a portal identity"` (Review Focus 4): the jar holds only `authjs.session-token`, so the result is `null`.
  - `"assertPortalMatterAccess: invited passes; never-invited, revoked and nonexistent all notFound"`
  - `"portalMatterWhere lists only live-access matters"`
- [ ] **Step 2:** Run `npx vitest run src/lib/portal-access.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with `import "server-only"`. Read the firm switch with `prisma.firm.findFirst({ select: { portalEnabled: true } })`; the app is single-tenant.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(portal): portal identity and matter-access helpers`

### Task 5: Host routing, isolation, env

**Files:**
- Modify: `src/proxy.ts` and `src/proxy.test.ts`
- Modify: `src/lib/env-check.ts` and `src/lib/env-check.test.ts`
- Modify: `.env.example`: document `PORTAL_HOST`, `RESEND_API_KEY` and `EMAIL_FROM`, and that `portal.localhost:3000` is the dev portal host.

**Interfaces:**
- Produces:
  - `isPortalHost(host: string | null): boolean`, exported from `src/proxy.ts`. It compares the `host` header (port stripped) to `PORTAL_HOST`, with `portal.localhost` always a portal host when `NODE_ENV !== "production"`.
  - Portal pages live at `/portal/*` internally and are served at `/*` on the portal host.

- [ ] **Step 1: Write the failing proxy tests:**
  - `"portal host: / rewrites to /portal and carries the page CSP"`: assert the `x-middleware-rewrite` header ends with `/portal` and the CSP header is present.
  - `"portal host: /matters/abc rewrites to /portal/matters/abc"`
  - `"portal host: staff paths are unreachable"`: `/settings`, `/api/email-sync` and `/intake/x` are each rewritten to `/portal/...`, where no such route exists, so they 404. Assert that the rewrite target starts with `/portal/` for each.
  - `"portal host: no staff cookie gate"`: `/login` with no cookie is not redirected to the staff login.
  - `"staff host: /portal and /portal/x return 404"`: assert `status === 404`.
  - `"staff host behaviour unchanged"`: the existing tests still pass.
- [ ] **Step 2:** Run `npx vitest run src/proxy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - At the top of `proxy()`: if the host is the portal host, return `NextResponse.rewrite(new URL("/portal" + pathname + search, request.url), { request: { headers } })` with the CSP set on both headers. Exceptions are `/_next/*` and `/api/csp-report`, which pass through.
  - Else if `pathname === "/portal"` or it starts with `"/portal/"`, return `new NextResponse(null, { status: 404 })`.
  - Then run the existing staff logic.
- [ ] **Step 4: env-check test:** `"PORTAL_HOST/RESEND_API_KEY/EMAIL_FROM are degraded in production"`. Implement it, then run `npx vitest run src/lib/env-check.test.ts src/proxy.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(portal): portal host routing and isolation in the proxy`

### Task 6: Client sign-in actions

**Files:**
- Create: `src/app/actions/portal-session.ts`, `src/app/actions/portal-session.test.ts`
- Create: `src/lib/portal/audit.ts`: `logPortalEvent(input: { identityId: string; matterId?: string | null; title: string; detail?: string }): Promise<void>`. It is fire-and-forget like `logActivity` and writes `type: "auth"`, `userId: null`.
- Create: `src/lib/portal/emails.ts`: `loginEmail(link: string)` and `inviteEmail(link: string, firmName: string, matterName: string)`, both returning `OutgoingEmail` minus `to`. Plain, short copy.

**Interfaces:**
- Consumes: `issueToken`, `consumeToken`, `createSession`, `deleteSession`, `deleteSessionsFor`, `sendEmail`, `PORTAL_COOKIE`, `portalCookieOptions`.
- Produces:
  - `requestPortalLink(_prev: PortalLinkState, fd: FormData): Promise<PortalLinkState>` where `type PortalLinkState = { status: "idle" | "sent" }`. It always returns `{ status: "sent" }` for any well-formed input.
  - `verifyPortalLink(_prev: PortalVerifyState, fd: FormData): Promise<PortalVerifyState>` where `type PortalVerifyState = { status: "idle" | "invalid" }`. On success it sets the cookie and calls `redirect("/")`.
  - `signOutPortal(): Promise<void>`: deletes the session and cookie, then `redirect("/login")`.
  - `portalLinkUrl(raw: string): string`: `https://${PORTAL_HOST}/auth/verify?token=${raw}` (http and `:3000` in dev).

- [ ] **Step 1: Write the failing tests** (use `captureEmails`, mock `next/headers` `cookies()` and `headers()` with `x-forwarded-for`):
  - `"known email with live access gets one login email; response is the uniform copy"`
  - `"unknown, disabled, no-live-access, and portal-off all return the same state and send nothing"`
  - `"email is trimmed and case-folded before lookup"` (Review Focus 1)
  - `"4th request for one email in 15 min sends nothing; response unchanged"`
  - `"21st request from one IP in 15 min sends nothing"`: every request (matched or not) writes one `PortalLinkRequest` row with `sha256` hashes of the normalized email and of the IP, never the raw values.
  - `"a matched request writes one portal auth activity row; an unmatched one writes none; no row contains the token"`
  - `"verify: valid token sets the cookie and redirects to /"`
  - `"verify: used/expired token returns invalid and sets no cookie"`
  - `"signOutPortal deletes the session row and clears the cookie"`
- [ ] **Step 2:** Run `npx vitest run src/app/actions/portal-session.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Insert the `PortalLinkRequest` row first. Then count rows for the email hash and the IP hash in the last 15 min. If a count is over its limit, return the uniform state without sending.
  - IP comes from the first `x-forwarded-for` entry.
  - Audit via `logPortalEvent`: "Portal link requested", "Signed in to portal", "Portal link rejected" (only when the token row exists), "Signed out of portal".
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(portal): magic-link request, verify and sign-out actions`

### Task 7: Portal pages and guard test

**Files:**
- Create: `src/app/(portal)/portal/layout.tsx`: shell with firm name and logo plus a sign-out form. Not an auth gate (ADR-028).
- Create: `src/app/(portal)/portal/page.tsx` ("My matters"), `matters/[id]/page.tsx`, `login/page.tsx` and `login/login-form.tsx` (client), `auth/verify/page.tsx` and `auth/verify/verify-form.tsx` (client), `unavailable/page.tsx`, `not-found.tsx`.
- Create: `src/app/(portal)/portal-guards.test.ts`
- Test: `src/app/(portal)/portal/page.test.tsx`, `matters/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `requirePortalIdentity`, `assertPortalMatterAccess`, `portalMatterWhere`, the Task 6 actions.
- Produces: the routes `/`, `/matters/[id]`, `/login`, `/auth/verify` and `/unavailable` on the portal host.

- [ ] **Step 1: Write the failing tests:**
  - Guard test (copy the `page-guards.test.ts` approach with root `(portal)`): every `page.tsx` except `login`, `auth/verify` and `unavailable` has `await requirePortalIdentity(` as its first await.
  - `"My matters lists only invited matters with Open/Closed"`: archived shows "Closed".
  - `"matter page 404s for an un-invited matter and shows the name for an invited one"`
  - `"verify page renders a Sign in button and does not consume the token on render"`: after rendering, the token row still has `usedAt === null`.
  - `"login and verify pages show the portal-off copy when portalEnabled is false"`
- [ ] **Step 2:** Run `npx vitest run "src/app/(portal)"`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Mobile-first Tailwind using the existing tokens.
  - Matter page body: the name, then `More details are coming soon.`
  - Portal queries `select` only `id`, `name` and `isArchived`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(portal): client shell, sign-in pages and matters list`

### Task 8: Staff access actions

**Files:**
- Create: `src/app/actions/portal-access.ts`, `src/app/actions/portal-access.test.ts`
- Modify: `src/app/actions/firm.ts` and its test: add `setPortalEnabled(enabled: boolean)`, gated on `firm.edit_info` and logged.

**Interfaces:**
- Consumes: `issueToken("invite")`, `deleteSessionsFor`, `sendEmail`, `inviteEmail`, `portalLinkUrl`, `assertMatterAccess`, `requirePermissionResult`.
- Produces:
  - `invitePortalUser(matterId: string, contactId: string, email: string): Promise<{ ok: true } | { ok: false; error: string }>`
    - Upserts the identity by `contactId` and sets `email` (normalized).
    - Upserts the access row, clearing `revokedAt`.
    - Issues an invite token and sends the email.
    - Logs with `matterId`.
  - `revokePortalAccess(accessId: string): Promise<{ ok: boolean; error?: string }>`: sets `revokedAt`/`revokedById`; if the identity has no other live access, also `deleteSessionsFor`.
  - `disablePortalIdentity(identityId: string): Promise<{ ok: boolean; error?: string }>`: sets `disabledAt`, deletes sessions, and requires `portal.revoke`.
  - `getPortalAccessForMatter(matterId)` in `src/lib/queries/portal-access.ts`: rows `{ accessId, identityId, contactName, email, invitedAt, lastSignInAt: Date | null, revokedAt }`, where `lastSignInAt` is the max session `createdAt`. Gated on `portal.view` and matter access.

- [ ] **Step 1: Write the failing tests:**
  - `"invite needs portal.invite and matter access; a walled user gets the generic not-found error"` (ADR-039 TEAM mode, as in `matter-access-reads.test.ts`)
  - `"invite refuses when the portal is off"`
  - `"invite refuses a missing or invalid email"`
  - `"invite trims and case-folds the email"` (Review Focus 1)
  - `"re-invite after revoke reuses the access row, clears revokedAt, and old invite tokens die"` (Review Focus 2)
  - `"email send failure keeps the access row and returns the retry copy"`
  - `"revoking the last live matter deletes sessions; revoking one of two keeps them"`
  - `"disable deletes sessions and needs portal.revoke"`
  - `"each action writes one activity row on the matter (invite/revoke)"`: these are staff actions, so they use `logActivity` with the staff `userId` and `matterId`.
  - `"setPortalEnabled needs firm.edit_info"`
- [ ] **Step 2:** Run `npx vitest run src/app/actions/portal-access.test.ts src/app/actions/firm.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run the token issue and access upsert in one transaction; the email goes out after commit. Copy on send failure, exactly: `Couldn't send the invite email; try again.`
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(portal): staff invite, revoke and disable actions`

### Task 9: Staff UI

**Files:**
- Create: `src/components/matters/portal-card.tsx` (client) and `portal-card.test.tsx`
- Modify: `src/app/(dashboard)/matters/[id]/page.tsx`: render `<PortalCard>` when `portal.view` is held, passing the rows, the invitable contacts (client and parties with their emails), `canInvite`, `canRevoke` and `portalEnabled`.
- Modify: `src/app/(dashboard)/settings/firm/page.tsx` plus its form component: a "Client portal enabled" switch calling `setPortalEnabled`.

**Interfaces:**
- Consumes: the Task 8 actions and `getPortalAccessForMatter`.

- [ ] **Step 1: Write the failing component tests:**
  - `"lists people with Invited / Active (last sign-in) / Revoked status"`
  - `"Invite picks a contact, pre-fills their email, allows editing, posts to invitePortalUser"`
  - `"Revoke asks for confirmation before calling revokePortalAccess"`
  - `"no invite button without canInvite; a disabled-portal notice when portalEnabled is false"`
- [ ] **Step 2:** Run `npx vitest run src/components/matters/portal-card.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement, following the dialog patterns in `send-invoice-dialog.tsx` (`useDialogActionState`).
- [ ] **Step 4:** Rerun, plus `npx vitest run "src/app/(dashboard)/matters/[id]/page.test.tsx"`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(portal): matter Portal card and firm switch`

### Task 10: Contact merge carries the portal identity

**Files:**
- Modify: `src/app/actions/contacts.ts`, inside the `mergeContacts` transaction. If only the loser has an identity, re-point its `contactId` to the survivor. If both do, move the loser's access rows to the survivor's identity (skip duplicates; un-revoke when either was live), delete the loser's sessions and tokens, then delete the loser identity.
- Test: `src/app/actions/contacts.test.ts`, under the existing merge describe.

- [ ] **Step 1: Write the failing tests** (Review Focus 5):
  - `"merge re-points a loser-only portal identity"`
  - `"merge folds two identities: survivor keeps both matters' access; loser identity gone"`
- [ ] **Step 2:** Run `npx vitest run src/app/actions/contacts.test.ts -t "portal"`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun the whole file. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(contacts): merging contacts carries their portal identity`

### Task 11: Docs, ADR, cleanup, full verification

**Files:**
- Create: `docs/features/client-portal.md`. Include the end state, the publishing rule for sub-projects 1–4 (copied from the spec), rollout steps, and the open risks.
- Create: `docs/decisions/051-client-portal-identity-is-separate-from-staff-auth.md`, plus its row in `docs/decisions/README.md`.
- Modify:
  - `docs/ROADMAP.md`: P1 line `[~] **Client portal**: foundation shipped; status, documents, messages, invoices next.`
  - `docs/PERMISSIONS.md`: the portal section.
  - `docs/ARCHITECTURE.md`: the host routing and the `(portal)` group.
  - `docs/DEPLOY_BACKFILLS.md`: the rollout checklist from the spec.
- Delete: the spec and this plan (AGENTS.md: fold lasting content into the feature file and ADR, then delete).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 3:** Manual check with the dev server.
  - `http://portal.localhost:3000/login`: request a link for a seeded test contact and copy it from the console driver log. On the verify page, Sign in, then see "My matters".
  - `http://localhost:3000/portal` returns 404.
  - Record the result in the commit message.
- [ ] **Step 4:** Commit: `docs(portal): feature file, ADR-051, permissions and rollout; drop spec and plan`
