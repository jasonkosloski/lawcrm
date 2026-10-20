# Matter drafts + originating document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save-and-resume matter drafts that hold intake files, a per-matter agreement record, and an Admin switch that refuses to open a matter (create or lead conversion) without a signed originating document.

**Architecture:** New `MatterDraft` / `MatterDraftFile` / `MatterAgreement` tables. Draft files are not Documents until Create re-homes them into an "Engagement" folder (the matter/lead scope invariant is untouched). Uploads gain a third, exclusive `draftId` target. Gate rules live in one pure module shared by forms and actions; the server reads the switch and labels from the DB.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before routing/action work), Prisma/Postgres, Zod, Vitest + Testing Library, Vercel Blob client uploads, Vercel cron.

**Spec:** `docs/superpowers/specs/2026-10-20-matter-drafts-agreement-design.md`

## Global Constraints

- **Branch + worktree:** all work happens on branch `feat/matter-drafts` in a separate worktree (`../lawcrm-drafts`), created at execution start via superpowers:using-git-worktrees. Nothing merges to or pushes main until the user approves the migration and the production deploy (ADR-016). Other Claude sessions use the main checkout; never switch its branch.
- Tests need the Docker test DB (`lawcrm-test-postgres`, :5433). Run with `npx vitest run <paths>`.
- **DB safety:** `.env` points at a remote DB and `prisma.config.ts` prefers `DIRECT_DATABASE_URL`. Any `prisma` command that touches a DB sets BOTH `DIRECT_DATABASE_URL` and `DATABASE_URL` to `postgresql://lawcrm_test:lawcrm_test@localhost:5433/lawcrm_migrate`. Never `migrate reset`.
- Commits: explicit pathspec, never leave files staged, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The pre-commit hook must pass.
- Mutations are server actions: permission-gated, logged, `revalidatePath`. Route handlers only for uploads and the cron (sanctioned exceptions).
- Matter scope via `assertMatterAccess`; lead scope via `assertLeadAccess`; draft scope via the new `assertDraftAccess`. Never query a draft, matter or lead by id alone.
- Date-only values: `parseDateOnly` / `dateOnlyKey`; "today" is the user's profile-zone day (`todayDateOnly` in `src/app/actions/billing/helpers.ts`).
- Document bytes never go through server actions (ADR-034).
- Verbatim values: statuses `not_sent | sent | signed`; label fallback `Fee agreement`; folder name `Engagement`; categories `contract` (originating) / `intake` (others); draft limits 50 MB per file, 20 files per draft; sweep after 90 days, warn at ≤ 14 days; cron `0 6 * * *`; permission key `matters.agreement.edit`.
- Verbatim copy: stale save `Someone else saved this draft. Reload to see their changes.`; used draft `This draft was already used to open a matter.`; gate errors `Attach the signed {label}.` / `Mark the {label} as signed.` / `Enter the date it was signed.` / `The signed date can't be in the future.`; log titles `Matter draft started`, `Matter draft deleted`, `File attached to a matter draft`, `File removed from a matter draft`.

## Review Focus

1. **A teammate deletes the draft, or opens a matter from it, while another user has it open.** Expected: the other user's next auto-save gets `notfound` and the form shows "This draft no longer exists" instead of silently creating a new draft; Create gets the used-draft message and creates nothing. Tests in Task 2 and Task 8.
2. **Auto-save fires while Create is in flight.** Expected: auto-save is paused from submit until the result, and a save after a successful claim can't resurrect the draft (`saveMatterDraft` with an id never creates). Tests in Task 2 and Task 8.
3. **Switch on, but the user lacks `documents.upload`.** Expected: the Engagement section says `You need permission to upload documents to attach the {label}.` instead of offering a dead upload button, and Create shows the gate error. Test in Task 8.
4. **Signed date "today" late in the evening, US zone.** Expected: accepted. "Future" compares with the user's profile-zone today, not UTC. Test in Task 4.
5. **Practice area changed after files are attached.** Expected: the section title switches to the new area's label; the originating mark and files stay. Test in Task 8.

