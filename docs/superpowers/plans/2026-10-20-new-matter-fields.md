# /matters/new v2 sub-project 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Venues as a firm list, a configurable matter-name template, filed/trial date pickers, per-practice-area required fields, and a mobile-usable new-matter form.

**Architecture:** One migration adds `Venue`, `Matter.venueId`, the firm/area name templates and `PracticeArea.requiredMatterFields`. Two pure libs (template renderer, required-field rules) are shared by the forms, settings and server actions. Venue CRUD gets its own action file; matter create/update and the practice-area/firm settings actions are extended.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before touching routing/actions), Prisma/Postgres, Zod, Vitest + Testing Library, shadcn `command`/`popover` primitives in `src/components/ui`.

**Spec:** `docs/superpowers/specs/2026-10-20-new-matter-fields-design.md`

## Global Constraints

- Tests need the Docker test DB: `docker compose -f docker-compose.test.yml up -d` (Postgres on :5433). Run a file with `npx vitest run <path>`.
- Commit in one step with an explicit pathspec; `git add` only new files you created, then `git commit -m "…" -- <paths>`. Never leave files staged; never commit files you didn't touch. End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Mutations are server actions: permission-gated (`requirePermission`), logged (`logActivity` / `logActivityTx`), `revalidatePath`. No API routes.
- Every page authenticates itself (`requireUser` / `requirePermission`); never wrap guards in try/catch.
- Matter writes keep `assertMatterAccess(matterId)` (ADR-039).
- Date-only values are UTC-midnight: parse with `parseDateOnly`, compare/log with `dateOnlyKey` (`src/lib/format-date.ts`).
- Default firm template, verbatim: `{client_last}, {client_first} - {case_number} - {location}`.
- Tokens, verbatim: `client_first`, `client_last`, `client_full`, `case_number`, `location`, `county`, `state`, `opposing_party`, `practice_area`, `year`.
- Required-field keys, verbatim: `venue`, `caseNumber`, `court`, `filedDate`, `trialDate`, `incidentDate`, `opposingParty`, `opposingFirm`, `description`, `client`.
- Permission keys: `venues.add`, `venues.edit`, `venues.delete` (new category `venues`, label "Venues").
- Copy, verbatim: combobox add row `Press Enter to add "X"`; no-permission row `No venue matches. Ask an admin to add it.`; required hint `Required for {area}`.

## Review Focus

1. **Inline add of a name that matches an archived venue** — `nameKey` is unique across archived rows, so a plain P2002 → "exists" would select an archived venue. Expected: `createVenue` returns `{ ok: false, code: "archived" }` and the combobox says the venue is archived and must be restored in Settings → Venues. Test in Task 4 and Task 7.
2. **Template whose tokens are all empty** (e.g. `State v. {client_last}` before a client is picked) — expected: renders `""`, not a dangling `State v.`, so the name field shows the required error instead of saving junk. Test in Task 2.
3. **Typed-but-unpicked venue text** — a user without `venues.add` types "Auroa" and submits. Expected: nothing is stored for location (only `venueId` posts), and if `venue` is required the submit errors. Test in Task 7.
4. **Edit of a matter whose current venue is archived, with `venue` required** — expected: saving unchanged succeeds; switching to another archived venue fails. Test in Task 6.
5. **`{year}` around New Year** — expected: year is the creation date in the user's profile zone (ADR-012), not UTC. Test in Task 2 via an explicit `now`/`timeZone` input.

---

### Task 1: Schema, migration, permission keys

**Files:**
- Modify: `prisma/schema.prisma` (new `Venue`; `Matter.venueId` + relation + `@@index([venueId])`; `Firm.matterNameTemplate`; `PracticeArea.matterNameTemplate`, `PracticeArea.requiredMatterFields`)
- Create: `prisma/migrations/<ts>_venues_and_matter_name_template/migration.sql` (generated) and append the grant SQL below
- Modify: `src/lib/permissions.ts` (new `venues` category)
- Test: `src/lib/permissions.test.ts`

