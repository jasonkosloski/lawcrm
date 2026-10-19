# Client portal

Clients follow their case, exchange documents, message the matter team and view invoices. Delivered as five sub-projects; only **0, the foundation**, is built.

| # | Sub-project | State |
|---|---|---|
| 0 | Foundation: client identity, sign-in, per-matter access, host isolation, staff invite/revoke, empty shell | Shipped (off until the firm switch is on) |
| 1 | Case status (published stage, key dates, next steps) | Not started |
| 2 | Documents (shared downloads, client uploads) | Not started |
| 3 | Messages (two-way, per matter) | Not started |
| 4 | Invoices and trust (view first; online payment later) | Not started |

Why identity is separate from staff auth: [ADR-051](../decisions/051-client-portal-identity-is-separate-from-staff-auth.md).

## End state (foundation)

### Hosts and isolation
- Same app, two hosts. `PORTAL_HOST` (e.g. `portal.kosloskilaw.com`) is an extra domain on the Vercel project; `portal.localhost:3000` is the portal host in dev (`src/lib/portal/host.ts`).
- Pages live in `src/app/(portal)/portal/...`. `src/proxy.ts` rewrites `/x` to `/portal/x` on the portal host (no staff cookie gate there, so staff paths simply 404) and 404s `/portal/*` on any other host, static-looking paths like `/portal/x.js` included (that check runs before the static-extension skip). Portal pages get the same nonce CSP as staff pages.
- Unmatched portal paths hit `portal/[...rest]/page.tsx` (guard, then `notFound()`), so they render the portal 404, not the staff root one; signed-out clients go to `/login`. `portal/error.tsx` is the portal error boundary (retry plus a link to portal home `/`; no staff links, no error text). It does not cover a throw in `portal/layout.tsx` itself, which still reaches the root boundary.
- Isolation does not rest on the proxy alone (matcher exclusions and server-action forwarding can reach staff handlers from the portal host). Each session reader enforces it: the Auth.js `jwt` callback treats any portal-host request as signed out, and `getPortalIdentity` returns null off the portal host.
- Cookie: `__Host-portal_session` in production (`portal_session` over http in dev); HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, so it never reaches the staff host. Persistent: `maxAge` is the session's remaining absolute lifetime (createdAt + 30 days - now), so it survives a browser restart but never outlives the server cap.

### Data
`PortalIdentity` (one per `Contact`, unique `contactId`, unique lowercase `email`, `disabledAt`), `PortalMatterAccess` (identity x matter, `revokedAt`; re-invite clears it on the same row), `PortalLoginToken` (SHA-256 hash only; `login` 15 min, `invite` 7 days), `PortalSession` (SHA-256 of the cookie value; sliding expiry capped at 30 days from creation), `PortalLinkRequest` (email and IP as HMAC-SHA256 keyed with `AUTH_SECRET`, for throttling; `hmacSecret` in `src/lib/portal/secrets.ts`. Emails are guessable, so a plain hash would be reversible. Without `AUTH_SECRET` it uses a fixed key outside production; in production it falls back to plain SHA-256 and logs once), and `Firm.portalEnabled` (default false). Migrations `20261019090000_client_portal_foundation` (also grants the three keys to every role holding `matters.edit`) and `20261019091000_portal_identity_email_unique`.

### Sign-in
1. `requestPortalLink` (portal host only) always answers "If that email has portal access, a link is on its way." It sends only for an enabled identity with a live access row while the portal is on. Throttle: 3 per email and 20 per IP per 15 minutes (counted in `PortalLinkRequest`). Issuing any token (login or invite) marks all of that identity's earlier unused tokens used, invites included: only the newest link works, so a login request kills a pending invite. That is fine; the invited client just requests a link from `/login`. Unknown emails are never written to the activity log.
2. The email links to `/auth/verify?token=...`. A GET never signs in (mail scanners prefetch links); it shows a "Sign in" button that POSTs to `verifyPortalLink`, which spends the token with one conditional `updateMany`. Verify also requires the portal on and a live access row, so a 7-day invite issued before a revoke or switch-off cannot mint a session.
3. Sign-out deletes the session row. Revoking an identity's last live matter, disabling it, changing its email, or deactivating its contact (`deleteContact` / `bulkDeactivateContacts`, which also set `disabledAt` in the same transaction) deletes its sessions. Switching the portal off deletes every portal session, and `getPortalIdentity` fails closed while it is off. Reactivating a contact does not re-enable portal access; staff re-invite.
4. **Dev shortcut:** on `portal.localhost` outside production only (`isDevPortalHost`; never `PORTAL_HOST`, and Vercel previews run as production), `/login` lists invited clients with live access and `devPortalSignIn` signs in as one without an email. It applies the same portal-on, enabled and live-access checks as verify, and audits as "Signed in to portal (dev shortcut)". Clients must still be invited from the matter's Portal card first.
5. Audit: `ActivityLog` rows of type `auth` with `userId` null, never containing a token. Invite and revoke also carry `matterId` (they show on the matter timeline).

### Email
`src/lib/email/` (`sendEmail` over a driver). `resend` in production (`RESEND_API_KEY`, `EMAIL_FROM`); `console` driver is dev/test only. In production without a key `sendEmail` returns `ok: false` ("Email is not configured.") and never logs the body, so live links never reach logs.

