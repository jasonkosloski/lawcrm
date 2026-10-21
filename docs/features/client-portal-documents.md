# Client portal: documents

Sub-project 2 of the [client portal](client-portal.md): shared downloads, client uploads and document requests. Foundation (identity, hosts, access helpers) and the publishing rule live in the parent file.

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

### Open risks and deferred items
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
