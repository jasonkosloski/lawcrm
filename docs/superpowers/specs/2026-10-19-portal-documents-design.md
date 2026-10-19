# Client portal, sub-project 2: Documents (design)

Status: design approved in chat 2026-10-19; spec awaiting review.
Parent: [client-portal.md](../../features/client-portal.md). Sub-projects 1 (case status), 3 (messages) and 4 (invoices and trust) follow, each with its own spec.

## Goal

Get documents from clients faster and without email attachments. Staff ask for specific items, the client uploads against them from a phone or computer, and staff share files back. Success: a client can see what is still needed, upload it in a minute, and the matter team is told; staff never re-file an emailed attachment.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Upload model | Document requests (checklist) **and** free upload |
| Safety without a scanner | Allowlist of file types; client files always download as attachments; no scanning in v1 |
| Staff to client sharing | Per-file toggle **and** a folder toggle; a shared folder stays shared (inherited by later files and subfolders); a file can be hidden inside a shared folder |
| Audience | Matter-wide: every invited portal user on the matter sees shares and requests; any of them can fulfil a request |
| Notifications | Staff bell on client upload; client email on new request and on share (one email per action). No due-date reminders in v1 |
| Architecture | Extend `Document` / `DocumentFolder`; client uploads become ordinary matter documents (approach A) |

Out of scope for v1: virus scanning, per-person audiences, reminder emails, client deleting or replacing their uploads, lead documents (the portal is matters only).

## Data model

**`Document.clientShare`**: `String?`, values `null` (inherit from folder), `"shared"`, `"hidden"`.

**`DocumentFolder.clientShared`**: `Boolean @default(false)`.

**`Document.portalUploaderId`**: `String?` FK to `PortalIdentity` (`onDelete: Restrict`; identities are never hard-deleted). At most one of `uploadedBy` (staff user id) and `portalUploaderId` is set; app-enforced and covered by a test.

**`Document.documentRequestId`**: `String?` FK to `DocumentRequest` (`SetNull`).

**`DocumentRequest`** (new):
- `id`, `matterId` (Cascade), `title`, `instructions String?`, `dueDate DateTime? @db.Date` (UTC-midnight calendar date, ADR-012)
- `status`: `open | submitted | complete | cancelled`
- `returnNote String?` (set by Send back; cleared on the next submit)
- `createdById` (staff User), `createdAt`, `updatedAt`, `completedAt DateTime?`
- `@@index([matterId, status])`

Send back is not a separate status: it sets `status = open` with a `returnNote`, so the client sees it back in "Requested from you" with the note.

**"From client" folder**: a `DocumentFolder` with `systemKind = "portal_uploads"` (added to `src/lib/records-requests/folder-kinds.ts` or a sibling), created lazily on the first client upload to a matter, one per matter, protected like the other generated folders, `clientShared = false`.

**Permission keys** (category `portal`): `portal.share_documents`, `portal.add_requests`, `portal.edit_requests` (edit, accept, send back, cancel), `portal.delete_requests`. The migration grants them to every role holding `matters.edit`, as the foundation migration did.

## Visibility rule

One function, `portalVisibleDocumentWhere(identityId)` / `isDocumentVisibleToPortal(...)` in `src/lib/portal/document-visibility.ts`, used by every portal query and the download route. A document is visible when:

1. `matterId` is a matter where the identity has a live `PortalMatterAccess` (via `portalMatterWhere`), and the portal is on;
2. it is not archived (`status != "archived"`) and not a lead document;
3. `clientShare != "hidden"`; and
4. `clientShare == "shared"`, **or** it sits in a folder that has `clientShared = true` or has an ancestor that does.

Ancestry is resolved per matter by loading that matter's folder tree (small) and computing the set of effectively-shared folder ids, rather than a recursive SQL query. The client's own uploads are listed separately (rule: `portalUploaderId` belongs to an identity on the same matter); they are not "shared" documents and do not require rule 4.

## Client experience (portal host)

`/matters/[id]` replaces "Nothing shared yet" with three sections:

1. **Requested from you**: open requests first (title, instructions, due date or "Overdue" in a muted warning tone, Upload button; a sent-back request shows its `returnNote`), then submitted ("Received, the firm is reviewing"), then a collapsed "Done (n)".
2. **Shared with you**: visible documents grouped under their folder name (flat, no tree), each with name, type, date, Download.
3. **Your uploads**: uploads by any identity on this matter, with date, size and the request they answered; an "Upload a file" button with an optional "What is this?" note (stored as the document description).

`/` adds a per-matter badge ("2 items requested") for open requests.

**Upload UI**: drag-and-drop or file picker, multiple files, per-file progress, phone-first layout. Client-side pre-check of the type allowlist with a plain message ("We can't accept .zip files. Please send PDFs, photos or Office documents.").