---

### Task 1: Schema, migration, permission key, gate rules lib

**Files:**
- Modify: `prisma/schema.prisma` (models per spec; `Matter.agreement MatterAgreement?`, `Document.agreement MatterAgreement?` back-relations; `PracticeArea.originatingDocLabel String?`; `Firm.requireOriginatingDoc Boolean @default(false)`)
- Create: migration `<ts>_matter_drafts_and_agreements` (+ grant SQL), `src/lib/originating-doc.ts`, `src/lib/originating-doc.test.ts`
- Modify: `src/lib/permissions.ts` (+ test), `src/test/integration-helpers.ts` (`matter_draft_files`, `matter_drafts`, `matter_agreements` in `TABLES_IN_DELETE_ORDER`, children before parents; agreements before documents and matters)

**Interfaces:**
- Produces Prisma models exactly as in the spec.
- `src/lib/originating-doc.ts` (pure):
  - `AGREEMENT_STATUSES = ["not_sent","sent","signed"] as const`, `type AgreementStatus`
  - `originatingDocLabel(area: { originatingDocLabel: string | null } | null): string` (blank/null → `"Fee agreement"`)
  - `type AgreementInput = { status: string; signedDate: string; hasOriginatingFile: boolean }`
  - `agreementGateErrors(input: AgreementInput, opts: { required: boolean; label: string; today: string /* YYYY-MM-DD */ }): Partial<Record<"originatingFileId" | "agreementStatus" | "agreementSignedDate", string>>`. Not required → only a malformed or future date errors.

- [ ] **Step 1:** Failing tests. `permissions.test.ts`: `matters.agreement.edit` is catalogued. `originating-doc.test.ts`: label fallback for null, `""` and `"  "`; required + nothing → all three errors with the label substituted; `signedDate` `"2026-10-21"` with today `"2026-10-20"` → future error; equal to today → no error; not required + empty → `{}`; unknown status → `agreementStatus` error. Run → FAIL.
- [ ] **Step 2:** Implement the lib and the permission (category `matters`, label "Edit fee agreement record", description "Change a matter's originating-document record: status, signed date and linked document.").
- [ ] **Step 3:** Schema edit; `DIRECT_DATABASE_URL=… DATABASE_URL=… npx prisma migrate dev --name matter_drafts_and_agreements` (scratch DB per Global Constraints; confirm `localhost:5433` is printed). Append:

```sql
-- Grant matters.agreement.edit to every role that can edit matters.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'matters.agreement.edit' FROM "role_permissions"
WHERE "permission" = 'matters.edit'
ON CONFLICT ("roleId", "permission") DO NOTHING;
```

  Re-apply on a fresh scratch DB with `migrate deploy`; `npm run check:migrations` passes.
- [ ] **Step 4:** Tests pass; `npm run typecheck`. Commit on the branch: `feat(matters): draft, draft-file and agreement tables; originating-doc rules`.

### Task 2: Draft access + draft actions

**Files:**
- Create: `src/lib/draft-access.ts` (+ `.test.ts`), `src/app/actions/matter-drafts.ts` (+ `.test.ts`), `src/lib/queries/matter-drafts.ts`
- Modify: `src/lib/storage*` only if no delete-by-url helper exists (find the one `deleteDocument` uses and reuse it)

