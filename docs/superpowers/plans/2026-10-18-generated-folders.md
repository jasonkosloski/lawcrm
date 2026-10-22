# Generated Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Folders created for records requests carry their source. They show a badge that links to the request or the Records tab, and they can't be renamed, moved or deleted. A folder containing a protected one can't be deleted either.

**Architecture:**

- Two new columns on `DocumentFolder`: `systemKind` and `recordsRequestId`.
- A migration with a SQL backfill marks folders that already exist.
- Records folder resolution switches from content inference to lookup by link.
- Enforcement lives in `src/app/actions/document-folders.ts`.
- The UI reads the new fields through the existing folder queries.

**Tech Stack:** Next.js App Router, Prisma 7 / Postgres, Vitest (integration tests on the Docker test DB).

**Spec:** `docs/superpowers/specs/2026-10-18-generated-folders-design.md` (approved, including "deleting a request unprotects its folders").

## Global Constraints

- `systemKind` values (exact): `records_root`, `records_request`, `records_request_docs`, `records_responsive_docs`. null means an ordinary folder. Any non-null value means protected.
- `DocumentFolder.recordsRequestId` → RecordsRequest, `onDelete: SetNull`, indexed. It is set on `records_request`, `records_request_docs` and `records_responsive_docs`.
- Investigation never gets a kind.
- Protected means no rename, move or delete. Files inside are unaffected, and moving an ordinary folder **into** a protected one is allowed.
- Error copy (exact):
  - Protected folder: "This folder is managed by its records request and can't be renamed, moved or deleted."
  - Ancestor of a protected folder: "This folder contains folders managed by records requests, so it can't be deleted."
- Badges:
  - `records_request*`: clipboard icon + "Records request", linking to `${scopeBasePath(scope)}/records/${recordsRequestId}`, with the request subject as the title attribute.
  - `records_root`: "Records requests", linking to `${scopeBasePath(scope)}/records`.
- Migration: `prisma/migrations/20261018200000_generated_folders/`. The backfill SQL sits between the lines `-- BACKFILL BEGIN` and `-- BACKFILL END`.
- No new permission keys.
- Every test or commit command exports `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, proceed"` (local Docker test DB only). Run no prisma command against any other database.
- Commit on `main` with explicit pathspecs. Other sessions share this checkout, so never `git add -A` and never leave files staged. Never push.

## Review Focus

1. **A legacy request folder a user renamed before this change.** After the backfill it is still found by link, and no duplicate folder is created. Test in Task 2.
2. **Deleting a request.** Its folders become ordinary: the kind is cleared and the link nulled. Files stay, and the user can then delete the folders. Test in Task 2.
3. **Lead conversion.** Protected folders keep their kind and link on the matter, and are still protected there. Test in Task 3.
4. **Deleting Investigation (or any ancestor) whose protected folder is two levels down.** Refused. Test in Task 3.
5. **Backfill on folders with no tagged documents.** They stay unmarked; the backfill doesn't guess. It also runs cleanly on an empty database and twice in a row. Test in Task 1.

---

### Task 1: Schema, migration with backfill, folder-kind constants

**Files:**

- Modify: `prisma/schema.prisma` (`DocumentFolder`, plus the inverse relation on `RecordsRequest`)
- Create: `prisma/migrations/20261018200000_generated_folders/migration.sql`
- Create: `src/lib/records-requests/folder-kinds.ts` + `folder-kinds.test.ts`
- Create: `src/lib/records-requests/folder-backfill.test.ts`
- Modify: `docs/SCHEMA_NOTES.md` (or whichever schema-notes file the docs index lists now; check `docs/README.md`)

**Interfaces:**

- Produces in `folder-kinds.ts`:
  - `FOLDER_SYSTEM_KINDS` (tuple) and `type FolderSystemKind`
  - `isProtectedFolder(f: { systemKind: string | null }): boolean`
  - `folderSourceLink(f: { systemKind: string | null; recordsRequestId: string | null }, scope: RecordScope): { href: string; label: string } | null`
  - `kindForRole(role: "request_letter" | "received_records"): FolderSystemKind`, mapping to `records_request_docs` / `records_responsive_docs`
- Produces in the schema: `DocumentFolder.systemKind String?`, `DocumentFolder.recordsRequestId String?` + relation, and `@@index([recordsRequestId])`.

**Backfill rules (from the spec):**

