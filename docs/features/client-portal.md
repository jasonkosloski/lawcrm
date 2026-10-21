# Client portal

Clients follow their case, exchange documents, message the matter team and view invoices. Delivered as five sub-projects; **0 (foundation)**, **1 (case status)** and **2 (documents)** are built.

| # | Sub-project | State |
|---|---|---|
| 0 | Foundation: client identity, sign-in, per-matter access, host isolation, staff invite/revoke, empty shell | Shipped (off until the firm switch is on) |
| 1 | Case status (staff-written updates, shared calendar events) | Shipped (off until the firm switch is on) |
| 2 | Documents (shared downloads, client uploads, document requests) | Shipped (off until the firm switch is on) |
| 3 | Messages (two-way, per matter) | Not started |
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

## Case status (sub-project 1)

### Data and visibility rule
Client-facing status lives only in two portal tables, so isolation is checkable (migration `20261021130000_portal_case_status`, expand-only; grants the four keys below to every role holding `matters.edit`).
- `PortalStatusUpdate`: `stageLabel` (max 60), `body` (plain text, max 4,000), `postedById`, `postedAt`, `editedAt`, `emailedAt`. Newest `postedAt` is the current status. A timeline, not a mapping from the internal matter stage.
- `PortalSharedEvent`: unique `eventId`, `matterId` snapshot, `clientTitle` (max 200), `clientNote` (max 2,000), `sharedById`. Only calendar events on a matter can be shared (not leads, not deadlines). Visible only while `event.matterId` equals the snapshot, so re-filing hides it on both matters. Time and location are read live from the event (reschedules and Google syncs flow through); the internal title and description are never selected for portal reads.
- Nothing is shown automatically; text renders as plain text with line breaks.

### Read gate
`getPortalMatterStatus(identityId, matterId)` in `src/lib/portal/status.ts` returns `{ updates, upcoming, past }` with explicit fields only; `latestStageLabels` feeds the portal home rows. `portalMatterWhere` only checks revocation, so the reader checks portal-on and identity-not-disabled itself; anything else returns empty. Archived matters stay readable. "Upcoming" means the event ends today or later in America/Denver (all-day events compare as UTC-midnight dates, ADR-012).

### Staff side
- Keys `portal.add_updates`, `portal.edit_updates`, `portal.delete_updates`, `portal.share_events`; every action also calls `assertMatterAccess`. Actions in `src/app/actions/portal-status.ts` (`postStatusUpdate`, `editStatusUpdate`, `deleteStatusUpdate`, `shareEventWithClient`, `updateEventShare`, `stopSharingEvent`), Zod-validated, logged, revalidated. Reads in `src/lib/queries/portal-status.ts`.
- "Client status" card on the matter Overview (`portal.view`): latest update, earlier updates, post/edit/delete per key. Post dialog prefills the previous stage label and has an "Email the client" checkbox (default on). The usual "no portal access yet" hint shows when no live access row exists.
- Event detail modal and the matter Events tab: "Share with client" / "Edit share" / "Stop sharing" (`portal.share_events`), a "Shared" badge, client title prefilled from the event title.

### Client UI
Matter page above documents: "Where things stand" (stage chip, note, updated date), earlier updates, "Coming up" (client title, time, location, note), collapsed Past. Home rows show the latest stage label beside the Open/Closed chip.

### Email
Posting with the box ticked and the portal on sends `statusUpdateEmail` through `emailLivePortalUsers` (link to portal home, never the update text) and sets `emailedAt` if any send succeeded; a failure still posts and returns a warning. Editing never re-sends. Sharing an event sends nothing.

### Open risks and deferred items (status)
- Portal time zone is America/Denver (clients have no zone), so "upcoming" and displayed times suit a Denver firm only.
- Sharing an event sends no email; no reminders for shared events.
- Re-sharing keeps the original `sharedById`.
- Deadlines and matter dates cannot be shared; no rich text, attachments or read receipts.

## Publishing rule (binding on sub-projects 1-4)

- Nothing from a matter reaches the portal by default. Each feature adds an explicit per-item share (a flag or a publish action) that staff control, plus its own permission keys.
- Portal queries select explicit fields; they never spread a staff query's result.

## Rollout checklist

Steps marked **(you)** need the user; the rest is code that is already shipped.

1. **(you)** Provision Resend (Vercel Marketplace); set `RESEND_API_KEY` and `EMAIL_FROM`; set up SPF/DKIM first or invites land in spam.
2. **(you)** Add `portal.<domain>` to the Vercel project and DNS.
3. **(you)** Set `PORTAL_HOST` for the **Production** environment only (uploads return 503 without it; a preview with it set would hand Blob a callback to the production portal).
4. **(you)** Ensure the four portal migrations are applied (the third, `20261019183859_portal_documents`, grants the document keys; the fourth, `20261021130000_portal_case_status`, the status keys; prod builds auto-apply migrations per ADR-058) (see [DEPLOY_BACKFILLS](../DEPLOY_BACKFILLS.md); mind the `DIRECT_DATABASE_URL` gotcha there).
5. **(you)** Turn on Settings, Firm, "Client portal enabled".
6. `src/lib/env-check.ts` reports missing `PORTAL_HOST` / `RESEND_API_KEY` / `EMAIL_FROM` at startup as degraded (logged, not blocking).

## Open risks and deferred items

- **Deliverability**: see rollout step 1.
- **One codebase, two hosts**: isolation is proxy routing + host-only cookie + the session-reader checks; do not weaken the proxy, guard and isolation tests.
- **`/public` assets 404 on the portal host** (the proxy rewrites everything into `/portal`); fix in the proxy before a sub-project needs a static asset.
- **`auth()` on the portal host returns a session without `user.id`** (signed-out shape by design).
- **Timing difference on link requests**: latency can hint at who has portal access. Throttle only; consider queueing the send.
- **Documents gaps**: see the end of the Documents section.
- **Smaller gaps**: the invite P2002 catch maps any unique violation to the email copy; the walled-actor check runs outside the invite transaction (narrow race); invite refusals can reveal identity facts from hidden matters; `disablePortalIdentity` has no UI.

