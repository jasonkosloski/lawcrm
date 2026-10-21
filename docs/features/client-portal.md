# Client portal

Clients follow their case, exchange documents, message the matter team and view invoices. Delivered as five sub-projects; **0 (foundation)**, **1 (case status)**, **2 (documents)** and **3 (messages)** are built.

| # | Sub-project | State |
|---|---|---|
| 0 | Foundation: client identity, sign-in, per-matter access, host isolation, staff invite/revoke, empty shell | Shipped (off until the firm switch is on) |
| 1 | Case status (staff-written updates, shared calendar events): [client-portal-status](client-portal-status.md) | Shipped (off until the firm switch is on) |
| 2 | Documents (shared downloads, client uploads, document requests): [client-portal-documents](client-portal-documents.md) | Shipped (off until the firm switch is on) |
| 3 | Messages (two-way, per matter) | Shipped (off until the firm switch is on) |
| 4 | Invoices and trust (view first; online payment later) | Not started |

Why identity is separate from staff auth: [ADR-051](../decisions/051-client-portal-identity-is-separate-from-staff-auth.md).

## End state (foundation)

### Hosts and isolation
- Same app, two hosts: `PORTAL_HOST` (`portal.litgox.com` in production), `portal.localhost:3000` in dev (`src/lib/portal/host.ts`).
- Pages live in `src/app/(portal)/portal/...`. `src/proxy.ts` rewrites `/x` to `/portal/x` on the portal host (staff paths 404) and 404s `/portal/*` on any other host, `/portal/x.js` included. Same nonce CSP as staff pages.
- Unmatched portal paths hit `portal/[...rest]/page.tsx` (guard, then `notFound()`), so they render the portal 404; signed-out clients go to `/login`. `portal/error.tsx` is the portal error boundary (retry plus link home; no staff links or error text); a throw in `portal/layout.tsx` itself still reaches the root boundary.
- Isolation does not rest on the proxy alone (matcher exclusions and server-action forwarding can reach staff handlers from the portal host). `getStaffAuth()` / `getStaffAuthFromRequest` treat any portal-host request as signed out before touching Clerk, the proxy never invokes Clerk there, and `getPortalIdentity` returns null off the portal host.
- Cookie: `__Host-portal_session` in production (`portal_session` over http in dev); HttpOnly, Secure, SameSite=Lax, Path=/, no Domain. `maxAge` is the session's remaining absolute lifetime (createdAt + 30 days - now).

### Data
`PortalIdentity` (one per `Contact`, unique `contactId`, unique lowercase `email`, `disabledAt`), `PortalMatterAccess` (identity x matter, `revokedAt`; re-invite clears it on the same row), `PortalLoginToken` (SHA-256 hash only; `login` 15 min, `invite` 7 days), `PortalSession` (SHA-256 of the cookie value; sliding expiry capped at 30 days from creation), `PortalLinkRequest` (email and IP as HMAC-SHA256 keyed with `AUTH_SECRET` via `hmacSecret` in `src/lib/portal/secrets.ts`, for throttling; without the secret: fixed key outside production, plain SHA-256 plus one log in production), and `Firm.portalEnabled` (default false). Migrations `20261019090000_client_portal_foundation` (grants the three keys to roles holding `matters.edit`) and `20261019091000_portal_identity_email_unique`.

### Sign-in
1. `requestPortalLink` (portal host only) always answers "If that email has portal access, a link is on its way." and sends only for an enabled identity with a live access row while the portal is on. Throttle: 3 per email and 20 per IP per 15 minutes. Issuing any token marks that identity's earlier unused tokens used: only the newest link works, so a login request kills a pending invite. Unknown emails are never logged.
2. The email links to `/auth/verify?token=...`. A GET never signs in (mail scanners prefetch links); a "Sign in" button POSTs to `verifyPortalLink`, which spends the token with one conditional `updateMany` and also requires the portal on and a live access row.
3. Sign-out deletes the session row. Revoking an identity's last live matter, disabling it, changing its email, or deactivating its contact (`deleteContact` / `bulkDeactivateContacts`, which also set `disabledAt`) deletes its sessions. Switching the portal off deletes every session and `getPortalIdentity` fails closed. Reactivating a contact does not re-enable access; staff re-invite.
4. **Dev shortcut:** on `portal.localhost` outside production only (`isDevPortalHost`; Vercel previews run as production), `/login` lists invited clients with live access and `devPortalSignIn` signs in as one. Same checks as verify.
5. Audit: `ActivityLog` rows of type `auth` with `userId` null, never containing a token; invite and revoke also carry `matterId`.

