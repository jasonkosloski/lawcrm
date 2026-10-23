# Lead Attorney and Bar Admissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attorneys hold per-state bar admissions; every newly picked lead attorney must hold one; templates print the lead attorney, the matter's attorneys and the bar number for the venue's state.

**Architecture:** A `BarAdmission` table (one row per user per state) replaces `User.barNumber` in app code; a backfill moves existing numbers to the firm's state. One helper module (`src/lib/attorneys.ts`) defines "attorney" and picks the bar number for a state; every lead-picking action and picker uses it. Template data gains lead/attorney fields resolved in `load-data.ts`.

**Tech Stack:** Next.js 16 server actions, Prisma/Postgres, zod, Vitest + Testing Library, Docker test DB on :5433.

**Spec:** `docs/superpowers/specs/2026-10-23-lead-attorney-bar-admissions-design.md`

## Global Constraints

- Every test run needs `docker compose -f docker-compose.test.yml up -d`.
- Migrations: generate with `prisma migrate diff` against a local scratch DB in the Docker test Postgres; export BOTH `DATABASE_URL` and `DIRECT_DATABASE_URL` to `postgresql://lawcrm_test:lawcrm_test@localhost:5433/<scratch>`, confirm `prisma migrate status` says localhost first; never point Prisma at a remote DB. Expand-only (migrations ship on push, ADR-058). Run `npm run check:migrations`.
- Commit on main in one step with an explicit pathspec (`git commit -m "…" -- <paths>`; `git add -N` new files first). Never leave files staged. Each commit must be deploy-safe on its own.
- Mutations stay server actions with `requirePermission`, `logActivity`/`logSettingsChange`, `revalidatePath`. No new permission keys.
- Bar number: trimmed, 1–40 chars. State: two-letter code from `US_STATES`. ≤ 60 admissions per user. No duplicate state per user.
- Attorney roles: `lead`, `co_counsel`, `of_counsel`. Attorney = active user with ≥ 1 admission.
- Copy, verbatim: empty picker — "No one has a bar number yet — add one in Settings → Team."; non-attorney lead error — "The lead attorney needs a bar number on file."; settings log — "bar admissions updated".
- `User.barNumber` stays in the schema, unread and unwritten by app code after Task 5.

## Review Focus

1. Venue state typed as a name ("Colorado", " colorado ") must match a `CO` admission — Task 3 test `barNumberFor matches names`.
2. Saving Profile/Team member without touching admissions must not wipe them (field absent → unchanged) — Task 5 test `omitted admissions are left alone`.
3. A lead who later deletes their last admission stays lead; editing other matter fields must not then fail — Task 7 test `unchanged non-attorney lead is not re-validated`.
4. Lowercase or duplicate states in a submit ("co", "CO") — Task 5 test `normalizes and rejects duplicate states`.
5. `createMatter` with a stale posted lead and a non-attorney current user must error, not silently assign — Task 7 test `no silent fallback to a non-attorney`.

---

### Task 1: US states list and `stateCode`

**Files:**

- Create: `src/lib/us-states.ts`, `src/lib/us-states.test.ts`

**Interfaces:**

- Produces: `US_STATES: readonly { code: string; name: string }[]` (50 states, DC, PR, GU, VI, AS, MP; name-ordered); `stateCode(text: string | null | undefined): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
it("accepts codes and names, ignoring case, periods and spaces", () => {
  expect(stateCode("CO")).toBe("CO");
  expect(stateCode(" co ")).toBe("CO");
  expect(stateCode("C.O.")).toBe("CO");
  expect(stateCode("Colorado")).toBe("CO");
  expect(stateCode("new  york")).toBe("NY");
  expect(stateCode("District of Columbia")).toBe("DC");
});
it("returns null for anything else", () => {
  for (const t of ["Colo.", "XX", "", null, undefined]) expect(stateCode(t)).toBeNull();
});
it("has 56 unique codes", () => {
  expect(new Set(US_STATES.map((s) => s.code)).size).toBe(56);
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/us-states.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement.** Normalize: remove `.`, collapse whitespace, trim, lowercase; match code or name.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(attorneys): US states list and stateCode` — `-- src/lib/us-states.ts src/lib/us-states.test.ts`

### Task 2: `BarAdmission` table and backfill

**Files:**

