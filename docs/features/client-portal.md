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
- Pages live in `src/app/(portal)/portal/...`. `src/proxy.ts` rewrites `/x` to `/portal/x` on the portal host (no staff cookie gate there, so staff paths simply 404) and 404s `/portal/*` on any other host. Portal pages get the same nonce CSP as staff pages.
- Isolation does not rest on the proxy alone (matcher exclusions and server-action forwarding can reach staff handlers from the portal host). Each session reader enforces it: the Auth.js `jwt` callback treats any portal-host request as signed out, and `getPortalIdentity` returns null off the portal host.
- Cookie: `__Host-portal_session` in production (`portal_session` over http in dev); HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, so it never reaches the staff host.

### Data
`PortalIdentity` (one per `Contact`, unique `contactId`, unique lowercase `email`, `disabledAt`), `PortalMatterAccess` (identity x matter, `revokedAt`; re-invite clears it on the same row), `PortalLoginToken` (SHA-256 hash only; `login` 15 min, `invite` 7 days), `PortalSession` (SHA-256 of the cookie value; sliding expiry capped at 30 days from creation), `PortalLinkRequest` (hashed email + IP, for throttling), and `Firm.portalEnabled` (default false). Migrations `20261019090000_client_portal_foundation` (also grants the three keys to every role holding `matters.edit`) and `20261019091000_portal_identity_email_unique`.

### Sign-in
1. `requestPortalLink` (portal host only) always answers "If that email has portal access, a link is on its way." It sends only for an enabled identity with a live access row while the portal is on. Throttle: 3 per email and 20 per IP per 15 minutes (counted in `PortalLinkRequest`). Issuing a token marks the identity's earlier unused login tokens used. Unknown emails are never written to the activity log.
2. The email links to `/auth/verify?token=...`. A GET never signs in (mail scanners prefetch links); it shows a "Sign in" button that POSTs to `verifyPortalLink`, which spends the token with one conditional `updateMany`. Verify also requires the portal on and a live access row, so a 7-day invite issued before a revoke or switch-off cannot mint a session.
3. Sign-out deletes the session row. Revoking an identity's last live matter, disabling it, or changing its email deletes its sessions; switching the portal off makes `getPortalIdentity` fail closed.
4. Audit: `ActivityLog` rows of type `auth` with `userId` null, never containing a token. Invite and revoke also carry `matterId` (they show on the matter timeline).

### Email
`src/lib/email/` (`sendEmail` over a driver). `resend` in production (`RESEND_API_KEY`, `EMAIL_FROM`); `console` driver is dev/test only. In production without a key `sendEmail` returns `ok: false` ("Email is not configured.") and never logs the body, so live links never reach logs.

### Access helpers (`src/lib/portal-access.ts`)
`getPortalIdentity`, `requirePortalIdentity` (throws a redirect; never try/catch it), `assertPortalMatterAccess` (`notFound()` for missing, never-invited or revoked), `portalMatterWhere`. `src/app/(portal)/portal-guards.test.ts` requires every portal page to call `requirePortalIdentity` first (exceptions: `login`, `auth/verify`). There is no "unavailable" page: with the portal off, protected pages redirect to `/login`, and `/login` and `/auth/verify` show the portal-off copy. `portalLinkUrl` lives in `src/lib/portal/link-url.ts` because a `"use server"` file may export only async functions.

### Staff side
- Keys `portal.view`, `portal.invite`, `portal.revoke` (catalog in `src/lib/permissions.ts`). Firm switch: Settings, Firm, "Client portal enabled" (`firm.edit_info`).
- Portal card on the matter Overview (`portal.view` + matter access): people with status invited / active / revoked. Actions in `src/app/actions/portal-access.ts`: `invitePortalUser`, `revokePortalAccess`, `disablePortalIdentity`, each `requirePermission` + `assertMatterAccess`, logged, revalidated.
- Invite picks the client, a party, or any contact; the email can be edited before sending (updates `PortalIdentity.email`, not the contact). Refused when the portal is off, the matter is archived, the contact is inactive, or another identity already uses the email ("Another portal user already uses this email."; spouses need separate addresses). A send failure keeps the access row.
- **Identity-wide changes** (disable, re-enable by re-invite, changing the email) require the actor to see every matter the identity can access (`src/lib/portal/identity-scope.ts`); otherwise they are refused and the actor uses per-matter revoke or a colleague. This keeps a walled user from acting on matters they cannot see (ADR-039).
- Contact merge re-points or folds portal identities and access (`mergeContacts`), deleting the loser's sessions.

### Client UI
Mobile-first shell with firm name/logo and sign-out. `/` lists invited matters (name, Open/Closed). `/matters/[id]` shows the name and "More details are coming soon". Portal-styled 404.

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
- **Smaller known gaps**: the invite P2002 catch maps any unique violation to the email copy; the walled-actor check runs outside the invite transaction (narrow race); invite refusals can reveal identity facts from hidden matters; the contact-merge audit row does not mention the portal fold.