**Interfaces:**
- Produces: Prisma `Venue { id, name, nameKey @unique, city?, county?, state, isActive, createdAt, updatedAt, matters }` mapped `venues`; `Matter.venueId String?` (`onDelete: Restrict`); `Firm.matterNameTemplate String @default("{client_last}, {client_first} - {case_number} - {location}")`; `PracticeArea.matterNameTemplate String?`; `PracticeArea.requiredMatterFields String[] @default([])`.

- [ ] **Step 1:** Add to `permissions.test.ts`: `test("venue keys are catalogued", () => { for (const k of ["venues.add","venues.edit","venues.delete"]) expect(isKnownPermission(k)).toBe(true) })`. Run `npx vitest run src/lib/permissions.test.ts` → FAIL.
- [ ] **Step 2:** Add the `venues` category (place after `firm`) with the three keys; descriptions: add = "Add venues in Settings → Venues, or inline from the matter form by pressing Enter on a new name."; edit = "Rename venues and change their city, county and state; archive and restore them."; delete = "Delete a venue no matter uses." Run the test → PASS.
- [ ] **Step 3:** Edit `schema.prisma` per Interfaces (doc comments: `nameKey` = "lower(trim(name)); case-insensitive uniqueness, includes archived rows"). Run `npx prisma migrate dev --name venues_and_matter_name_template` (check `printenv | grep -i database` first: the shell may export a remote URL; it must point at local dev).
- [ ] **Step 4:** Append to the generated `migration.sql` (data only, idempotent, mirrors `20261018210000_grant_contacts_export`):

```sql
-- Grant venues.add to every role that can create matters, so intake can
-- add a venue inline. Admins bypass the matrix.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'venues.add' FROM "role_permissions"
WHERE "permission" = 'matters.create'
ON CONFLICT ("roleId", "permission") DO NOTHING;
```

Then `npx prisma migrate reset --force` against local dev only if the edited migration needs re-applying, and `npm run check:migrations` → passes.
- [ ] **Step 5:** `npm run typecheck` → passes. Commit `prisma/schema.prisma`, the migration dir, `src/lib/permissions.ts`, `src/lib/permissions.test.ts`: `feat(matters): Venue model, name-template columns, venue permission keys`.

### Task 2: Template renderer

**Files:**
- Create: `src/lib/matter-name-template.ts`, `src/lib/matter-name-template.test.ts`
- Modify: `src/lib/matter-name.ts` (delete `buildAutoMatterName`, `autoMatterName`; keep `splitName`, `looksLikeOrganization`, `NameParts`), and its test file (move the old cases into the new test, see Step 1)

**Interfaces:**
- Produces:
  - `MATTER_NAME_TOKENS: readonly ["client_first", …, "year"]`, `type MatterNameToken`
  - `DEFAULT_MATTER_NAME_TEMPLATE: string` (the verbatim default)
  - `parseTemplate(t: string): { ok: true; segments: Segment[] } | { ok: false; error: string }` where `Segment = { kind: "literal"; text: string } | { kind: "token"; token: MatterNameToken }`
  - `type MatterNameInput = { clientName: string; isOrganization?: boolean; caseNumber: string; venue: { name: string; county: string | null; state: string } | null; opposingParty: string; practiceAreaName: string; now: Date; timeZone: string }`
  - `tokenValues(input: MatterNameInput): Record<MatterNameToken, string>`
  - `renderMatterName(template: string, input: MatterNameInput): string` (invalid template → `""`)
  - `effectiveTemplate(area: { matterNameTemplate: string | null } | null, firmTemplate: string): string`