- Modify: `prisma/schema.prisma` (new model; `User.barAdmissions BarAdmission[]`; doc comment on `User.barNumber`: "Superseded by BarAdmission; not read or written. Drop in a later migration.")
- Create: `prisma/migrations/20261023140000_bar_admissions/migration.sql`, `src/lib/bar-admissions-backfill.test.ts`
- Modify: `docs/SCHEMA_NOTES.md` (kept-but-unused `barNumber`, backfill rule)

**Interfaces:**

- Produces: Prisma model `BarAdmission { id String @id @default(cuid()); userId String; state String; number String; createdAt DateTime @default(now()); user User @relation(onDelete: Cascade); @@unique([userId, state]); @@map("bar_admissions") }`.

- [ ] **Step 1: Schema + generated DDL.** Edit the schema, generate the DDL with the scratch-DB recipe (Global Constraints) into the migration file.
- [ ] **Step 2: Append the backfill** to the migration under a line exactly `-- Backfill: existing bar numbers move to the firm's state.`: one `INSERT INTO "bar_admissions" ("id","userId","state","number","createdAt") SELECT gen_random_uuid()::text, u."id", <code>, btrim(u."barNumber"), now() FROM "users" u JOIN "firms" f ON f."id" = u."firmId" WHERE btrim(coalesce(u."barNumber",'')) <> '' AND <code> IS NOT NULL ON CONFLICT DO NOTHING;` where `<code>` is a `CASE` on `lower(regexp_replace(replace(btrim(f."state"),'.',''),'\s+',' ','g'))` with one `WHEN` per state for its lowercase code and its lowercase name (generate the CASE from `US_STATES`; check the table names in `schema.prisma` `@@map`). Store the number as `left(btrim(u."barNumber"), 40)`.
- [ ] **Step 3: Write the backfill test.** It reads the migration file, takes the text after the backfill marker, runs it with `prisma.$executeRawUnsafe` after seeding: firm state `"CO"` + user number `" 12345 "` → row `{state:"CO", number:"12345"}`; firm state `"Colorado"` → `CO`; firm state `null` or `"Narnia"` → no row; blank number → no row; running it twice → still one row.
- [ ] **Step 4: Run** `npx vitest run src/lib/bar-admissions-backfill.test.ts` and `npm run check:migrations` — PASS / "migrations match".
- [ ] **Step 5: Commit** `feat(attorneys): bar_admissions table, backfilled from bar numbers` — schema, migration, test, SCHEMA_NOTES.

### Task 3: Attorney helpers

**Files:**

- Create: `src/lib/attorneys.ts`, `src/lib/attorneys.test.ts`

**Interfaces:**

- Consumes: `stateCode` (Task 1).
- Produces:
  - `ATTORNEY_ROLES = ["lead", "co_counsel", "of_counsel"] as const`
  - `attorneyUserWhere: Prisma.UserWhereInput` = `{ isActive: true, barAdmissions: { some: {} } }`
  - `isAttorney(userId: string, db?: Prisma.TransactionClient | typeof prisma): Promise<boolean>`
  - `barNumberFor(admissions: { state: string; number: string }[], stateText: string | null): string | null`
  - `LEAD_NOT_ATTORNEY = "The lead attorney needs a bar number on file."`
  - `NO_ATTORNEYS = "No one has a bar number yet — add one in Settings → Team."`