- A folder named "Records Requests" directly under a root "Investigation" folder, in the same scope (both case-insensitive), gets `records_root`.
- Each of its child folders gets `records_request`, linked to the request owning the most documents tagged inside it or its direct subfolders. Ties go to the earliest request by `createdAt`. A child with no tagged documents is left alone.
- A marked request folder's children named "Request documents" or "Responsive documents" get the matching kind and the same link.
- Write the backfill with `UPDATE … WHERE "systemKind" IS NULL` so it is idempotent.

- [ ] **Step 1: Write the failing tests.**
  - `folder-kinds.test.ts`: `isProtectedFolder` returns true for each kind and false for null. `folderSourceLink` for `records_request` on matter m1 with request r1 gives `{ href: "/matters/m1/records/r1", label: "Records request" }`. `records_root` on lead l1 gives `{ href: "/intake/l1/records", label: "Records requests" }`. Null gives null.
  - `folder-backfill.test.ts`: read the migration file, slice the text between the BACKFILL markers, and run it with `prisma.$executeRawUnsafe` (split on `;\n`). Seed the pre-change shape: Investigation / Records Requests / "Memorial Hospital — CORA" (holding 1 document tagged r1) / Request documents + Responsive documents. Also seed an untagged sibling request folder and an unrelated root "Records Requests" that isn't under Investigation. Assert:
    - the kinds and links on the five folders
    - the untagged sibling and the unrelated root stay null
    - running the backfill a second time changes nothing
    - it succeeds on an empty database
- [ ] **Step 2:** Run `npx vitest run src/lib/records-requests/folder-kinds.test.ts src/lib/records-requests/folder-backfill.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Schema change and migration. Generate the DDL with `prisma migrate diff --from-schema <old copy> --to-schema prisma/schema.prisma --script`, then append the backfill between the markers. Implement `folder-kinds.ts`. Run `npx prisma generate`.
- [ ] **Step 4:** Run the same tests, then `npm run typecheck && npm run check:migrations`. Expected: PASS, and "migrations match schema.prisma".
- [ ] **Step 5:** Add the schema notes entry.
- [ ] **Step 6: Commit** `feat(folders): systemKind + recordsRequestId on DocumentFolder, with backfill`.

### Task 2: Records folder resolution by link; request delete unprotects

**Files:**

- Modify: `src/lib/records-requests/folder.ts` (`resolveRecordsFolder`, `resolveRecordsRoleFolder`, `resolveRecordsRoot`, legacy adoption, `resolveRecordsUpload` if it infers ownership)
- Modify: `src/lib/records-requests/folder.test.ts`
- Modify: `src/app/actions/records-requests.ts` (`deleteRecordsRequest`) + its test

**Interfaces:**

- Consumes: Task 1's `kindForRole` and the new columns.
- Produces: unchanged signatures. Behaviour changes:
  - `resolveRecordsFolder` returns `documentFolder.findFirst({ where: { recordsRequestId: request.id, systemKind: "records_request" } })` when one exists. Otherwise it creates one under Records Requests, using today's name builder with collision suffixing and `systemKind`/`recordsRequestId` set.
  - The Records Requests folder is found by `{ parentId: investigationId, systemKind: "records_root" }` first, then by name. When found by name, it is stamped `records_root`. When created, it is stamped too. The legacy root "Records" adoption also sets `records_root`.
  - `resolveRecordsRoleFolder` finds the child by `{ parentId: requestFolder, systemKind: kindForRole(role) }` or creates it with that kind and link.
  - Remove the content-based ownership inference. Keep the one-time flat-file tidy.
  - `deleteRecordsRequest` runs `documentFolder.updateMany({ where: { recordsRequestId: id }, data: { systemKind: null, recordsRequestId: null } })` in its transaction, before the delete.

- [ ] **Step 1: Write the failing tests** in `folder.test.ts`:
  - Created folders carry kinds: the request folder is `records_request` linked to r1, the subfolders carry their role kinds, and Records Requests is `records_root`.
  - **(Review Focus 1)** A request folder already linked to r1 but renamed "Old name" is returned as is, and no new folder is created.
  - Two requests with the same custodian and type get "… (2)" for the second, each linked to its own request.
  - An existing root "Records Requests" folder found by name gets stamped `records_root`.
- [ ] **Step 2: Write the failing test** in `records-requests.test.ts`: **(Review Focus 2)** after `deleteRecordsRequest`, the folders that were linked to it have `systemKind` null and `recordsRequestId` null, and their documents still exist.
- [ ] **Step 3:** Run both files. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run both, plus `npx vitest run src/app/api/documents src/app/actions/document-templates.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(records): folders are found by their request link; deleting a request unprotects them`.

### Task 3: Server enforcement in folder actions

**Files:**

- Modify: `src/app/actions/document-folders.ts` (`renameFolder`, `moveFolder`, `deleteFolder`) + `document-folders.test.ts`
- Modify: `src/app/actions/leads.test.ts` (one conversion assertion)

**Interfaces:**

- Consumes: Task 1's `isProtectedFolder`.
- Produces: `renameFolder`, `moveFolder` and `deleteFolder` return `{ ok: false, error: <exact copy> }` as described in Global Constraints. The descendant check walks the scope's folders already loaded by `fetchScopeFolders`; use `collectDescendantIds` from `src/lib/folder-tree.ts` with the new field selected. Moving an ordinary folder into a protected one stays allowed.

- [ ] **Step 1: Write the failing tests:**
  - Rename, move and delete are each refused for every protected kind, with the exact message, and the row is unchanged.
  - **(Review Focus 4)** Deleting Investigation, which holds Records Requests / request folder, is refused with the ancestor message. Deleting an ordinary folder whose only descendants are ordinary still works.
  - Moving an ordinary folder into a protected request folder succeeds.
  - **(Review Focus 3, leads.test.ts)** Converting a lead whose request folder is protected leaves it with the same kind and link on the matter, and `renameFolder` on it is refused.
- [ ] **Step 2:** Run `npx vitest run src/app/actions/document-folders.test.ts src/app/actions/leads.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Select `systemKind` in the folder reads these actions already do.
- [ ] **Step 4:** Run the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(folders): generated folders can't be renamed, moved or deleted`.