**Interfaces:**
- `draftAccessWhere(userId: string, isAdmin: boolean): Prisma.MatterDraftWhereInput`
- `canAccessDraft(userId: string, draftId: string): Promise<boolean>` (route-handler friendly). True iff the draft exists AND (Admin OR ((creator OR lead OR in team) AND the user holds `matters.create`)).
- `assertDraftAccess(draftId: string): Promise<MatterDraft>`: `notFound()` on miss.
- `type DraftValues = Record<string, string | string[]>`
- `saveMatterDraft(draftId: string | null, expectedUpdatedAt: string | null, values: DraftValues): Promise<{ ok: true; draftId: string; updatedAt: string } | { ok: false; code: "stale" | "notfound" }>`. Null id creates (logs `Matter draft started`). With an id it NEVER creates: missing → `notfound`; `updatedAt` mismatch → `stale`. The update is a conditional `updateMany({ id, updatedAt })`. Copies `leadUserId` and `extraTeam` (JSON array of `{userId}` as the form posts it; read the existing `resolveExtraTeam` input shape in `matters.ts`) into the columns.
- `deleteMatterDraft(id: string): Promise<{ ok: true } | { ok: false; error: string }>`: creator or Admin only (others → "Only the person who started this draft can delete it."); deletes rows, then deletes stored files after commit.
- `setDraftFileOriginating(fileId: string): Promise<{ ok: boolean }>`: in one transaction, clears the others in the draft and sets this one.
- `removeDraftFile(fileId: string): Promise<{ ok: boolean }>`: row first, then the stored file.
- `listMatterDrafts(): Promise<{ id; clientLabel: string; practiceAreaName: string | null; updatedAt: Date; createdByName: string; canDelete: boolean; deletesInDays: number | null }[]>` in queries. `clientLabel` = `values.newClientName` or the picked contact's name or `"Untitled draft"`; `deletesInDays` set only when ≤ 14.