### Email
`src/lib/email/` (`sendEmail` over a driver). `resend` in production (`RESEND_API_KEY`, `EMAIL_FROM`); `console` driver is dev/test only. In production without a key `sendEmail` returns `ok: false` and never logs the body.

### Access helpers (`src/lib/portal-access.ts`)
`getPortalIdentity` (`cache()`d per request), `requirePortalIdentity` (a PAGE guard only: it throws a redirect, so never try/catch it or call it from a server action; actions return a result), `assertPortalMatterAccess` (`notFound()` for missing, never-invited or revoked), `portalMatterWhere` (checks revocation only, not portal-on or identity-enabled). `src/app/(portal)/portal-guards.test.ts` requires every portal page to call `requirePortalIdentity` first (exceptions: `login`, `auth/verify`). With the portal off, protected pages redirect to `/login`, which shows the portal-off copy. `portalLinkUrl` lives in `src/lib/portal/link-url.ts` (a `"use server"` file may export only async functions).

### Staff side
- Keys `portal.view`, `portal.invite`, `portal.revoke` (catalog in `src/lib/permissions.ts`). Firm switch: Settings, Firm, "Client portal enabled" (`firm.edit_info`).
- Portal card on the matter Overview (`portal.view` + matter access): people with status invited / active / revoked. Actions in `src/app/actions/portal-access.ts`: `invitePortalUser`, `revokePortalAccess`, `disablePortalIdentity` (no UI yet), each permission-gated with `assertMatterAccess`.
- Invite offers the matter's client and its parties only; the email can be edited before sending (updates `PortalIdentity.email`, not the contact). Refused when the portal is off, the matter is archived, the contact is inactive, or another identity uses the email (spouses need separate addresses). A send failure keeps the access row.
- **Identity-wide changes** (disable, re-enable by re-invite, changing the email, merging two contacts that both have identities) require the actor to see every matter the identity can access (`src/lib/portal/identity-scope.ts`); otherwise they are refused (ADR-039).
- `mergeContacts` re-points or folds portal identities and access and deletes the loser's sessions; refused when both have identities unless the actor sees every live portal matter of both. The merge activity row records the fold.

### Pruning
`prunePortalRecords(now)` (`src/lib/portal/prune.ts`) runs from the hourly `/api/notification-sweep` cron. It deletes expired sessions, tokens used or expired more than a day ago (kept so a late click still logs "Portal link rejected"), and `PortalLinkRequest` rows older than a day. A failure never fails the sweep.