### Access helpers (`src/lib/portal-access.ts`)
`getPortalIdentity` (React `cache()`d, so layout and page share one lookup per request), `requirePortalIdentity` (a PAGE guard only: it throws a redirect, so never try/catch it, and never call it from a server action, whose redirect would render the staff page on the portal host; actions return a result instead), `assertPortalMatterAccess` (`notFound()` for missing, never-invited or revoked), `portalMatterWhere`. `src/app/(portal)/portal-guards.test.ts` requires every portal page to call `requirePortalIdentity` first (exceptions: `login`, `auth/verify`). There is no "unavailable" page: with the portal off, protected pages redirect to `/login`, and `/login` and `/auth/verify` show the portal-off copy. `portalLinkUrl` lives in `src/lib/portal/link-url.ts` because a `"use server"` file may export only async functions.

### Staff side
- Keys `portal.view`, `portal.invite`, `portal.revoke` (catalog in `src/lib/permissions.ts`). Firm switch: Settings, Firm, "Client portal enabled" (`firm.edit_info`).
- Portal card on the matter Overview (`portal.view` + matter access): people with status invited / active / revoked. Actions in `src/app/actions/portal-access.ts`: `invitePortalUser`, `revokePortalAccess`, `disablePortalIdentity`, each `requirePermission` + `assertMatterAccess`, logged, revalidated. `disablePortalIdentity` is a server action with no UI yet.
- Invite offers the matter's client and its parties only (not any contact); the email can be edited before sending (updates `PortalIdentity.email`, not the contact). Refused when the portal is off, the matter is archived, the contact is inactive, or another identity already uses the email ("Another portal user already uses this email."; spouses need separate addresses). A send failure keeps the access row.
- **Identity-wide changes** (disable, re-enable by re-invite, changing the email, merging two contacts that both have portal identities) require the actor to see every matter the identity can access (`src/lib/portal/identity-scope.ts`); otherwise they are refused and the actor uses per-matter revoke or a colleague. This keeps a walled user from acting on matters they cannot see (ADR-039).
- Contact merge re-points or folds portal identities and access (`mergeContacts`), deleting the loser's sessions. When both contacts have identities it is refused unless the actor sees every live portal matter of both ("Both contacts have client portal access on matters you can't see. Ask someone who can see all of them to merge."). The merge activity row records the fold ("Portal access folded: N matters", or that access moved to the survivor).

### Pruning
`prunePortalRecords(now)` (`src/lib/portal/prune.ts`) runs from the hourly `/api/notification-sweep` cron. It deletes sessions past `expiresAt`, tokens used or expired more than a day ago (kept a day so a late click on a spent link still logs "Portal link rejected"), and `PortalLinkRequest` rows older than a day. A prune failure is logged and never fails the sweep.

### Client UI
Visual rules live in [UI_PATTERNS, Client portal](../UI_PATTERNS.md#client-portal). Navy letterhead header (firm name/logo, signed-in email on wide screens, sign-out) and a footer with the firm's public phone, email and address from `Firm`, so a client can always reach a person. `/` greets the contact by name and lists invited matters, open first, closed under their own heading, each with an Open/Closed chip. `/matters/[id]` shows the name, status and a "Nothing shared yet" empty state. The sign-in "sent" state keeps the uniform copy, echoes the address the visitor typed (reveals nothing new) and offers "Use a different email". 404 and error pages link back to portal home. After a successful verify the form shows "Signing you in…" (no button) while the browser navigates.

## Publishing rule (binding on sub-projects 1-4)

- Nothing from a matter reaches the portal by default. Each feature adds an explicit per-item share (a flag or a publish action) that staff control, plus its own permission keys.
- Portal queries select explicit fields; they never spread a staff query's result.

## Rollout checklist

Steps marked **(you)** need the user; the rest is code that is already shipped.

1. **(you)** Provision Resend through the Vercel Marketplace; set `RESEND_API_KEY` and `EMAIL_FROM`. Set up SPF/DKIM for the sending domain first or invites land in spam.
2. **(you)** Add `portal.<domain>` to the Vercel project and DNS.
3. **(you)** Set `PORTAL_HOST`.
4. **(you)** Run `prisma migrate deploy` for both migrations (see [DEPLOY_BACKFILLS](../DEPLOY_BACKFILLS.md); mind the `DIRECT_DATABASE_URL` gotcha there).
5. **(you)** Turn on Settings, Firm, "Client portal enabled".
6. `src/lib/env-check.ts` reports missing `PORTAL_HOST` / `RESEND_API_KEY` / `EMAIL_FROM` at startup as degraded (logged, not blocking).

## Open risks and deferred items

- **Deliverability**: see rollout step 1.
- **One codebase, two hosts**: isolation is proxy routing + host-only cookie + the two session-reader checks. The proxy, guard and isolation tests are what keep it that way; do not weaken them.
- **`/public` assets 404 on the portal host** (the proxy rewrites everything into `/portal`). Fine today (no portal images); fix in the proxy before a sub-project needs a static asset.
- **`auth()` on the portal host returns a session without `user.id`** (signed-out shape by design). Any code reading `session.user.id` must not assume it is set there.
- **Timing difference on link requests**: a matched email does token + send work, an unknown one returns sooner, so latency can hint at who has portal access. Mitigated by the throttle only; consider queueing the send.
- **Smaller known gaps**: the invite P2002 catch maps any unique violation to the email copy; the walled-actor check runs outside the invite transaction (narrow race); invite refusals can reveal identity facts from hidden matters; there is no UI for `disablePortalIdentity` yet.
