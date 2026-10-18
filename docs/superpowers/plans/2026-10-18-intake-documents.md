# Intake Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Documents and document folders can belong to an intake lead, with a full intake Documents tab and viewer, and move to the matter when the lead converts.

**Architecture:** Same pattern as intake notes, tasks and events (ADR-044/045):

- **Schema:** `Document.leadId` and `DocumentFolder.leadId` are added, and `matterId` becomes nullable, with exactly one of the two set.
- **Server:** actions, routes and queries take or derive a `RecordScope` (`src/lib/record-scope.ts`).
- **UI:** the matter Documents components take `scope` instead of `matterId`. The matter page bodies become shared server components that both the matter and intake routes render.

**Tech Stack:** Next.js (this repo's version; read `node_modules/next/dist/docs/` before touching route conventions), Prisma 7 / Postgres, Vitest (integration tests hit the Docker test DB), React 19 server components + server actions.

**Spec:** `docs/superpowers/specs/2026-10-18-intake-documents-design.md`

## Global Constraints

- Invariant: **exactly one** of (matterId, leadId) on `Document` and `DocumentFolder`; a folder and the documents in it share a scope.
- FKs: `Document.leadId` → Lead, onDelete Cascade; `DocumentFolder.leadId` → Lead, onDelete Cascade; both indexed.
- Permissions: the existing `documents.*` keys only. No new keys. Lead documents have no matter wall.
- Writes to a **converted** lead (upload, new folder, generate) are refused with "This lead is already converted — add this on the matter instead." (the intake-writes precedent).
- Mutations stay server actions (AGENTS.md); the two existing upload routes are the only non-action write paths and stay routes.
- Every reader of `Document.matterId` / `DocumentFolder.matterId` gets a scope-correct fix. No `!` non-null assertions on a scope column.
- Migration directory: `prisma/migrations/20261018180000_lead_documents/` (hand-written SQL, generated with `prisma migrate diff --from-schema <old> --to-schema prisma/schema.prisma --script`).
- Test runs need `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, proceed"` set (user consented for this session to pushing the schema to the local test DB).
- Tests sit next to their source as `*.test.ts(x)`. The pre-commit hook runs typecheck + lint + related tests.

## Review Focus

1. **A folderId from the other scope** posted to an upload (a lead folder with a matterId, or the reverse) is rejected 400 before any byte is stored. Tests in Task 4.
2. **Move / copy across scopes** (lead document → matter folder, or the reverse) is refused with an error, and nothing moves. Tests in Tasks 2 and 3.
3. **A viewer URL that mixes scopes** (`/intake/L/documents/<a matter document id>`, or `/matters/M/documents/<a lead document id>`) renders notFound and never leaks the file. Test in Task 5.
4. **Uploading or creating a folder on a converted lead** is refused (the route returns 409, the action returns an error). Tests in Tasks 2 and 4.
5. **No revalidation path ever contains `null`** (`/matters/null/...`). A helper builds every path, with a unit test in Task 1, and integration tests assert intake paths in Tasks 2 and 3.

---

### Task 1: Schema, migration, scope helpers, compile sweep

**Files:**
- Modify: `prisma/schema.prisma` (models `Document`, `DocumentFolder`, `Lead`)
- Create: `prisma/migrations/20261018180000_lead_documents/migration.sql`
- Modify: `src/lib/record-scope.ts`, `src/lib/record-scope.test.ts`
- Create: `src/lib/scope-access.ts`, `src/lib/scope-access.test.ts`
- Modify (compile sweep, today's 13 type errors): `src/lib/queries/search.ts:490`, `src/lib/queries/document-viewer.ts:123`, `src/app/api/documents/[id]/download/route.ts:109`, `src/app/actions/flagged-moments.ts:276,386,392,452,458`, `src/app/actions/documents.ts:166,203,326`, `src/app/actions/document-folders.ts:179,329`
- Modify: `docs/SCHEMA_NOTES.md` (models table + changelog)
- Modify: `src/app/actions/matter-access-guards.test.ts` (add `assertScopeAccess` to the `ACCESS_CALL` regex, since it wraps `assertMatterAccess` for matter scopes)

**Interfaces:**
- Produces in `src/lib/record-scope.ts`:
  - `scopeOf(row: { matterId: string | null; leadId: string | null }): RecordScope`. Throws on both or neither. Move `noteScopeOf`'s logic here and make `noteScopeOf` call it.
  - `scopeWhere(scope: RecordScope): { matterId: string } | { leadId: string }`, for Prisma `where` / `data` spreads.
  - `scopeBasePath(scope: RecordScope): string` → `/matters/{id}` or `/intake/{id}`.
  - Existing `scopePaths(scope, "documents")` is reused for revalidation.
- Produces in `src/lib/scope-access.ts` (server-only):
  - `assertScopeAccess(scope: RecordScope): Promise<string>`. For a matter scope it is `assertMatterAccess`. For a lead scope it calls `notFound()` if the lead doesn't exist, otherwise returns the user id.
  - `assertScopeWritable(scope: RecordScope): Promise<string | null>`. Returns the converted-lead error string for a converted lead, null otherwise. A matter scope always returns null.
  - `revalidateDocumentScope(scope: RecordScope, documentId?: string): void`. Revalidates `scopePaths(scope, "documents")` with the `"layout"` type on the documents path (today's `revalidateDocuments` behavior), plus `${scopeBasePath}/documents/${documentId}` when given.

- [ ] **Step 1: Write failing unit tests** in `record-scope.test.ts`:
  - `scopeOf` returns the matter and lead shapes and throws `/both set/` and `/neither/`.
  - `scopeWhere({kind:"lead",leadId:"l1"})` equals `{ leadId: "l1" }`.
  - `scopeBasePath` returns `/intake/l1` and `/matters/m1`.
  - In `scope-access.test.ts` (Prisma and `next/cache` mocked): `revalidateDocumentScope({kind:"lead",leadId:"l1"},"d1")` calls `revalidatePath` with exactly `/intake/l1/documents` (layout), `/intake/l1` and `/intake/l1/documents/d1`, and no argument contains `"null"`.
- [ ] **Step 2: Run** `npx vitest run src/lib/record-scope.test.ts src/lib/scope-access.test.ts`. Expected: FAIL (functions not defined).
- [ ] **Step 3: Implement the helpers** above.
- [ ] **Step 4: Schema change.** `matterId String?` + `leadId String?` on both models. Relations `lead Lead? @relation("LeadDocuments" | "LeadDocumentFolders", onDelete: Cascade)`. `@@index([leadId])` on documents; `@@index([leadId, parentId])` on folders. Inverse relations on `Lead`: `documents`, `documentFolders`, with a comment that they re-home on conversion. Schema comments state the exactly-one invariant. Generate the migration SQL into the directory above, then run `npx prisma generate`.
- [ ] **Step 5: Compile sweep.** `npx tsc --noEmit -p tsconfig.json`. Fix each listed site by deriving `scopeOf(row)` and using `scopeBasePath` / `revalidateDocumentScope` / `scopeWhere`. `flagged-moments.ts`'s `revalidateFlagSurfaces(matterId, documentId)` becomes `revalidateFlagSurfaces(scope, documentId)`, and it revalidates `/matters/{id}/evidence` only for a matter scope. Expected: 0 errors.
- [ ] **Step 6: Run** `npx vitest run src/lib/record-scope.test.ts src/lib/scope-access.test.ts src/app/actions/flagged-moments.test.ts src/app/actions/documents.test.ts src/app/actions/document-folders.test.ts`. Expected: PASS.
- [ ] **Step 7: Run** `npm run check:migrations`. Expected: "migrations match schema.prisma".
- [ ] **Step 7b:** Add `assertScopeAccess` to `ACCESS_CALL` in `matter-access-guards.test.ts`, then run it. Expected: PASS.
- [ ] **Step 8:** SCHEMA_NOTES entry (Document + DocumentFolder rows in the models table; changelog line naming the migration, the invariant, and "no backfill").
- [ ] **Step 9: Commit** `feat(documents): lead scope on Document/DocumentFolder (schema + helpers)`.

### Task 2: Folder actions are scope-aware

**Files:**
- Modify: `src/app/actions/document-folders.ts`, `src/app/actions/document-folders.test.ts`

**Interfaces:**
- Consumes: Task 1's `scopeOf`, `scopeWhere`, `assertScopeAccess`, `assertScopeWritable`, `revalidateDocumentScope`.
- Produces:
  - `createFolder(scope: RecordScope, parentId: string | null, name: string): Promise<FolderActionResult>` (was `(matterId, parentId, name)`). `fetchMatterFolders` becomes `fetchScopeFolders(scope)`.
  - `renameFolder`, `deleteFolder` and `moveFolder` keep their signatures and derive scope from the folder row.
  - `moveDocuments(ids, targetFolderId)` keeps its signature. It refuses when the documents span more than one scope, or when the target folder's scope differs from theirs: `{ ok: false, error: "Documents and folders can only move within the same matter or intake." }`.

- [ ] **Step 1: Write failing integration tests** (seed a lead with `seedLead`; seed lead folders and documents with `prisma.documentFolder.create({ data: { leadId, name } })`):
  - `createFolder({kind:"lead",leadId}, null, "Medical")` → ok. The row has `leadId` and a null `matterId`. `revalidatePath` is called with `/intake/${leadId}/documents`.
  - `createFolder` on a converted lead → `{ ok:false }` with the converted-lead message.
  - `createFolder` with a `parentId` that belongs to a matter → `{ ok:false }`.
  - Moving a lead document into a matter folder → refused, and the row is unchanged.
  - Moving a lead folder under a matter folder → refused.
  - Renaming or deleting a lead folder works and revalidates intake paths.
- [ ] **Step 2: Run** `npx vitest run src/app/actions/document-folders.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Replace `assertMatterAccess(matterId)` with `assertScopeAccess(scope)`. Check `assertScopeWritable` on create. Folder lookups use `scopeWhere`.
- [ ] **Step 4: Run** the same file. Expected: PASS (existing matter tests also pass).
- [ ] **Step 5: Commit** `feat(documents): scope-aware folder actions`.

### Task 3: Document actions + email-attachment extraction are scope-aware

**Files:**
- Modify: `src/app/actions/documents.ts` (`deleteDocument`, `extractAttachments`, `copyDocumentToFolder`, `revalidateDocuments`), `src/lib/email-attachment-extract.ts`, `src/app/actions/documents.test.ts`, `src/app/actions/document-copies-attachments.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: unchanged action signatures. `revalidateDocuments(matterId)` is removed in favor of `revalidateDocumentScope`. `copyDocumentToFolder` refuses a target folder in another scope (same message as Task 2). Extracted attachments inherit the email document's `matterId`/`leadId` (via `scopeWhere(scopeOf(email))`).

- [ ] **Step 1: Write failing integration tests:**
  - Deleting a lead document removes it and revalidates `/intake/${leadId}/documents`.
  - Extracting attachments from a lead `.eml` document creates children with `leadId` set and `matterId` null. Reuse the existing `.eml` fixture used by `document-copies-attachments.test.ts`.
  - Copying a lead document into a matter folder is refused.
  - Copying a lead document into another lead folder works, and the copy has `leadId`.
- [ ] **Step 2: Run** both test files. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(documents): scope-aware document actions and attachment extraction`.

### Task 4: Upload routes accept `leadId`

**Files:**
- Modify: `src/app/api/documents/upload/route.ts` (`resolveTarget`, `Target`, revalidation at :225), `src/app/api/documents/upload/blob/blob-upload.ts` (payload schema :75, target checks :138–:169, completion :239–:324), `src/app/api/documents/upload/route.test.ts`, and the blob-upload test file next to it (create `blob-upload.test.ts` if there is none)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  - `Target` carries `scope: RecordScope` in place of `matterId: string`.
  - Multipart field contract: exactly one of `matterId` / `leadId` must precede the file parts. The error copy when both or neither is sent is `"Exactly one of matterId or leadId is required and must precede file parts in the form data."`.
  - The blob payload schema gets `leadId: z.string().min(1).optional()`, with `matterId` optional too, refined to exactly one.
  - A converted lead → `{ status: 409, error: <converted-lead message> }`. An unknown lead → 404 `"Lead not found."`. A folder not in the scope → 400 `"Folder not found in this matter or intake."`.

- [ ] **Step 1: Write failing tests** in `route.test.ts`, following its existing request-building helper:
  - A lead upload → 200, and the stored row has `leadId`.
  - Both ids → 400.
  - A matter folderId with a leadId → 400, and nothing is stored (`storeFile` not called).
  - A converted lead → 409.
  - The same four cases for the blob path's token/completion validation.
- [ ] **Step 2: Run** `npx vitest run src/app/api/documents/upload`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Lead validation is `prisma.lead.findUnique` + `assertScopeWritable`. Matter validation is unchanged (`canAccessMatter`). Revalidate with `revalidateDocumentScope`. `extractIfEmail` is unchanged (Task 3 made it scope-aware).
- [ ] **Step 4: Run** the same path. Expected: PASS.
- [ ] **Step 5: Commit** `feat(documents): upload routes accept leadId`.

### Task 5: Download route, viewer queries, listing queries

**Files:**
- Modify: `src/app/api/documents/[id]/download/route.ts`, `src/lib/queries/document-viewer.ts` (`getDocumentForViewer`, `getViewerFileTree`), `src/lib/queries/document-listing.ts` (`getFolderListing`), `src/lib/queries/matter-detail.ts` (`getMatterDocumentFolders`, `getFolderDocumentCounts`), plus their test files

**Interfaces:**
- Produces:
  - `getDocumentForViewer(scope: RecordScope, documentId: string)`: the `where` uses `scopeWhere(scope)`, so a document from the other scope returns null.
  - `getViewerFileTree(scope: RecordScope, currentFolderId: string | null)`.
  - `getFolderListing(scope: RecordScope, folderId: string | null)`.
  - `getDocumentFolders(scope: RecordScope)`, renamed from `getMatterDocumentFolders`, with all callers updated.
  - `getFolderDocumentCounts(scope: RecordScope)`.
  - The download route resolves `scopeOf(doc)`. A matter document keeps the `canAccessMatter` check; a lead document needs only an authenticated user, per the route's existing ACCESS MODEL comment, which gets updated.

- [ ] **Step 1: Write failing tests:**
  - `getDocumentForViewer({kind:"lead",leadId}, matterDocId)` → null.
  - `getDocumentForViewer({kind:"matter",matterId}, leadDocId)` → null.
  - Lead listing returns only lead rows.
  - Download of a lead document by a signed-in user → streams (local driver).
- [ ] **Step 2: Run** the affected test files. Expected: FAIL.
- [ ] **Step 3: Implement** and update the matter callers (`src/app/(dashboard)/matters/[id]/documents/page.tsx`, its `[documentId]/page.tsx`, `src/app/actions/email-attachments.ts` `listMatterFolders`) to pass `{ kind: "matter", matterId: id }`.
- [ ] **Step 4: Run** `npm run typecheck` plus the affected tests. Expected: PASS, 0 type errors.
- [ ] **Step 5: Commit** `feat(documents): scope-aware viewer, listing and download`.

### Task 6: Templates on a lead

**Files:**
- Modify: `src/app/actions/document-templates.ts` (`resolveMergeContext` :268, `previewDocumentFromTemplate` :373, `generateDocumentFromTemplate` :419), `src/components/templates/generate-from-template-dialog.tsx`, and the tests for both

**Interfaces:**
- Produces:
  - `resolveMergeContext(scope: RecordScope)`. For a lead: `matter` fields are all null, with `matter.name` = the lead's display name. `client` comes from `lead.contact` (fallback to the legacy `name`/`email`/`phone` columns). `firm`, `user` and `today` are unchanged.
  - `previewDocumentFromTemplate(templateId: string, scope: RecordScope)` and `generateDocumentFromTemplate(templateId: string, scope: RecordScope)`. Generate checks `assertScopeWritable` and writes the Document with `scopeWhere(scope)`.
  - `GenerateFromTemplateDialog` props: `scope: RecordScope` instead of `matterId`.

- [ ] **Step 1: Write failing tests:**
  - Generating on a lead creates a Document with `leadId`.
  - In the merged text, `{{client.name}}` is the lead contact's name and `{{matter.caseNumber}}` renders the engine's not-on-file placeholder and appears in `missing`.
  - Generating on a converted lead → `{ ok:false }`.
- [ ] **Step 2: Run** `npx vitest run src/app/actions/document-templates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and update the matter Documents page caller.
- [ ] **Step 4: Run** the tests + typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(templates): generate documents on an intake lead`.

### Task 7: Shared Documents UI + intake Documents tab and viewer

**Files:**
- Create: `src/components/documents/documents-browser.tsx` (server component: the body of today's matter Documents page), `src/components/documents/document-viewer-body.tsx` (server component: the body of today's viewer page, including `renderBody` and `NeighborLink`)
- Modify: `src/app/(dashboard)/matters/[id]/documents/page.tsx` and `[documentId]/page.tsx` (thin wrappers: auth + `assertMatterAccess` + render the shared component with a matter scope)
- Create: `src/app/(dashboard)/intake/[id]/documents/page.tsx` + `page.test.tsx`, `src/app/(dashboard)/intake/[id]/documents/[documentId]/page.tsx`
- Modify (prop `matterId` → `scope: RecordScope`; build hrefs with `scopeBasePath`): `src/components/matters/documents/{folder-tree,new-folder-button,multi-file-upload,upload-document-form}.tsx`, `src/components/documents-viewer/{document-file-tree,document-placement,email-preview}.tsx`, and their existing tests
- Modify: `src/components/intake/intake-tabs.tsx` (add `{ slug: "documents", label: "Documents" }` after Events)

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `DocumentsBrowser({ scope, folderParam }: { scope: RecordScope; folderParam: string | null })`. The intake page passes `writable = lead.stage !== "converted"`: when false, the upload, new-folder and generate controls are hidden and the converted banner (the existing intake-tab banner idiom) links to `/matters/{convertedMatterId}/documents`.
  - `DocumentViewerBody({ scope, documentId })`. It calls `notFound()` when `getDocumentForViewer(scope, documentId)` returns null.
  - Upload components append `leadId` instead of `matterId` for a lead scope, preserving field-before-file order.

- [ ] **Step 1: Write failing tests:**
  - Intake Documents page: renders the browser with `{kind:"lead",leadId:"lead_1"}`; `documents.upload` gating hides the uploader; the converted-lead banner links to `/matters/m_9/documents`.
  - `multi-file-upload.test.tsx`: with a lead scope, the form data has `leadId` before the file part and no `matterId`.
  - Intake viewer page: a document id outside the lead → `notFound`.
- [ ] **Step 2: Run** `npx vitest run "src/app/(dashboard)/intake" src/components/matters/documents src/components/documents-viewer`. Expected: FAIL.
- [ ] **Step 3: Implement.** Move the matter page bodies verbatim into the shared components first (matter tests must stay green), then switch the props to `scope`.
- [ ] **Step 4: Run** the same + `"src/app/(dashboard)/matters/[id]"`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(intake): Documents tab and viewer on leads`.

### Task 8: Conversion carries documents forward

**Files:**
- Modify: `src/app/actions/leads.ts` (`convertLeadToMatter` transaction + post-commit logs), `src/app/actions/leads.test.ts`

**Interfaces:**
- Consumes: `nextAvailableFolderName` from `src/lib/folder-tree.ts:181`.
- Produces: inside the transaction, after `applyAutoDefaults`:
  1. Load the new matter's root folder names.
  2. For each lead root folder whose name collides, rename it to `nextAvailableFolderName(name, takenNames)`.
  3. `documentFolder.updateMany({ where: { leadId }, data: { matterId, leadId: null } })`.
  4. `document.updateMany` the same way.

  The result carries `carriedDocumentCount`. After commit, log `"N intake documents carried forward"` (singular "document") when > 0, and `revalidatePath("/matters/{id}/documents", "layout")`.

- [ ] **Step 1: Write failing tests:**
  - A lead with a nested folder (with a document) and a root document converts; every row has `matterId` = the new matter and `leadId` null; the parent/child folder link and `folderId` are intact; the activity title is `"2 intake documents carried forward"`.
  - Collision: pre-create a root folder "Medical" on the matter by seeding it inside a mocked `applyAutoDefaults`, or by calling the re-home helper directly if it's extracted as `rehomeLeadDocuments(tx, leadId, matterId)`. The lead's "Medical" arrives as `"Medical (2)"`.
- [ ] **Step 2: Run** `npx vitest run src/app/actions/leads.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as `rehomeLeadDocuments(tx: Tx, leadId: string, matterId: string): Promise<number>` in `src/lib/lead-documents.ts`, called from `convertLeadToMatter`.
- [ ] **Step 4: Run** the same file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(intake): carry lead documents to the matter on conversion`.

### Task 9: Search, docs, full verification

**Files:**
- Modify: `src/lib/queries/search.ts` (`searchDocuments`: optional-relation access clause `accessOpt` instead of `accessRel`, select `leadId` + `lead.name`, href `/intake/{leadId}/documents/{id}`, context `"Intake · {lead name}"`), `src/lib/queries/search.test.ts`
- Modify: `docs/DECISIONS.md` (ADR-046: intake documents share Document/DocumentFolder, exactly-one scope, re-home on conversion, no wall on lead documents), `docs/FEATURES.md`, `docs/UI_PATTERNS.md` (RecordScope paragraph: add documents + `DocumentsBrowser` / `DocumentViewerBody`), `docs/ARCHITECTURE.md` (`src/components/documents/`, `src/lib/scope-access.ts`)

- [ ] **Step 1: Write a failing test:** a search for a word in a lead document's name returns a hit with href `/intake/${leadId}/documents/${docId}` and context `Intake · Test Lead`.
- [ ] **Step 2: Run** `npx vitest run src/lib/queries/search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full verification:** `npm run typecheck && npm run lint && npx vitest run && npm run check:migrations`. Expected: 0 type errors, 0 lint warnings, all tests pass, migrations match.
- [ ] **Step 5:** Write the docs listed above.
- [ ] **Step 6: Commit** `feat(search)+docs: intake documents (ADR-046)`.
- [ ] **Step 7: Ship gate (not automatic).** Apply the migration to the local dev DB (`npx prisma migrate deploy`). Then **stop and ask the user** to run the prod `migrate status` / `migrate deploy` commands before pushing (memory: ask before pushing anything that needs a manual production step).