- [ ] **Step 1: Failing tests** in `matter-name-template.test.ts`:
  - Every old `buildAutoMatterName`/`autoMatterName` case from `matter-name.test.ts`, re-expressed through `renderMatterName(DEFAULT_MATTER_NAME_TEMPLATE, …)` with identical expected strings (e.g. `"Alvarez, Maria - 2026-CV-00481 - Aurora"`, `"Alvarez, Maria - Aurora"` with no case number, org names uninverted, `"Alvarez, Maria Jr."` suffix).
  - `renderMatterName("{client_last} v. {opposing_party}", {…opposingParty:""})` → `"Alvarez"`.
  - `renderMatterName("State v. {client_last} - {case_number}", {clientName:"", caseNumber:""})` → `""` (Review Focus 2).
  - `renderMatterName("State v. {client_last} - {case_number}", {clientName:"Maria Alvarez", caseNumber:""})` → `"State v. Alvarez"`.
  - `{county}`/`{state}`/`{location}` come from `venue`; `venue: null` drops them.
  - `{year}`: `now = new Date("2026-01-01T03:00:00Z")`, `timeZone: "America/Denver"` → `"2025"` (Review Focus 5).
  - `parseTemplate("{foo}")` → error naming `foo`; `"{client_last"` → unbalanced error; `"no tokens"` → error.
  - `effectiveTemplate({matterNameTemplate:null}, F)` → `F`; with `"X {year}"` → `"X {year}"`.
  Run → FAIL (module missing).
- [ ] **Step 2: Implement.** Rendering rule (not determined by signatures):

```
segments = L0 T1 L1 T2 … Tn Ln   (literals may be "")
kept = tokens with non-empty trimmed value
if kept is empty → return ""
out = L0 + value(first kept)
for each later kept token Tj: out += L(j-1) + value(Tj)   // the literal directly before it
out += Ln only if Tn is kept
collapse runs of whitespace to one space; trim; strip a trailing/leading " -" or "," left over
```

  `client_*` via `splitName`/`isOrganization` exactly as old `autoMatterName`; `client_full` = trimmed client name. `year` via `Intl.DateTimeFormat("en-US",{timeZone, year:"numeric"})`.
- [ ] **Step 3:** Delete the two builders from `matter-name.ts` and their cases from `matter-name.test.ts`. Run `npx vitest run src/lib/matter-name-template.test.ts src/lib/matter-name.test.ts` → PASS. (`new-matter-form.tsx` still imports `autoMatterName`; Task 8 replaces that. Keep typecheck green by leaving a one-line `autoMatterName` wrapper over `renderMatterName(DEFAULT_MATTER_NAME_TEMPLATE, …)` until Task 8 deletes it.)
- [ ] **Step 4:** Commit the four files: `feat(matters): token template renderer for matter names`.

### Task 3: Required-field rules

**Files:**
- Create: `src/lib/matter-required-fields.ts`, `src/lib/matter-required-fields.test.ts`

**Interfaces:**
- Produces:
  - `REQUIRED_MATTER_FIELDS: readonly { key: RequiredMatterField; label: string }[]` (labels: Venue, Case number, Court, Filed date, Trial date, Incident date, Opposing party, Opposing firm, Summary, Client)
  - `type RequiredMatterField`, `isRequiredMatterField(k: string): k is RequiredMatterField`
  - `type RequiredFieldValues = Partial<Record<RequiredMatterField, string | null | undefined>>`
  - `missingRequired(required: readonly string[], values: RequiredFieldValues): RequiredMatterField[]` (create rule)
  - `clearedRequired(required: readonly string[], before: RequiredFieldValues, after: RequiredFieldValues): RequiredMatterField[]` (edit rule: non-empty before AND empty after)
  - `requiredFieldError = "Required for this practice area."`

- [ ] **Step 1: Failing tests:** `missingRequired(["caseNumber","venue"], {caseNumber:"  ", venue:"v1"})` → `["caseNumber"]`; unknown keys in `required` ignored; `clearedRequired(["court"], {court:"D. Colo"}, {court:""})` → `["court"]`; `clearedRequired(["court"], {court:null}, {court:""})` → `[]`. Run → FAIL.
- [ ] **Step 2:** Implement (whitespace-only counts as empty). Run → PASS.
- [ ] **Step 3:** Commit both files: `feat(matters): per-area required-field rules`.