- [ ] **Step 1:** Failing tests: access matrix (creator, lead, team seat, Admin, outsider; a team seat without `matters.create` → denied); save create → update → stale; save with a deleted id → `notfound` and no new row (Review Focus 1 and 2); delete by a non-creator refused; delete removes files (mock the storage delete and assert it's called after the rows are gone); originating toggle keeps exactly one; log titles contain no client name. Run → FAIL.
- [ ] **Step 2:** Implement. Gate every action with `requirePermission("matters.create")` + `assertDraftAccess`; `revalidatePath("/matters/new")`.
- [ ] **Step 3:** Tests pass. Commit: `feat(matters): matter drafts with access rules and optimistic saves`.

### Task 3: Upload routes accept a draft target

**Files:**
- Modify: `src/app/api/documents/upload/route.ts`, `src/app/api/documents/upload/blob/blob-upload.ts`, `src/app/api/documents/upload/upload-config.ts`
- Test: `route.test.ts`, `blob/blob-upload.test.ts`

**Interfaces:**
- Form field / client payload `draftId`, exclusive with `matterId`/`leadId` (any combination → 400 `"Choose exactly one of a matter, a lead or a draft."`). `folderId` and `recordsRequestId` with `draftId` → 400.
- Auth: session + `documents.upload` + `canAccessDraft`. Denial → 404 (same as the matter/lead miss).
- Limits for draft targets: `DRAFT_MAX_FILE_BYTES = 50 * 1024 * 1024`, `DRAFT_MAX_FILES = 20` (existing rows + this batch) in `upload-config.ts`. Over → 400 with `"Draft files are limited to 50 MB each."` / `"A draft can hold up to 20 files."`.
- Writes `MatterDraftFile` rows; response `{ documents: [{ id, name }] }` (ids are draft-file ids).
- Blob: the token payload carries `draftId`. `onUploadCompleted` re-checks the draft exists; if not, deletes the blob and writes nothing.

- [ ] **Step 1:** Failing tests (both paths): happy path writes a draft-file row and no Document; exclusivity 400; no access → 404; no `documents.upload` → 403; over size / count → 400; blob completion after draft deletion → blob deleted, no row. Run → FAIL.
- [ ] **Step 2:** Implement, keeping matter/lead behavior byte-for-byte unchanged (existing tests must pass).
- [ ] **Step 3:** Commit: `feat(documents): uploads can target a matter draft`.

### Task 4: createMatter from a draft + gate + agreement

**Files:**
- Modify: `src/app/actions/matters.ts` (`createMatterSchema`, `createMatter`), `src/lib/new-matter-constants.ts` (state type if needed)
- Test: `src/app/actions/matters.test.ts`

**Interfaces:**
- New posted fields: `draftId`, `draftUpdatedAt`, `agreementStatus`, `agreementSignedDate`, `originatingFileId`.
- In order, after the existing required/venue checks and before the ADR-054 conflict gate:
  1. load firm `requireOriginatingDoc` and the area's `originatingDocLabel`;
  2. if `draftId`: `assertDraftAccess`, then load its files;
  3. `agreementGateErrors(...)` with `hasOriginatingFile` = (`originatingFileId` is one of THIS draft's files) and `today = dateOnlyKey(await todayDateOnly())`;
  4. switch on with no draft → `originatingFileId` error.
- Inside the existing create transaction, after the matter exists:
  - claim the draft with `tx.matterDraft.deleteMany({ where: { id: draftId, updatedAt: new Date(draftUpdatedAt) } })`. 0 rows → throw a UserFacingError with the used-draft message, which rolls back everything. Read the files BEFORE the claim (the cascade deletes them).
  - create folder `Engagement` (match how `seedDocumentFolder` / the documents actions create folders: check required fields such as `parentId` null).
  - one `Document` per file (`matterId`, `folderId`, `name`, `fileUrl`, `contentType`, `fileSize`, `uploadedBy`, `source: "upload"`, `category` per Global Constraints).
  - `MatterAgreement` (`status`, `signedDate` parsed or null, `documentId` = the originating file's new Document id or null).
- Logging: the existing create log gains `{Label} signed YYYY-MM-DD` when signed and `Opened from a draft started by {name} on {YYYY-MM-DD}` when from a draft.
- No storage deletion anywhere in Create.

- [ ] **Step 1:** Failing tests:
  - from a draft → Engagement folder with N documents, agreement row, draft gone;
  - second Create with the same draft → used-draft error, still exactly one matter;
  - stale `draftUpdatedAt` → error, nothing created;
  - switch on: no draft / no file / not signed / no date / future date / file from another draft each refused with the verbatim error and no matter row;
  - switch on: signed today at `2026-10-20T23:30` America/Denver (profile zone) is accepted (Review Focus 4; mock the clock and zone the way existing tests do);
  - switch off: succeeds without a file and writes an agreement `not_sent`;
  - gate refusal returns no `conflict` (runs before the conflict gate).
  Run → FAIL.
- [ ] **Step 2:** Implement. All existing matters tests keep passing.
- [ ] **Step 3:** Commit: `feat(matters): open a matter from a draft; originating-document gate`.

### Task 5: Lead conversion gate

**Files:**
- Modify: `src/app/actions/leads.ts` (`convertSchema`, `convertLeadToMatter`)
- Test: `src/app/actions/leads.test.ts`

**Interfaces:**
- Posted: `agreementStatus`, `agreementSignedDate`, `originatingDocumentId` (a Document with `leadId = this lead`).
- Gate via `agreementGateErrors` (`hasOriginatingFile` = the document exists on this lead, not archived), checked before the existing conflict re-check. With the switch on and no document → `originatingFileId` error mapped to field `originatingDocumentId`.
- In the conversion transaction, after documents are re-homed: `MatterAgreement` with `documentId = originatingDocumentId` (same id; it moved with the lead). Log as in Task 4.

- [ ] **Step 1:** Failing tests: switch on refuses each missing piece; a document from another lead → error; switch off converts and writes `not_sent`; success writes the agreement pointing at the re-homed document (`document.matterId` = the new matter). Run → FAIL.
- [ ] **Step 2:** Implement. Commit: `feat(intake): lead conversion obeys the originating-document gate`.

### Task 6: Agreement edit, firm switch, area label actions

**Files:**
- Create: `src/app/actions/matter-agreement.ts` (+ test)
- Modify: `src/app/actions/firm.ts` (+ test), `src/app/actions/practice-areas.ts` (+ test)

**Interfaces:**
- `updateMatterAgreement(matterId: string, _prev: AgreementFormState, fd: FormData): Promise<AgreementFormState>`, fields `status`, `signedDate`, `documentId`. Gated `matters.agreement.edit` + `assertMatterAccess`. `documentId` must belong to the matter. With the switch on, the result must pass `agreementGateErrors(required: true)`. Upserts; logs old → new on the matter (`type: "document"`). `AgreementFormState = { status: "idle" | "ok" | "error"; errors?: Record<string, string[]> }`.
- `setRequireOriginatingDoc(on: boolean): Promise<{ ok: true }>`: `requireAdmin()`, logged firm-level (follow `updateMatterVisibilityAction` in `src/app/actions/matter-visibility.ts`).
- Practice-area create/update accept `originatingDocLabel` (trim, max 80, blank → null; omitted on update → unchanged); audit line `Originating document: "old" → "new"` (null shown as `Fee agreement (default)`).

- [ ] **Step 1:** Failing tests for each, including: switch on + clearing signed → error; document from another matter → error; non-Admin `setRequireOriginatingDoc` refused. Run → FAIL.
- [ ] **Step 2:** Implement. Commit: `feat(matters): agreement edit, firm originating-document switch, area label`.

### Task 7: Draft sweep cron

**Files:**
- Create: `src/app/api/matter-draft-sweep/route.ts` (+ `route.test.ts`)
- Modify: `vercel.json` (add `{ "path": "/api/matter-draft-sweep", "schedule": "0 6 * * *" }`)

**Interfaces:** `GET` authorized by `isAuthorizedCron(request)` (401 otherwise). Deletes drafts with `updatedAt < now − 90 days` in batches of 100, rows first, then each draft's files; a file-delete failure is `console.error`'d and skipped. Returns `{ deleted: number }`. Pattern: `src/app/api/notification-sweep/route.ts`.

- [ ] **Step 1:** Failing tests: no/wrong secret → 401; deletes a 91-day draft and its files, keeps an 89-day one; a storage failure doesn't abort the rest. Run → FAIL.
- [ ] **Step 2:** Implement. Commit: `feat(matters): daily sweep of stale matter drafts`.

### Task 8: /matters/new: drafts list, save/auto-save, Engagement section

**Files:**
- Modify: `src/app/(dashboard)/matters/new/page.tsx` (+ test), `src/components/matters/new-matter-form.tsx` (+ tests)
- Create: `src/components/matters/matter-drafts-list.tsx`, `src/components/matters/engagement-section.tsx`, `src/components/matters/use-draft-autosave.ts` (+ tests for each)
- Modify: `src/components/matters/documents/multi-file-upload.tsx` (accept a `{ kind: "draft"; draftId }` scope; append `draftId`)

**Interfaces:**
- Page: reads `searchParams.draft` (Next.js async searchParams; check the docs), `assertDraftAccess` when present, passes `draft: { id, updatedAt: string, values, files: { id, name, isOriginating }[] } | null`, `drafts: listMatterDrafts()`, `requireOriginatingDoc`, `canUpload: currentUserHasPermission("documents.upload")`, and each area's `originatingDocLabel`.
- `useDraftAutosave({ draftId, updatedAt, getValues, paused }): { status: "idle" | "saving" | "saved" | "stale" | "gone"; savedAt: Date | null; saveNow(): Promise<string | null /* draftId */> }`. Saves every 30 s only when the values' JSON changed; `paused` while submitting (Review Focus 2); `notfound` → status `gone` (shows "This draft no longer exists"); `stale` → stops auto-saving and shows the stale copy.
- "Save draft" button → `saveNow()`; on the first save `router.replace("/matters/new?draft=<id>")`.
- `EngagementSection({ label, required, canUpload, draftId, ensureDraft: () => Promise<string>, files, status, signedDate, originatingFileId, onChange })`. Uploading with no draft calls `ensureDraft()` first. Posts hidden `draftId`, `draftUpdatedAt`, `agreementStatus`, `agreementSignedDate`, `originatingFileId`. No `documents.upload` → the Review Focus 3 copy.
- `MatterDraftsList({ drafts })`: Resume links; Delete (when `canDelete`) calls `deleteMatterDraft` with a confirm step that is NOT a browser `confirm()` (use the app's dialog component); "Deletes in N days".
- Client gate check: `agreementGateErrors` with `today` from the user's zone (passed by the page as `todayKey`).

- [ ] **Step 1:** Failing tests: Save draft creates and replaces the URL; auto-save only when changed; stale and gone copy; auto-save paused during submit; Engagement required markers with the switch on; no-upload-permission copy; area change switches the label and keeps the files and mark (Review Focus 5); drafts list resume/delete/expiry note; a submit with a gate error shows field errors without calling the action. Run → FAIL.
- [ ] **Step 2:** Implement. Keep the existing form tests passing.
- [ ] **Step 3:** Commit: `feat(matters): save and resume drafts; engagement section on /matters/new`.

### Task 9: Lead conversion dialog

**Files:** Modify `src/components/intake/convert-lead-button.tsx` (+ test) and the lead page that renders it (pass the lead's documents, the switch, the area labels, `todayKey`).

**Interfaces:** Engagement block: status, signed date, a select of the lead's non-archived documents labelled "This is the {label}" (empty option "None"). Posts `agreementStatus`, `agreementSignedDate`, `originatingDocumentId`. Required markers and a client-side `agreementGateErrors` check with the switch on; the label follows the picked area.

- [ ] **Step 1:** Failing tests: block renders with the area label; required with the switch on; posts the fields; label switches with area. → FAIL. **Step 2:** Implement. Commit: `feat(intake): engagement block on lead conversion`.

### Task 10: Overview card, firm switch card, area label field

**Files:**
- Create: `src/components/matters/agreement-card.tsx` (+ test), `src/components/settings/originating-doc-card.tsx` (+ test)
- Modify: `src/app/(dashboard)/matters/[id]/page.tsx` (+ test), `src/app/(dashboard)/settings/firm/page.tsx`, `src/components/settings/practice-area-form-parts.tsx` + the create/edit area forms (+ tests)

**Interfaces:**
- `AgreementCard({ matterId, label, agreement: { status, signedDate: string | null, document: { id, name } | null } | null, documents: { id, name }[], canEdit, required })`. Read view: `{label}: Signed 2026-10-12 · View document` (link to the document viewer route the Documents tab uses) or `No {label} on file`. Edit form posts to `updateMatterAgreement`. Page loads the agreement with the matter (through the existing access-checked load) and the matter's documents for the picker only when `canEdit`.
- `OriginatingDocCard({ current, missingCount })`: Admin-only toggle (page renders it only for Admins, like `MatterVisibilityCard`); copy explains it applies to new matters only; shows `missingCount` open (non-archived, non-terminal-stage) matters without a signed agreement.
- Practice-area forms: "Originating document" text field, placeholder `Fee agreement`.

- [ ] **Step 1:** Failing tests for each component and the page wiring. → FAIL. **Step 2:** Implement. Commit: `feat(matters): agreement card; firm switch and area label settings`.

### Task 11: Docs and full suite

**Files:** `docs/decisions/056-drafts-hold-intake-files-firm-can-require-originating-document.md` + README row; `docs/features/matters.md`, `docs/features/intake.md`, `docs/features/settings-admin.md`, `docs/ROADMAP.md`, `docs/DEPLOY_BACKFILLS.md` (migration + cron entry; `CRON_SECRET` already required), `docs/SCHEMA_NOTES.md`.

- [ ] **Step 1:** Write the docs (end state, lean, per AGENTS.md). ROADMAP `/matters/new v2` line: mark drafts and the originating-document gate shipped; remaining items stay in the feature file.
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm test` → all pass.
- [ ] **Step 3:** Commit the docs on the branch.
- [ ] **Step 4 (after the final review, with user approval):** delete this spec and plan in one commit; fast-forward main to the branch; push. Then tell the user the production steps: run `prisma migrate deploy` for **both** pending migrations (venues from sub-project 1, if not yet run, and this one) per `docs/DEPLOY_BACKFILLS.md`, BEFORE or together with the deploy that carries this code.
