# Client Portal Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients upload requested and unprompted files through the portal, and staff share files and folders back to them.

**Architecture:** Extend `Document` / `DocumentFolder` with share fields and a portal uploader; add a `DocumentRequest` model. One visibility module decides what a portal identity can see; portal-only upload and download routes live under `src/app/(portal)/portal/api/` (served at `/api/...` on the portal host by the proxy rewrite). Staff mutations are server actions in `src/app/actions/portal-documents.ts`.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before route work), Prisma/Postgres, `@vercel/blob/client` `handleUpload`, Vitest + Testing Library, Resend via `sendEmail`.

**Spec:** `docs/superpowers/specs/2026-10-19-portal-documents-design.md`

## Global Constraints

- Every test run needs `docker compose -f docker-compose.test.yml up -d`.
- Commit with an explicit pathspec (`git commit -m "…" -- <paths>`), `git add` only new files you created; never leave files staged. End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Matter scope on staff actions: `assertMatterAccess` / `matterAccessWhere` (`src/lib/matter-access.ts`); never query by `matterId` alone (ADR-039).
- Portal guards: pages call `requirePortalIdentity()` first; actions and routes use `getPortalIdentity()` and return results, never `redirect()`.
- Bytes never through server actions (ADR-034).
- Date-only `dueDate` is a UTC-midnight calendar date (ADR-012).
- Portal queries `select` explicit fields; never spread a staff query result.
- Client emails name no matter and no file. Copy: request subject "Your legal team has requested documents"; share subject "Your legal team shared documents with you".
- Allowlist extensions: pdf, doc, docx, xls, xlsx, ppt, pptx, jpg, jpeg, png, heic, heif, webp, gif, tif, tiff, mp3, m4a, wav, mp4, mov, txt, rtf.
- Rejection copy: `We can't accept .<ext> files. Please send PDFs, photos or Office documents.`
- Daily cap: 100 portal uploads per identity per rolling 24 h.

## Review Focus

1. A file moved out of a shared folder into an unshared one must disappear from the portal immediately (no cached share flag). Test in Task 2.
2. A client on two matters must never see matter B's shares on matter A's page, nor download them by id. Test in Task 6.
3. Upload completion arriving after access revoke or portal off creates no document and deletes the blob. Test in Task 5.
4. A `hidden` file inside a shared folder stays hidden when its folder is unshared and re-shared. Test in Task 2.
5. A filename with no or a double extension (`scan`, `report.pdf.exe`) is judged by its last extension and refused when not allowlisted. Test in Task 5.

---

### Task 1: Schema, migration, permission keys, folder kind

**Files:**
- Modify: `prisma/schema.prisma` (`Document` ~818, `DocumentFolder` ~2280, `PortalIdentity` ~2456, `Matter`, `User`)
- Create: `prisma/migrations/<ts>_portal_documents/migration.sql` (via `npx prisma migrate dev --name portal_documents`)
- Modify: `src/lib/permissions.ts` (portal category ~270)
- Modify: `src/lib/records-requests/folder-kinds.ts`
- Test: `src/lib/permissions.test.ts` (existing), `src/lib/records-requests/folder-kinds.test.ts`

**Interfaces:**
- Produces: `Document.clientShare String?` (`null | "shared" | "hidden"`), `Document.portalUploaderId String?` (FK `PortalIdentity`, Restrict), `Document.documentRequestId String?` (FK `DocumentRequest`, SetNull), `DocumentFolder.clientShared Boolean @default(false)`, model `DocumentRequest { id, matterId (Cascade), title, instructions String?, dueDate DateTime? @db.Date, status String @default("open"), returnNote String?, createdById String (User), createdAt, updatedAt @updatedAt, completedAt DateTime?, documents Document[], @@index([matterId, status]), @@map("document_requests") }`. `Document.portalBatchId String?` (client-generated uuid per upload batch). Index `Document(portalUploaderId, createdAt)`.
- Produces: keys `portal.share_documents`, `portal.add_requests`, `portal.edit_requests`, `portal.delete_requests`.
- Produces: `"portal_uploads"` in `FOLDER_SYSTEM_KINDS`; `folderSourceLink` returns null for it.