- [ ] **Step 1: Tests.** `barNumberFor matches names`: `[{state:"CO",number:"1"},{state:"WY",number:"2"}]` with `"Colorado"` → `"1"`, `" wy "` → `"2"`, `"UT"` → null, `null` → null. `isAttorney` (integration, seeded): active + admission → true; no admission → false; inactive with admission → false.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(attorneys): attorney helpers` — the two files.

### Task 4: Template fields

**Files:**

- Modify: `src/lib/templates/catalog.ts` (types, fields, `attorneys` list, sample data), `src/lib/templates/load-data.ts`, their tests `catalog.test.ts`, `load-data.test.ts`; `src/lib/templates/converters-fixture.ts` if typecheck needs it.

**Interfaces:**

- Consumes: `barNumberFor`, `ATTORNEY_ROLES` (Task 3).
- Produces: `TemplateData.matter` gains `leadAttorney: { name: string; email: string | null; phone: string | null; barNumber: string | null } | null`; `TemplateData.attorneys: PersonItem[]`; `PersonItem.barNumber?: string | null`. Fields `matter.leadAttorney` (type person), `matter.leadAttorneyEmail`, `matter.leadAttorneyPhone`, `matter.leadAttorneyBarNumber` (scopes MATTER, group "Matter"); list `attorneys` (label "Attorneys", scopes MATTER, item fields name, email, phone, role, barNumber — add a `barNumber` item field labelled "Bar number").

- [ ] **Step 1: Tests.**
  - catalog: the new paths exist with the scopes above; sample data resolves non-null (existing "every field resolves" test covers it once sample data is added; sample lead `"Alex Attorney (sample)"`, bar `"00000"`; attorneys list of two).
  - load-data (integration): matter in a venue with state `"Colorado"`, lead with `CO 111` and `WY 222`, co-counsel with `CO 333`, paralegal with `CO 444` → `matter.leadAttorney.barNumber === "111"`, `attorneys` names = [lead, co-counsel] (paralegal excluded, lead first then name), `attorneys[1].barNumber === "333"`; signer = lead → `signer.barNumber === "111"`; no venue + firm state `"WY"` → lead's `"222"`; no admission for the state → null; lead-scope record → signer by firm state.
- [ ] **Step 2–4:** run (FAIL), implement: `userSelect` swaps `barNumber` for `barAdmissions: { select: { state: true, number: true } }`; compute `barState = matter?.venue?.state ?? firm.state`; `toSigner` and the team mapping use `barNumberFor(u.barAdmissions, barState)`. Run (PASS).
- [ ] **Step 5: Commit** `feat(templates): lead attorney and attorneys fields, bar number by venue state`.

### Task 5: Saving admissions (actions + queries)

**Files:**

- Create: `src/lib/bar-admissions.ts`, `src/lib/bar-admissions.test.ts`
- Modify: `src/app/actions/profile.ts`, `src/app/actions/team.ts` (invite + update), `src/lib/queries/team.ts` (`FirmUserRow.barAdmissions` replaces `barNumber`), the profile page loader `src/app/(dashboard)/settings/profile/page.tsx`; tests `profile.test.ts`, `team.test.ts` (update existing `barNumber` assertions).

**Interfaces:**

- Consumes: `US_STATES`, `stateCode` (Task 1).
- Produces:
  - `type BarAdmissionInput = { state: string; number: string }`
  - `parseBarAdmissions(raw: FormDataEntryValue | null): { ok: true; value: BarAdmissionInput[] | undefined } | { ok: false; error: string }` — `null` (field absent) → `value: undefined`; JSON array, each state normalized with `stateCode`, number trimmed; errors: unknown state, number empty or > 40, duplicate state, > 60 rows, malformed JSON.
  - `replaceBarAdmissions(tx, userId: string, rows: BarAdmissionInput[]): Promise<boolean>` — deletes and recreates; returns whether anything changed.
  - Form field name: `barAdmissions` (JSON string). `fieldErrors.barAdmissions` carries the error.
- [ ] **Step 1: Tests.** `normalizes and rejects duplicate states`: `[{state:"co",number:" 1 "}]` → `[{state:"CO",number:"1"}]`; `[{state:"CO",…},{state:"Colorado",…}]` → error. `omitted admissions are left alone`: `updateFirmMember` / `updateProfileAction` without the field keep existing rows; with `"[]"` remove them; with rows replace them and log "bar admissions updated" (no numbers in the log). Invite with admissions creates them.
- [ ] **Step 2–4:** run (FAIL); implement — writes happen in the same transaction as the user update; stop reading/writing `User.barNumber`; run (PASS).
- [ ] **Step 5: Commit** `feat(attorneys): save bar admissions from profile and team`.

### Task 6: Bar admissions editor UI

**Files:**

- Create: `src/components/settings/bar-admissions-field.tsx`, `.test.tsx`
- Modify: `profile-edit-form.tsx`, `member-edit-form.tsx`, `invite-member-composer.tsx` (+ their tests where they assert the old field)

**Interfaces:**

- Consumes: `US_STATES`; `BarAdmissionInput` (Task 5).
- Produces: `BarAdmissionsField({ defaultValue: BarAdmissionInput[]; error?: string })` — renders a labelled "Bar admissions" group: rows of state `NativeSelect` (aria-label "State", options from `US_STATES`) + number input (aria-label "Bar number", maxLength 40) + remove button (aria-label "Remove admission"); "Add admission" button; a hidden input `name="barAdmissions"` holding the JSON of non-empty rows; hint "Attorneys only."

- [ ] **Step 1: Tests.** Add two rows, remove one, the hidden input value equals the JSON of the remaining row; default rows render; error text shows.
- [ ] **Step 2–4:** run (FAIL), implement and wire into the three forms (replacing the "Bar number" field), run (PASS).
- [ ] **Step 5: Commit** `feat(attorneys): bar admissions editor in profile and team`.

### Task 7: The lead must be an attorney (matters)

**Files:**

- Modify: `src/app/actions/matters.ts` (`createMatter` ~598-605, `updateMatter` lead change ~1089-1120, `addMatterTeamMember` lead role), `src/app/(dashboard)/matters/new/page.tsx`, `src/app/(dashboard)/matters/[id]/edit/page.tsx`, `src/app/(dashboard)/matters/[id]/page.tsx` (team management data), `src/components/matters/new-matter-team-picker.tsx`, `edit-matter-form.tsx`, `matter-team-management.tsx`; tests beside each.

**Interfaces:**

- Consumes: `attorneyUserWhere`, `isAttorney`, `LEAD_NOT_ATTORNEY`, `NO_ATTORNEYS` (Task 3).
- Produces: pages pass lead options `{ id; name }[]` from `prisma.user.findMany({ where: { firmId, ...attorneyUserWhere } })`; team management receives `attorneyIds: string[]` and offers the "Lead attorney" role only for those users.

- [ ] **Step 1: Tests (actions, integration).** `createMatter`: attorney lead → ok; non-attorney posted lead → `fieldErrors.leadUserId = [LEAD_NOT_ATTORNEY]`; `no silent fallback to a non-attorney` (stale id + non-attorney current user → same error, no matter created); stale id + attorney current user → current user is lead. `updateMatter`: change to non-attorney → error; `unchanged non-attorney lead is not re-validated` (lead with no admissions, update the name → ok). `addMatterTeamMember` role lead + non-attorney → error; co_counsel non-attorney → ok.
- [ ] **Step 2: Tests (UI).** New-matter lead select lists only the passed attorneys; with none it shows `NO_ATTORNEYS` and the submit is disabled; team management hides "Lead attorney" in the role select for a non-attorney pick.
- [ ] **Step 3–5:** run (FAIL), implement, run (PASS).
- [ ] **Step 6: Commit** `feat(matters): the lead attorney must have a bar number`.

### Task 8: Conversion picks the lead attorney

**Files:**

- Modify: `src/app/actions/leads.ts` (`convertLeadToMatter` ~281 and the team block ~600), `src/lib/lead-conversion-form.ts`, `src/components/intake/convert-lead-button.tsx`, `src/app/(dashboard)/intake/[id]/layout.tsx`; tests beside each (`leads` conversion tests).

**Interfaces:**

- Consumes: Task 3 helpers.
- Produces: form field `leadAttorneyId` (required); `ConvertLeadButton` props gain `attorneys: { id: string; name: string }[]` and `defaultLeadAttorneyId: string | null` (layout computes: converter if attorney, else the intake team's only attorney, else null).

- [ ] **Step 1: Tests.** Converts with an attorney `leadAttorneyId`: that user is `lead`; the converter, if on the intake team, keeps their mapped role, and if not on it, is not added; any other intake `lead` joins as `co_counsel`; the SOL deadline owner is the picked lead. Missing or non-attorney `leadAttorneyId` → `errors.leadAttorneyId = [LEAD_NOT_ATTORNEY]`, nothing created. Dialog: picker lists attorneys, preselects the default, shows `NO_ATTORNEYS` and disables Convert when empty. Layout default rule: converter attorney → converter; else single intake attorney → them; else null.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(intake): pick the lead attorney when converting`.

### Task 9: Docs and cleanup

**Files:**

- Create: `docs/decisions/069-lead-attorneys-hold-a-bar-admission.md` (+ row in `docs/decisions/README.md`)
- Modify: `docs/features/matters.md`, `docs/features/settings-admin.md`, `docs/features/documents.md`
- Delete: the spec and this plan.

- [ ] **Step 1:** ADR-069 records: attorney = active user with ≥ 1 admission; leads must be attorneys at pick time only (existing leads grandfathered, unflagged); bar number prints by venue state, else firm state, else "not on file"; `User.barNumber` kept until a drop migration.
- [ ] **Step 2:** Feature docs describe the end state (one line each where they mention team/bar number/template fields).
- [ ] **Step 3:** Full `npm test`; then commit `docs: ADR-069 and feature docs for lead attorneys` with the deletions; push.