## Documents (sub-project 2)

### Visibility rule
One module decides what a client sees: `src/lib/portal/document-visibility.ts` (pure, client-safe: `sharedFolderIds`, `isEffectivelyShared`, `shareReason`) and `document-visibility.server.ts` (DB queries and `canPortalDownload`). Nothing else re-derives it; staff badges, portal lists and the download route all call it.
- **Three-state file share** (`Document.clientShare`): null follows the folder, `shared` is visible regardless, `hidden` wins even inside a shared folder. **Folders** have `clientShared`, inherited by the whole subtree. Protected system folders cannot be shared (they can be unshared). Archived documents are never client-visible, so the staff "Shared" badge, move warnings and share emails ignore them too.
- Audience is matter-wide. Matters only, not leads.
- Client uploads are listed separately ("Your uploads") and ignore `hidden`. The list is matter-wide, so it includes co-clients' uploads, each with the uploader's email.

### Client uploads
Uploads are **ordinary matter documents** ([ADR-052](../decisions/052-portal-uploads-are-matter-documents.md)) in the protected "From client" folder (`PORTAL_UPLOADS_FOLDER_NAME`, a folder kind in `folder-kinds.ts`), with `portalUploaderId`, `portalBatchId`, optional `documentRequestId` and `clientNote` (the "What is this?" note, max 500).
- **Allowlist** (`src/lib/portal/upload-policy.ts`): only the last extension counts, content type is derived from it (declared MIME ignored), size caps match staff. Production uploads go client-direct to Blob; dev posts to `/api/documents/upload/local` (the proxy matcher skips `/api/documents/upload` on every host, so it would reach the staff route).
- **Blob token step** (`portal-blob-upload.ts`) pins content type and size from the allowlist and checks identity, access, portal-on and the daily cap. **Completion identity comes only from the signed token payload** (the webhook has no cookie). The callback targets `https://$PORTAL_HOST/api/documents/upload/blob`; the token step refuses (503) when `PORTAL_HOST` is unset. The staff completion handler refuses portal-shaped payloads.
- **Completion** (`record-upload.ts`, shared by webhook and dev route) re-checks everything (access can be revoked mid-upload) and deletes the stored file if refused. Writes run under a per-matter advisory lock (`portal_uploads:<matterId>`), serializing the "From client" folder creation, the first file of a batch (one staff notification per batch) and request linking.
- **Daily cap**: 100 uploads per identity per rolling 24 hours, checked at token time only (a parallel burst can slightly exceed it).

### Document requests
`DocumentRequest` (title, instructions, optional date-only due date, `returnNote`). Status: `open` -> `submitted` (a client upload against it) -> `complete` (staff accept) or `cancelled`. **Send back** is `open` plus a `returnNote`, not a separate status. A batch answers one request: later files of a batch link to the request the batch's first file submitted. Late files from a batch started before a send-back land unlinked (still in "From client"). Staff actions: `src/app/actions/portal-documents.ts`. Deleting a request keeps the files. Creating one is allowed while the portal is off (no email).

### Download
`portal/api/documents/[id]/download` is gated by `canPortalDownload` alone (live access, portal on, document not archived, and effectively shared or uploaded by a live-access client of that matter). `Matter.isArchived` is not checked: clients keep downloading, and can still upload, on closed matters. Everything else is a bare 404. Always `Content-Disposition: attachment`, never cached; blob keys 302 to a short-lived signed URL.

### Notifications and email
- Clients: `documentRequestEmail` on request creation and `documentsSharedEmail` when shares are turned on, sent to live portal users of the matter (`emailLivePortalUsers`); links go to portal home. Skipped while the portal is off.
- Staff: one `portal_upload` notification per upload batch, to the matter team, linking to the documents tab.

### Staff UI
- Documents browser: file kebab "Share with client" / "Stop sharing" (per file), folder kebab "Share folder with client" / "Stop sharing folder". The share UI needs both `portal.view` (row state) and `portal.share_documents` (actions); the migration grants them together. The "Shared" badge tooltip names the folder when inherited.
- The move dialog warns when a move changes client visibility (`visibilityChangeForMove` for files; the read-only `previewFolderMoveVisibility` action for folders). Advisory only.
- "Client requests" card on the matter Overview beside the Portal card, behind `portal.view` (reads in `src/lib/queries/document-requests.ts`). "No one has portal access on this matter yet." shows near the share controls and the card when no live access row exists.
- Portal matter page: requests, "Shared with you", "Your uploads", and the uploader.

### Open risks and deferred items (documents)
- No virus scanning: allowlist plus attachment-only download instead.
- No bulk share: the browser has no multi-select; share a folder instead.
- Dev multipart upload on `portal.localhost` goes through the proxy, which truncates bodies past 10 MB (`proxyClientMaxBodySize`); the uploader refuses larger local batches. Production uses client-direct blob.
- "Overdue" uses America/Denver (the firm has no zone field).
- Client uploads stay downloadable by co-clients of the matter even if staff move or unshare them (they are matter documents, ADR-052).
- The blob path reloads the list 1.5 s after a batch, so a slow webhook can lag it.
- No due-date reminder emails.
- A blob whose completion webhook never arrives is never cleaned up (as on the staff path).
- "Copy to..." into a shared folder makes the copy client-visible with no warning.
- Deleting the only file of a submitted request leaves it `submitted`; staff send it back or cancel it.