### Task 4: UI badges and menus, docs

**Files:**

- Modify: `src/lib/queries/matter-detail.ts` (`getDocumentFolders`: also select `systemKind`, `recordsRequestId`, and `recordsRequest: { select: { subject: true } }`) and its return type
- Modify: `src/lib/folder-tree.ts` (`FolderRecord` gets optional `systemKind?: string | null; recordsRequestId?: string | null; sourceTitle?: string | null` carried into `FolderNode`)
- Modify: `src/components/matters/documents/folder-tree.tsx`, `src/components/documents/documents-browser.tsx` (subfolder rows), `src/components/documents-viewer/document-file-tree.tsx`, `src/components/matters/documents/folder-row-actions.tsx`
- Create: `src/components/documents/folder-source-badge.tsx` + test
- Modify: tests beside the touched components
- Docs: an ADR (generated folders carry their source; protection rules) in the decisions folder the docs index uses; the records-requests feature doc; a UI_PATTERNS note on the generated-folder badge

**Interfaces:**

- Consumes: Task 1's `folderSourceLink` and `isProtectedFolder`.
- Produces:
  - `FolderSourceBadge({ folder, scope }: { folder: { systemKind: string | null; recordsRequestId: string | null; sourceTitle?: string | null }; scope: RecordScope })` renders null for an ordinary folder. Otherwise it renders a small chip `<Link>` (clipboard icon + label from `folderSourceLink`) with `title` = sourceTitle.
  - `FolderRowActions` gets `isProtected: boolean` and `hasProtectedDescendant: boolean`. When `isProtected`, it hides rename, move and delete. When `hasProtectedDescendant`, it hides delete. The browser computes both from the folder list.

- [ ] **Step 1: Write the failing tests:**
  - Badge: the `records_request` folder links to `/matters/m1/records/r1` with text "Records request" and title = subject; `records_root` links to `/matters/m1/records`; an ordinary folder renders nothing.
  - Row actions: protected shows no Rename, Move or Delete items; an ancestor shows no Delete but still shows Rename.
  - Browser: the subfolder row for a protected folder renders the badge.
- [ ] **Step 2:** Run `npx vitest run src/components/documents src/components/matters/documents src/components/documents-viewer`. Expected: FAIL.
- [ ] **Step 3:** Implement and write the docs.
- [ ] **Step 4:** Run `npm run typecheck && npm run lint && npx vitest run && npm run check:migrations`. Expected: all green.
- [ ] **Step 5: Commit** `feat(folders): source badge and protected-folder menus; docs`.
- [ ] **Step 6: Ship gate (controller and user):** apply the migration to the local dev DB, then ask the user to run prod `migrate status` / `migrate deploy` before pushing.