### Task 4: Venue actions

**Files:**
- Create: `src/app/actions/venues.ts`, `src/app/actions/venues.test.ts`, `src/lib/queries/venues.ts`

**Interfaces:**
- Consumes: Task 1 schema and keys.
- Produces:
  - `type VenueOption = { id: string; name: string; city: string | null; county: string | null; state: string; isActive: boolean }`
  - `listVenues(opts: { activeOnly: boolean }): Promise<(VenueOption & { matterCount: number })[]>` in `src/lib/queries/venues.ts`, ordered by name
  - `type VenueInput = { name: string; city?: string; county?: string; state: string }`
  - `createVenue(input: VenueInput): Promise<{ ok: true; venue: VenueOption } | { ok: false; code: "exists"; venue: VenueOption } | { ok: false; code: "archived"; venue: VenueOption } | { ok: false; code: "invalid"; errors: Record<string, string[]> }>` gated `venues.add`
  - `updateVenue(id: string, input: VenueInput)` gated `venues.edit`, same result shape minus `archived`
  - `setVenueActive(id: string, active: boolean)` gated `venues.edit`
  - `deleteVenue(id: string): Promise<{ ok: true } | { ok: false; error: string }>` gated `venues.delete`; error when referenced: `"A matter uses this venue. Archive it instead."`
  - Validation: name 1–120 trimmed, state 1–60 trimmed required, city/county ≤ 80. `nameKey = name.trim().toLowerCase()`.
  - Each logs `logActivity` (type `"settings"`, matterId null, title e.g. `Venue "Aurora" added`) and `revalidatePath("/settings/venues")` + `revalidatePath("/matters/new")`.