- [ ] **Step 1:** Edit the schema as above; run `npx prisma migrate dev --name portal_documents`.
- [ ] **Step 2:** Append to the generated migration the grant, copying the foundation pattern (`20261019090000_client_portal_foundation/migration.sql:109-113`) with the four new keys. Run `npm run check:migrations`. Expected: passes.
- [ ] **Step 3:** Add the four catalog entries (labels: "Share documents with clients", "Request documents from clients", "Manage document requests", "Delete document requests"; descriptions say what each allows). Run `npx vitest run src/lib/permissions.test.ts`. Expected: PASS (it checks prefix = category).
- [ ] **Step 4:** Write test `folder-kinds.test.ts`: `isProtectedFolder({systemKind:"portal_uploads"})` is true; `folderSourceLink({systemKind:"portal_uploads", recordsRequestId:null}, scope)` is null. Add the kind. Run; expected PASS.
- [ ] **Step 5:** Commit `feat(portal-docs): schema, permission keys, From client folder kind`.

### Task 2: Visibility module

**Files:**
- Create: `src/lib/portal/document-visibility.ts`, `src/lib/portal/document-visibility.test.ts` (pure), `src/lib/portal/document-visibility.integration.test.ts`

**Interfaces:**
- Produces (pure): `sharedFolderIds(folders: {id: string; parentId: string | null; clientShared: boolean}[]): Set<string>` (a folder is in the set if it or any ancestor has `clientShared`); `isEffectivelyShared(doc: {clientShare: string | null; folderId: string | null}, shared: Set<string>): boolean`; `shareReason(doc, folders): {kind: "file"} | {kind: "folder"; folderName: string} | null` (the nearest shared ancestor's name, for the staff tooltip).
- Produces (DB): `listPortalSharedDocuments(identityId: string, matterId: string): Promise<PortalDocumentRow[]>` and `canPortalDownload(identityId: string, documentId: string): Promise<{fileUrl: string; name: string; contentType: string | null} | null>`. `PortalDocumentRow = {id; name; contentType; fileSize; createdAt; folderName: string | null}`. Both require live access (`portalMatterWhere`), `status != "archived"`, `matterId` not null, and either effective share **or** (download only) `portalUploader` has live access on the same matter.
- Produces: `listPortalUploads(identityId, matterId): Promise<PortalUploadRow[]>` (`{id; name; fileSize; createdAt; requestTitle: string | null; uploaderEmail: string}`).

- [ ] **Step 1: Failing pure tests**: `direct share`, `share via grandparent folder`, `hidden inside shared folder stays hidden`, `null outside any shared folder is not shared`, `shareReason names nearest shared ancestor`.
- [ ] **Step 2:** Run `npx vitest run src/lib/portal/document-visibility.test.ts`; expected FAIL (module missing).
- [ ] **Step 3:** Implement the pure functions (walk `parentId` with a visited set; depth ≤ `MAX_FOLDER_DEPTH`).
- [ ] **Step 4: Failing integration tests**: archived excluded; lead document never listed; revoked access returns `[]` and download null; portal off returns null; **moving a file from a shared to an unshared folder removes it** (Review Focus 1); **hidden file stays hidden after the folder is unshared then re-shared** (Review Focus 4); own-matter upload downloadable though unshared; other-matter upload not downloadable.
- [ ] **Step 5:** Implement the DB functions (load the matter's folders once, compute `sharedFolderIds`, filter in memory). Run both test files; expected PASS.
- [ ] **Step 6:** Commit `feat(portal-docs): visibility rule`.

### Task 3: Document request actions

**Files:**
- Create: `src/app/actions/portal-documents.ts`, `src/app/actions/portal-documents.test.ts`
- Modify: `src/lib/portal/emails.ts` (+ test beside it if one exists, else add assertions in the action test)

**Interfaces:**
- Consumes: Task 1 model and keys.
- Produces (all return `Promise<{ok: true} | {ok: false; error: string}>`): `createDocumentRequest(matterId, input: {title: string; instructions?: string; dueDate?: string /* YYYY-MM-DD */})` (`portal.add_requests`); `updateDocumentRequest(id, input)` (`portal.edit_requests`, only while `open`); `acceptDocumentRequest(id)` (`submitted → complete`, sets `completedAt`); `sendBackDocumentRequest(id, note: string)` (`submitted → open`, sets `returnNote`); `cancelDocumentRequest(id)` (`open|submitted → cancelled`); `deleteDocumentRequest(id)` (`portal.delete_requests`; refused with `"This request has files attached. Cancel it instead."` when any document links to it).
- Produces: `documentRequestEmail(link: string): Body`, `documentsSharedEmail(link: string): Body` in `emails.ts`; helper `emailLivePortalUsers(matterId: string, body: Body): Promise<{sent: number; failed: number}>` in `src/lib/portal/notify-clients.ts`.
- Conflict copy: `"This request changed, refresh to see it."`

- [ ] **Step 1: Failing tests**: each action denies without its permission; walled user (not on team of a restricted matter) refused; create emails every live identity once and none revoked; email bodies contain neither matter name nor title; each transition from the wrong status returns the conflict copy; **race**: `Promise.all([acceptDocumentRequest(id), cancelDocumentRequest(id)])` yields exactly one `ok`; delete refused with a linked document; every success writes one `ActivityLog` with `matterId` and calls `revalidatePath` for the matter.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement. Transitions use `prisma.documentRequest.updateMany({ where: { id, status: <expected> } })` and check `count`. Email failures are logged and set the activity `detail` suffix `"— email failed"`; they never fail the action.
- [ ] **Step 4:** Run; expected PASS. Commit `feat(portal-docs): document request actions`.

### Task 4: Share actions and move warning

**Files:**
- Modify: `src/app/actions/portal-documents.ts` (+ test)
- Modify: `src/app/actions/document-folders.ts` (`moveDocuments` ~373) only to return visibility deltas
- Create: `src/lib/portal/share-delta.ts` (+ `.test.ts`)

**Interfaces:**
- Produces: `setDocumentsClientShare(documentIds: string[], shared: boolean)` (inside an effectively shared folder, `shared=false` writes `"hidden"`; otherwise `null`; `shared=true` writes `"shared"`); `setFolderClientShared(folderId: string, shared: boolean)`. Both `portal.share_documents`, matter-only (lead scope refused: `"Lead documents can't be shared with clients."`), one activity row per call, one `documentsSharedEmail` per live identity per call when something became visible.
- Produces: `visibilityChangeForMove(docs: {clientShare; folderId}[], targetFolderId: string | null, folders): {becomesVisible: number; becomesHidden: number}` used by the move dialog (Task 8).

- [ ] **Step 1: Failing tests**: bulk share of 50 docs sends one email per identity; unshare inside a shared folder writes `hidden`; unshare outside writes `null`; folder share email sent once; lead-scope refused; `visibilityChangeForMove` counts for into-shared, out-of-shared, and hidden-file cases.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(portal-docs): share actions and move delta`.

### Task 5: Portal upload (token, completion, dev route, notification)

**Files:**
- Create: `src/lib/portal/upload-policy.ts` (+ `.test.ts`)
- Create: `src/app/(portal)/portal/api/documents/upload/blob/route.ts`, `.../blob/portal-blob-upload.ts` (+ `.test.ts`)
- Create: `src/app/(portal)/portal/api/documents/upload/route.ts` (local-driver multipart, + `.test.ts`)
- Create: `src/lib/portal/record-upload.ts` (shared completion used by both routes, + integration test)
- Modify: `src/lib/notifications.ts` (`NotificationType` + `"portal_upload"`), `src/lib/notification-type-meta.ts`
- Modify: `src/proxy.ts` matcher only if the dev multipart path must skip the proxy body cap (see Step 6)

**Interfaces:**
- Consumes: `contentTypeForFilename`, `MAX_STANDARD_UPLOAD_BYTES`, `MAX_MEDIA_UPLOAD_BYTES`, `isMediaType` (`src/app/api/documents/upload/upload-config.ts`); staff `onUploadCompleted` (blob-upload.ts:288) as the pattern for redelivery and blob cleanup.
- Produces: `PORTAL_UPLOAD_EXTENSIONS: readonly string[]`; `checkPortalUpload(filename: string): {ok: true; contentType: string; maxBytes: number} | {ok: false; error: string}` (last extension, case-insensitive); `PORTAL_DAILY_UPLOAD_CAP = 100`.
- Produces: `recordPortalUpload(input: {identityId; matterId; requestId: string | null; storageKey: string; filename: string; contentType: string; size: number; note?: string}): Promise<{ok: true; documentId: string; requestClosed: boolean} | {ok: false; error: string}>`. It re-checks identity enabled, portal on, live access; ensures one `portal_uploads` folder per matter (create inside a transaction, tolerate a unique race by re-reading); creates the `Document` (`source: "portal"`, `portalUploaderId`, `documentRequestId` only if the request is still `open` on that matter, `description: note`); moves the request `open → submitted` conditionally and clears `returnNote`; `requestClosed: true` when the request was not open (the file still lands, unlinked); writes `logPortalEvent({matterId, title: "Client uploaded a document"})`.
- Produces: one `portal_upload` notification per batch to each `MatterTeamMember` user. The client sends `batchId` (uuid) in the token payload; `recordPortalUpload` stores it in `Document.portalBatchId` and notifies only when it created the first document with that `batchId`.

- [ ] **Step 1: Failing policy tests**: allowlisted types pass; `archive.zip` fails with the exact rejection copy; `report.pdf.exe` fails (Review Focus 5); `scan` (no extension) fails; `PHOTO.HEIC` passes; media gets `MAX_MEDIA_UPLOAD_BYTES`.
- [ ] **Step 2:** Implement `upload-policy.ts`; PASS.
- [ ] **Step 3: Failing token tests**: no portal identity → error; other matter → error; request on another matter → error; cancelled request → error; disallowed type → error; 101st upload in 24 h → error `"You've reached today's upload limit. Please try again tomorrow."`; success pins `allowedContentTypes` and `maximumSizeInBytes`.
- [ ] **Step 4: Failing completion tests**: creates document in `From client` folder; second upload reuses the folder; request moves to submitted and `returnNote` cleared; cancelled request → file lands unlinked, `requestClosed: true`; **revoked access or portal off → no row, blob deleted** (Review Focus 3); redelivery creates no duplicate; one notification per batch to each team member.
- [ ] **Step 5:** Implement token handler, completion and `recordPortalUpload`; PASS.
- [ ] **Step 6:** Dev multipart route reuses `checkPortalUpload` and `recordPortalUpload`. Decide the proxy cap: add the exact path `/api/documents/upload` on the portal host to the matcher exclusion only if `isPortalHost` handling still runs for it; otherwise document "10 MB cap in local dev" in the feature doc. Test: route refuses without a portal session.
- [ ] **Step 7:** Commit `feat(portal-docs): portal upload routes`.

### Task 6: Portal download route

**Files:**
- Create: `src/app/(portal)/portal/api/documents/[id]/download/route.ts` (+ `route.test.ts`)

**Interfaces:**
- Consumes: `canPortalDownload` (Task 2), `signedBlobUrl` / `openReadStream` (`src/lib/file-storage.ts`), the staff route (`src/app/api/documents/[id]/download/route.ts`) as the pattern for local-driver streaming.
- Produces: `GET` → 302 to signed URL (blob) or streamed body (local), `Content-Disposition: attachment; filename*=…`, `Cache-Control: no-store`; 404 for anything `canPortalDownload` rejects; writes no log on 404.

- [ ] **Step 1: Failing tests**: shared file downloads with attachment disposition; **file from the identity's other matter 404s** (Review Focus 2); unshared file 404s; revoked 404s; staff host request 404s; html file still `attachment`.
- [ ] **Step 2:** Implement; PASS. Commit `feat(portal-docs): portal download route`.

### Task 7: Portal pages and upload UI

**Files:**
- Modify: `src/app/(portal)/portal/matters/[id]/page.tsx` (+ `page.test.tsx`)
- Create: `src/app/(portal)/portal/matters/[id]/requests-section.tsx`, `shared-section.tsx`, `uploads-section.tsx`, `portal-uploader.tsx` (client; + tests)
- Create: `src/lib/portal/requests.ts` (`listPortalRequests(identityId, matterId)`; + integration test)
- Modify: `src/app/(portal)/portal/page.tsx` (badge; + existing test)

**Interfaces:**
- Consumes: Task 2 list functions; `checkPortalUpload` for the client pre-check; `@vercel/blob/client` `upload()` against `/api/documents/upload/blob` when the blob driver is active, else POST multipart to `/api/documents/upload`.
- Produces: `listPortalRequests → {open: Req[]; submitted: Req[]; done: Req[]}` where `Req = {id; title; instructions; dueDate: string | null; returnNote: string | null; overdue: boolean}`; `cancelled` excluded; `countOpenRequestsByMatter(identityId): Promise<Map<string, number>>`.
- Copy: section titles "Requested from you", "Shared with you", "Your uploads"; submitted line "Received, the firm is reviewing"; done toggle "Done (n)"; home badge "1 item requested" / "n items requested"; empty states "Nothing requested right now", "Nothing shared yet", "You haven't uploaded anything yet".

- [ ] **Step 1: Failing tests**: page renders three sections with seeded data; sent-back request shows its note; overdue shows "Overdue"; uploader rejects `.zip` before any network call with the exact copy; uploader shows per-file progress; home shows the badge only for matters with open requests; `portal-guards.test.ts` still passes.
- [ ] **Step 2:** Implement (phone-first; follow `docs/UI_PATTERNS.md#client-portal`); after all files finish, `window.location.reload()` (no `redirect`). PASS.
- [ ] **Step 3:** Commit `feat(portal-docs): portal matter page sections and uploader`.

### Task 8: Staff UI

**Files:**
- Modify: `src/lib/queries/matter-detail/documents.ts` (`DocumentRow` + `clientShare`, `portalUploaderName: string | null`, `shareReason`), `src/lib/queries/document-listing.ts` (folders + `clientShared`, `sharedEffective`)
- Modify: `src/components/matters/documents/document-row-actions.tsx`, `folder-row-actions.tsx`, `move-to-folder-dialog.tsx`, `src/components/documents/documents-browser.tsx` (badge, "From <name>" label, bulk action)
- Create: `src/components/matters/client-requests-card.tsx` (+ test); modify `src/app/(dashboard)/matters/[id]/page.tsx` to render it beside `portal-card.tsx` when `portal.view`
- Create: `src/lib/queries/document-requests.ts` (staff list, explicit select, matter access)

**Interfaces:**
- Consumes: Task 3 and 4 actions, `shareReason`, `visibilityChangeForMove`.
- Copy: menu "Share with client" / "Stop sharing"; folder "Share folder with client" / "Stop sharing folder"; badge "Shared"; tooltip "Shared with client" or "Shared via folder <name>"; move warnings "This file will become visible to the client." / "This file will no longer be visible to the client." (pluralised "n files"); hint "No one has portal access on this matter yet."; label "From <contact name>".

- [ ] **Step 1: Failing tests**: share items hidden without `portal.share_documents`; lead documents show no share items; badge and tooltip reason; move dialog shows the warning only when the delta is non-zero; requests card hides New without `portal.add_requests`, hides Delete when files are attached, shows Accept/Send back only for submitted.
- [ ] **Step 2:** Implement; PASS. Run `npm test` (full). Expected: all pass.
- [ ] **Step 3:** Commit `feat(portal-docs): staff sharing and requests UI`.

### Task 9: Docs and cleanup

**Files:**
- Modify: `docs/features/client-portal.md` (Documents end-state section; table row 2 → Shipped), `docs/ROADMAP.md`, `docs/PERMISSIONS.md`, `docs/decisions/README.md`
- Create: `docs/decisions/052-portal-uploads-are-matter-documents.md`
- Delete: the spec and this plan

- [ ] **Step 1:** Write ADR-052: client uploads are ordinary matter documents; three-state file share with folder inheritance; matter-wide audience; no scanner in v1 (allowlist + attachment-only). Add its README row.
- [ ] **Step 2:** Update the feature doc (end state, not history; keep under ~15 KB), ROADMAP line, PERMISSIONS.
- [ ] **Step 3:** `git rm` spec and plan; commit `docs(portal-docs): feature doc, ADR-052; drop spec and plan`.