**Allowlist** (new `PORTAL_UPLOAD_TYPES` beside `upload-config.ts`): PDF; Word, Excel, PowerPoint (doc/docx/xls/xlsx/ppt/pptx); images (jpg, jpeg, png, heic, heif, webp, gif, tiff); audio/video (mp3, m4a, wav, mp4, mov); txt, rtf. Content type derives from the filename via `contentTypeForFilename`; the declared MIME is ignored. Size limits match staff. Limit: 100 files per identity per rolling 24 hours (counted from `Document.portalUploaderId` + `createdAt`).

## Upload and download paths

Bytes never travel through server actions (ADR-034).

- **Upload token route** (portal-only, under `src/app/(portal)/portal/api/documents/upload/...`, served at `/api/documents/upload/...` on the portal host by the proxy rewrite). `onBeforeGenerateToken` requires: portal identity (`getPortalIdentity`), portal on, live access to the matter, request (if given) `open` and on the same matter, allowlisted type, and under the daily limit. It pins `allowedContentTypes` and `maximumSizeInBytes` like the staff handler.
- **Completion** re-checks identity, access and portal-on (access may have been revoked mid-upload), ensures the "From client" folder, creates the `Document` (`portalUploaderId`, `documentRequestId`, `source = "portal"`), moves the request `open -> submitted` with a conditional update, notifies the team, and logs. If the row cannot be created the blob is deleted (log on cleanup failure), following the staff pattern.
- **Dev local driver**: the portal equivalent of the multipart route. Note: on the portal host the proxy runs on every path, so the 10 MB proxy body cap applies; the plan must either exclude that exact path from the matcher or accept the cap in dev only.
- **Download route** (portal-only): identity + visibility rule (or own-matter upload), always `Content-Disposition: attachment`, redirect to a 15-minute signed URL, uncached. Anything not visible returns 404.

Portal server actions never call `redirect()` (see `portal-session.ts`); they return a result and the client navigates.

## Staff experience

- **Documents tab**: "Share with client" / "Stop sharing" in the file menu and as a bulk action (inside a shared folder, Stop sharing sets `hidden`; outside, it clears to `null`). "Share folder with client" / "Stop sharing folder" in the folder menu. A "Shared" badge on every effectively visible file and folder, with a tooltip giving the reason ("Shared via folder Discovery"). Client uploads carry a "From <contact name>" label.
- **Moves**: the move dialog warns when a move changes visibility ("This file will become visible to the client." / "...will no longer be visible...").
- **No identities yet**: share actions work; a hint reads "No one has portal access on this matter yet."
- **Client requests panel** on the matter Overview beside the Portal card: New request (title, instructions, due date); rows with status and attached files (open in the existing viewer); Accept, Send back (note), Cancel; Edit and Delete while open. Delete is refused once any document is attached (cancel instead).
- All mutations are server actions in `src/app/actions/portal-documents.ts`: `requirePermission`, `assertMatterAccess` (ethical walls, ADR-039), `logActivity`, `revalidatePath`.

## Concurrency

Every request transition is a conditional `updateMany` on the expected current status; a zero count returns "This request changed, refresh to see it" (staff) or, for a client upload racing a cancel, lands the file as a free upload with "This request was closed by the firm". Share toggles are idempotent writes.

## Notifications and email

- **Staff**: one bell notification per client upload batch (new type `portal_upload`, `src/lib/notification-type-meta.ts`) to the matter team, linking to the Documents tab.
- **Client**: email on new request and on each share action (a bulk or folder share sends one email per live identity on the matter). Templates in `src/lib/portal/emails.ts`; generic copy with a portal link and no matter or file names. Only identities with live access are emailed. A send failure never rolls back the action; it is logged and noted on the activity row.
- **Timeline**: shares, unshares, request changes and client uploads are logged on the matter (`logActivity` for staff, `logPortalEvent` with `matterId` for clients).

## Testing

- Visibility unit tests: direct share, deep ancestor share, hidden inside shared folder, archived, lead document, revoked access, portal off.
- Portal routes: cross-matter download, unshared download, revoked access, disallowed type at token and completion, daily limit, completion after revoke.
- Request transitions: every allowed transition, a race where exactly one of two wins, delete refused with attachments.
- Staff actions: permission, matter access (walled user), activity log, revalidation.
- Email and notifications: one email per bulk share, no matter details in bodies, staff notified once per batch.
- Pages: portal matter page sections; staff panel actions by permission; `portal-guards.test.ts` covers new portal pages.
- The "at most one uploader" invariant.

## Docs

- `docs/features/client-portal.md`: Documents section (end state), table row to Shipped; `docs/ROADMAP.md` line.
- New **ADR-052**: client uploads are ordinary matter documents; three-state file share with folder inheritance; matter-wide audience. Row in `docs/decisions/README.md`.
- `docs/PERMISSIONS.md`: the four keys.
- Delete this spec and its plan in the commit that finishes the feature.

## Rollout

One migration (fields, table, permission grants). Nothing is visible to clients until staff share or request something; the firm switch still gates the whole portal.