- [ ] **Step 1: Failing tests** (pattern: `records-request-types.test.ts` — mock `next/cache` and `permission-check`, `resetDb`/`seedFirm`/`seedUser`): creates and logs, gated `venues.add`; `"aurora"` after `"Aurora"` → `code:"exists"` with the existing id; same after archiving → `code:"archived"` (Review Focus 1); blank state → `invalid`; update gated `venues.edit` and renaming onto another venue's name → `exists`; `deleteVenue` refused when a matter references it, succeeds otherwise; `setVenueActive(false)` hides it from `listVenues({activeOnly:true})`. Run → FAIL.
- [ ] **Step 2:** Implement. Detect duplicates by catching `Prisma.PrismaClientKnownRequestError` code `P2002` and then loading the row by `nameKey` (race-safe; don't pre-check only).
- [ ] **Step 3:** Run `npx vitest run src/app/actions/venues.test.ts` → PASS. Commit the three files: `feat(venues): venue actions and query`.

### Task 5: Settings actions accept template and required fields

**Files:**
- Modify: `src/app/actions/practice-areas.ts` (`createPracticeArea`, `updatePracticeArea`), `src/app/actions/firm.ts` (`firmSchema`, `updateFirmAction`)
- Test: `src/app/actions/practice-areas.test.ts`, `src/app/actions/firm.test.ts`

**Interfaces:**
- Consumes: `parseTemplate` (Task 2), `isRequiredMatterField` (Task 3).
- Produces: form fields `matterNameTemplate` (blank → null on areas; required on firm) and `requiredMatterFields` (multi-value FormData via `formData.getAll("requiredMatterFields")`). Template parse errors return under `errors.matterNameTemplate`; an unknown required key returns `errors.requiredMatterFields = ["Unknown field: x"]`.

- [ ] **Step 1: Failing tests:** area update stores `"State v. {client_last}"` and `["caseNumber","court"]`; blank template stores null; `"{nope}"` → field error, nothing written; `"bogus"` key → field error; firm update stores a template, blank firm template → error ("A default template is required."). Run → FAIL.
- [ ] **Step 2:** Implement; include old → new template in the existing activity-log title/diff the actions already write. Run both test files → PASS.
- [ ] **Step 3:** Commit the four files: `feat(settings): practice-area and firm matter-name template + required fields`.

### Task 6: createMatter / updateMatter

**Files:**
- Modify: `src/app/actions/matters.ts` (`createMatterSchema`, `updateMatterSchema`, `createMatter`, `updateMatter`, `resolveAreaAndStage` select)
- Test: `src/app/actions/matters.test.ts`

**Interfaces:**
- Consumes: Task 3 rules; Task 1 columns.
- Produces: both schemas gain `venueId`, `filedDate`, `trialDate` (`z.string().trim().optional().or(z.literal(""))`). `resolveAreaAndStage` also returns `requiredMatterFields: string[]`. Errors use field names matching form inputs: `venueId`, `caseNumber`, `court`, `filedDate`, `trialDate`, `incidentDate`, `opposingParty`, `opposingFirm`, `description`, `clientId` (map required key `venue`→`venueId`, `client`→`clientId`).

- [ ] **Step 1: Failing tests** (extend the existing `createMatter`/`updateMatter` describes; seed a venue and an area with `requiredMatterFields`):
  - create with area requiring `["caseNumber","filedDate","venue"]` and all blank → error on `caseNumber`, `filedDate`, `venueId`; no matter row.
  - create with unknown venue id → `venueId` error; archived venue → `venueId` error ("That venue is archived.").
  - create persists `venueId`, `filedDate`/`trialDate` as UTC midnight (`dateOnlyKey` equals the posted `YYYY-MM-DD`); malformed date → field error.
  - update: required `court` with value, posted blank → `court` error, nothing saved; required `court` already null, posted blank, other field changed → saves.
  - update: changing area to one requiring `caseNumber` while it's empty → saves (already empty).
  - update: current venue archived, posted unchanged with `venue` required → saves; posting a different archived venue → error (Review Focus 4).
  - update logs venue change as `Venue: Aurora → Denver` and date changes with `dateOnlyKey`.
  Run `npx vitest run src/app/actions/matters.test.ts` → new tests FAIL.
- [ ] **Step 2:** Implement in `createMatter` after `resolveAreaAndStage` succeeds and before the conflict gate (so a missing-field submit never asks for a conflict acknowledgement); in `updateMatter`, load the stored values (`venueId`, the string fields, the three dates, `clientId`) alongside the existing load and apply `clearedRequired`. Venue check: `prisma.venue.findUnique({ where: { id } , select: { isActive: true, name: true } })`.
- [ ] **Step 3:** Run the matters test file → all PASS (including the existing ADR-054 conflict tests). Commit both files: `feat(matters): venue, filed/trial dates and per-area required fields on create and edit`.

### Task 7: VenueCombobox

**Files:**
- Create: `src/components/matters/venue-combobox.tsx`, `src/components/matters/venue-combobox.test.tsx`

**Interfaces:**
- Consumes: `VenueOption`, `createVenue` (Task 4).
- Produces: `<VenueCombobox name="venueId" venues={VenueOption[]} value={string | null} onChange={(v: VenueOption | null) => void} canAdd={boolean} defaultState={string} error?={string} required?={boolean} />`. Renders a hidden `<input name={name} value={id ?? ""}>`; the visible text box never posts. Built on `src/components/ui/command.tsx` + `popover.tsx`. Archived venues are only shown when they are the current value, labelled `Name (archived)`.

- [ ] **Step 1: Failing tests:** typing "aur" lists "Aurora · Aurora, Arapahoe, CO"; with `canAdd` and no exact match shows `Press Enter to add "Auroa"`, Enter opens the popover with name prefilled and state = `defaultState`; Save calls `createVenue` and `onChange` receives the new venue; `code:"exists"` selects the returned venue; `code:"archived"` shows `"Auroa" is archived. Restore it in Settings → Venues.`; without `canAdd` shows `No venue matches. Ask an admin to add it.` and the hidden input stays `""` after typing and blurring (Review Focus 3); state blank in popover blocks Save. Run → FAIL.
- [ ] **Step 2:** Implement. Popover: name, state (required), city, county; full-width below `sm`.
- [ ] **Step 3:** Run → PASS. Commit both files: `feat(matters): venue combobox with inline add`.

### Task 8: New matter form and page

**Files:**
- Modify: `src/app/(dashboard)/matters/new/page.tsx`, `src/components/matters/new-matter-form.tsx`, `src/lib/matter-name.ts` (remove the Task 2 temporary wrapper)
- Test: `src/components/matters/new-matter-form.test.tsx`, `src/components/matters/new-matter-form.interactions.test.tsx`, `src/app/(dashboard)/matters/new/page.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 7.
- Produces: `NewMatterForm` props gain `venues: VenueOption[]`, `canAddVenue: boolean`, `firmState: string`, `firmTemplate: string`, `timeZone: string`; each `areas[]` item gains `matterNameTemplate: string | null`, `requiredMatterFields: string[]`. Page loads them (`listVenues({activeOnly:true})`, `getCurrentFirm()`, `currentUserHasPermission("venues.add")`, `getCurrentUserTimeZone()`).

- [ ] **Step 1: Failing tests:**
  - interactions: picking area A (template `State v. {client_last}`) then typing client "Maria Alvarez" → name `State v. Alvarez`; switching to area B (null template) → firm default output; after a manual name edit, switching area leaves the name alone; "Reset to auto" restores.
  - interactions: area requiring `["caseNumber","venue"]` shows `*` and `Required for {area}` on both; submitting empty shows both errors client-side without calling the action and focuses the first.
  - form: Filed date and Trial date inputs (`type="date"`, names `filedDate`/`trialDate`) render in Details.
  - form: name hint shows the effective template text.
  - page: passes venues/firm template/`canAddVenue` (mock `currentUserHasPermission`).
  Run → FAIL.
- [ ] **Step 2:** Implement: replace the location input with `VenueCombobox`; compute name via `renderMatterName(effectiveTemplate(area, firmTemplate), {…, now: new Date(), timeZone})`; required markers via `missingRequired` on submit (server stays authoritative). Mobile: the form's two-up grids become `grid-cols-1 sm:grid-cols-2`; the submit row becomes `sticky bottom-0` with the page background below `sm`. Delete the temporary `autoMatterName` wrapper.
- [ ] **Step 3:** Run the three test files → PASS; `npm run typecheck` → passes. Commit the files: `feat(matters): new-matter form uses venues, name templates, dates and required fields`.

### Task 9: Edit matter form and page

**Files:**
- Modify: `src/components/matters/edit-matter-form.tsx`, the edit page (`src/app/(dashboard)/matters/[id]/edit/page.tsx`; confirm path with `ls`)
- Test: the edit form's existing test file (create `edit-matter-form.test.tsx` beside it if none)

**Interfaces:**
- Consumes: Tasks 3, 6, 7. Props gain `venues`, `currentVenue: VenueOption | null` (may be archived), `canAddVenue`, `firmState`, and area `requiredMatterFields`.

- [ ] **Step 1: Failing tests:** venue combobox shows the current venue, `(archived)` when archived; Filed/Trial date inputs prefilled from `dateOnlyKey`; required markers follow the selected area; clearing a required field that had a value shows the client-side error. Run → FAIL.
- [ ] **Step 2:** Implement (the edit form does not auto-rename; no template here). Page loads venues plus the matter's current venue even if archived.
- [ ] **Step 3:** Run → PASS. Commit: `feat(matters): edit form gains venue and filed/trial dates`.

### Task 10: Settings → Venues

**Files:**
- Create: `src/app/(dashboard)/settings/venues/page.tsx`, `page.test.tsx`, `src/components/settings/venue-editor.tsx`, `venue-editor.test.tsx`
- Modify: `src/components/settings/settings-nav.tsx` (Practice group, after Practice areas; `requiresAny: ["venues.add","venues.edit","venues.delete"]`, or the nav's existing multi-key mechanism; add one if absent)

**Interfaces:**
- Consumes: `listVenues`, Task 4 actions.
- Produces: page gated like `settings/records-types/page.tsx` (`requireUser()` then `notFound()` unless the user holds any venue key via `currentUserHasAnyPermission`). Editor table: Name, City, County, State, Matters, Status; Add / Edit / Archive-Restore / Delete (Delete hidden when `matterCount > 0`); each control shown only with its key.

- [ ] **Step 1: Failing tests:** page `notFound()` without any venue key; renders rows with matter counts; editor hides Delete for a used venue and hides Add without `venues.add`. Run → FAIL.
- [ ] **Step 2:** Implement. Run → PASS. Commit: `feat(settings): Venues page`.

### Task 11: Settings UI for templates and required fields

**Files:**
- Modify: `src/components/settings/edit-practice-area-form.tsx`, `create-practice-area-form.tsx`, `practice-area-form-parts.tsx`, `firm-edit-form.tsx`
- Create: `src/components/settings/matter-name-template-field.tsx` (+ `.test.tsx`)
- Test: existing `edit-practice-area-form.test.tsx`, `firm-edit-form.test.tsx`

**Interfaces:**
- Consumes: `parseTemplate`, `renderMatterName`, `MATTER_NAME_TOKENS`, `REQUIRED_MATTER_FIELDS`.
- Produces: `<MatterNameTemplateField name="matterNameTemplate" defaultValue={string} placeholder?={string} />` showing a token reference and a live preview against fixed sample values (client "Maria Alvarez", case "2026-CV-00481", venue Aurora / Arapahoe / CO, opposing "City of Aurora", area = the area's name or "Civil Rights"), plus the parse error inline. Practice-area forms add the field (placeholder = firm template, blank = inherit) and a "Required at creation" checkbox group posting `requiredMatterFields`.

- [ ] **Step 1: Failing tests:** preview renders `Alvarez, Maria - 2026-CV-00481 - Aurora` for the default; `{nope}` shows the parse error; area form posts checked `requiredMatterFields`; firm form includes the template field. Run → FAIL.
- [ ] **Step 2:** Implement. Run → PASS. Commit: `feat(settings): matter-name template and required-field settings`.

### Task 12: Docs, full suite, cleanup

**Files:**
- Modify: `docs/features/matters.md`, `docs/ROADMAP.md`, `docs/features/settings-admin.md`, `docs/SCHEMA_NOTES.md`, `docs/PERMISSIONS.md` (only if it lists per-key details; it says keys aren't copied, so likely just the Venues gate sentence), `docs/decisions/README.md`
- Create: `docs/decisions/055-venues-are-a-firm-list-required-fields-are-per-area.md`
- Delete: this plan and the spec

- [ ] **Step 1:** Write ADR-056 (context, decision: no free-text location; required per area, enforced on create, can't-clear-but-don't-block on edit; consequences). Add its README row.
- [ ] **Step 2:** `matters.md`: add a Shipped line for this sub-project (2026-10-20, ADR-056), trim the v2 follow-up list to what's left (retainer + trust deposit, save-draft, plus the untouched items). ROADMAP `/matters/new v2` line: "conflict check, team, venues, name template, dates, required fields shipped; retainer and drafts left." `settings-admin.md`: Venues page and the template/required settings. `SCHEMA_NOTES.md`: `Venue.nameKey` note.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → all pass. Fix anything red before continuing.
- [ ] **Step 4:** `git rm` the spec and plan and commit them with the docs in one step: `docs(matters): venues, name templates and required fields shipped; ADR-056`.
- [ ] **Step 5:** Push to main once the pre-commit hook has passed on every commit.