### Client UI
Visual rules: [UI_PATTERNS, Client portal](../UI_PATTERNS.md#client-portal). Letterhead header (firm name/logo, sign-out) and a footer with the firm's public contact details. `/` greets the contact and lists invited matters, open first, closed under their own heading, each with an Open/Closed chip. `/matters/[id]` shows the matter, status, updates and documents.

## Messages (sub-project 3)

### Data
Migration `20261021140000_portal_messages` (expand-only; grants the two keys below to every role holding `matters.edit`).
- `PortalThread`: one per matter (unique `matterId`), `lastMessageAt`, `lastFromClient`. Created on the first message; Cascade with the matter.
- `PortalMessage`: plain-text `body` (max 5,000), `authorKind` (`client` / `staff`) with `authorIdentityId` or `authorUserId`. Messages are permanent: no edit or delete.
- `PortalReadState`: per-reader read marker (`lastReadAt`), one row per staff user or client identity per thread (unique on thread + user and thread + identity). Markers only move forward and the sender's marker advances with the send. `lastEmailedAt` is the client email throttle bookkeeping for that identity.
- The thread is shared by every live client of the matter (co-clients see each other's messages, labelled by name; staff are labelled "(your legal team)").

### Client side
- Write path: `recordPortalMessage` in `src/lib/portal/message-store.ts`; client actions in `src/app/actions/portal-messages-client.ts` (`sendPortalMessage`, `markPortalMessagesRead`); reader `getPortalMessages` / `unreadPortalMessageMatters` in `src/lib/portal/messages.ts` (explicit fields only).
- Gate: live access (portal on, identity enabled, access not revoked) on the matter. Closed (archived) matters are read-only: the client can read but not send, unlike documents. Rate limit: 30 messages per identity per matter per rolling hour (a count before the insert).
- UI: `messages-section.tsx`, `message-composer.tsx`, `mark-read.tsx` on the portal matter page; home rows flag matters with unread firm messages.

### Staff side
- Keys `portal.view_messages` and `portal.send_messages` (plus `assertMatterAccess` on every action). Actions in `src/app/actions/portal-messages.ts` (`sendStaffPortalMessage`, `markStaffPortalThreadRead`; mark-read is a no-op when nothing is unread). Reads in `src/lib/queries/portal-messages.ts`.
- "Portal" channel on the matter Communication tab (`src/components/communication/portal-conversation.tsx`), paged, marks the thread read.
- "Client portal" list in the firm-wide Communication area (`portal-thread-list.tsx`): threads with at least one message on matters the viewer can access (`matterAccessWhere`), client-last threads first, snippet and per-viewer unread count from one query.

### Notifications and email
- Client message: one `portal_message` notification per burst, sent to active matter team members who hold `portal.view_messages` and can access the matter, skipped for anyone who already has an unread `portal_message` notification on that matter. Links to the Portal channel. A notification failure never fails the send.
- Staff message: emails each live portal client (`portalMessageEmail`, link to portal home, never the message text) at most once per 15 minutes per identity, using `lastEmailedAt`. Skipped while the portal is off. A send failure keeps the message and returns a warning.

### Open risks and deferred items (messages)
- No attachments (documents are a separate flow); no rich text, edit, delete or read receipts to the other side.
- Portal time zone is America/Denver (message times display in Denver for every client).
- The thread is created before the message transaction (idempotent, so a racing first send is safe), so a failed first insert can leave an empty thread; the list hides threads with no messages.
- The rate limit and the email throttle are check-then-write, so a parallel burst can slightly exceed them.

## Publishing rule (binding on sub-projects 1-4)

- Nothing from a matter reaches the portal by default. Each feature adds an explicit per-item share (a flag or a publish action) that staff control, plus its own permission keys.
- Portal queries select explicit fields; they never spread a staff query's result.

## Rollout checklist

Steps marked **(you)** need the user; the rest is code that is already shipped.

1. **(you)** Provision Resend (Vercel Marketplace); set `RESEND_API_KEY` and `EMAIL_FROM`; set up SPF/DKIM first or invites land in spam.
2. **(you)** Add `portal.<domain>` to the Vercel project and DNS.
3. **(you)** Set `PORTAL_HOST` for the **Production** environment only (uploads return 503 without it; a preview with it set would hand Blob a callback to the production portal).
4. **(you)** Ensure the five portal migrations are applied (the third, `20261019183859_portal_documents`, grants the document keys; the fourth, `20261021130000_portal_case_status`, the status keys; the fifth, `20261021140000_portal_messages`, the message keys; prod builds auto-apply migrations per ADR-058) (see [DEPLOY_BACKFILLS](../DEPLOY_BACKFILLS.md); mind the `DIRECT_DATABASE_URL` gotcha there).
5. **(you)** Turn on Settings, Firm, "Client portal enabled".
6. `src/lib/env-check.ts` reports missing `PORTAL_HOST` / `RESEND_API_KEY` / `EMAIL_FROM` at startup as degraded (logged, not blocking).

## Open risks and deferred items

- **Deliverability**: see rollout step 1.
- **One codebase, two hosts**: isolation is proxy routing + host-only cookie + the session-reader checks; do not weaken the proxy, guard and isolation tests.
- **`/public` assets 404 on the portal host** (the proxy rewrites everything into `/portal`); fix in the proxy before a sub-project needs a static asset.
- **`auth()` on the portal host returns a session without `user.id`** (signed-out shape by design).
- **Timing difference on link requests**: latency can hint at who has portal access. Throttle only; consider queueing the send.
- **Documents gaps**: see [client-portal-documents](client-portal-documents.md).
- **Smaller gaps**: the invite P2002 catch maps any unique violation to the email copy; the walled-actor check runs outside the invite transaction (narrow race); invite refusals can reveal identity facts from hidden matters; `disablePortalIdentity` has no UI.
