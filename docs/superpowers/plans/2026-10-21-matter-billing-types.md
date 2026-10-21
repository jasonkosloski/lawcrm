# Matter Billing Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Practice areas declare allowed billing types + a default; matters pick one at creation (new form, lead conversion), locked afterwards behind `matters.billing_type.edit`.

**Architecture:** Billing type is derived from the existing `Matter.feeStructure` + `Matter.billingMode` via one client-safe mapping module; no new Matter column. `PracticeArea` gains `allowedBillingTypes` + `defaultBillingType` (expand-only). Server actions enforce the allowed list and the lock.

**Tech Stack:** Next.js (repo version — read `node_modules/next/dist/docs/` before touching routing/actions), Prisma/Postgres, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-matter-billing-types-design.md`

## Global Constraints

- Billing types, in this order: `hourly`, `flat`, `contingent`, `court_appointed`, `pro_bono`. Labels: Hourly, Flat fee, Contingency, Court-appointed, Pro bono. Legacy `hybrid` labelled "Hybrid", never offered.
- Mapping: `court_appointed` → `hourly` + `court_voucher`; `pro_bono` → `pro_bono` + `none`; others → same-named fee structure + `client`. Reverse: `billingMode === "court_voucher"` → `court_appointed`, else `feeStructure`.
- Migration is expand-only (ADR-058). Build it with `prisma migrate diff` against a local Docker scratch DB — `.env` points `DIRECT_DATABASE_URL` at remote dev; never run `migrate dev` against it. Check `printenv | grep -i database` first. Then `npm run check:migrations`.
- Tests need `docker compose -f docker-compose.test.yml up -d`.
- Commit with explicit pathspec: `git add <paths> && git commit -m "…" -- <paths>`; never leave files staged; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Mutations stay server actions with `logActivity`/`logActivityTx` and `revalidatePath`.
- Disallowed-type field error copy: `Not offered for this practice area`.

## Review Focus

1. Stale form posts a `billingType` the area no longer allows (area narrowed between page load and submit) → server rejects with the field error; no matter created. (Task 4/5 test.)
2. User without `matters.billing_type.edit` posts a crafted `billingType` on edit → rejected, stored fields unchanged. (Task 6 test.)
3. Legacy `hybrid` matter edited by a user without the permission (form posts nothing for billing) → save succeeds, `hybrid` preserved. (Task 6 test.)
4. Existing `fee_petition` matter edited without touching billing → `billingMode` stays `fee_petition`. (Task 6 test.)
5. Practice-area form posts allowed list that excludes the posted default → server error on `defaultBillingType`, nothing saved. (Task 3 test.)

---

### Task 1: Billing-type mapping module

**Files:**
- Create: `src/lib/billing-type.ts`
- Test: `src/lib/billing-type.test.ts`

**Interfaces:**
- Produces:
  - `BILLING_TYPES` (readonly tuple above), `type BillingType`
  - `type BillingTypeOrLegacy = BillingType | "hybrid"`
  - `BILLING_TYPE_LABEL: Record<BillingTypeOrLegacy, string>`
  - `BILLING_TYPE_OPTIONS: Array<{ value: BillingType; label: string }>`
  - `billingTypeFields(t: BillingType): { feeStructure: FeeStructure; billingMode: BillingMode }`
  - `billingTypeOf(m: { feeStructure: string; billingMode: string }): BillingTypeOrLegacy`
  - `isBillingType(v: unknown): v is BillingType`
  - `billingTypeFromLegacyMode(mode: string): BillingType` (court_voucher→court_appointed, none→pro_bono, else contingent) — used for the backfill test parity and nowhere else at runtime.

- [ ] **Step 1: Write failing tests** — `billingTypeFields` for all five types (exact pairs from Global Constraints); `billingTypeOf` round-trips every type; `billingTypeOf({feeStructure:"hybrid",billingMode:"client"}) === "hybrid"`; `billingTypeOf({feeStructure:"contingent",billingMode:"fee_petition"}) === "contingent"`; `billingTypeOf({feeStructure:"hourly",billingMode:"fee_petition"}) === "hourly"`; `isBillingType("hybrid") === false`; `billingTypeFromLegacyMode` for `court_voucher`, `none`, `client`, `fee_petition`.
- [ ] **Step 2:** `npx vitest run src/lib/billing-type.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement; import `FeeStructure` from `fee-structure-constants.ts`, `BillingMode` from `billing-mode-constants.ts`. No `"use server"`, no Prisma import.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat(matters): billing type mapping`.

### Task 2: Schema, migration, permission key

**Files:**
- Modify: `prisma/schema.prisma` (PracticeArea, ~line 369)
- Create: `prisma/migrations/<timestamp>_practice_area_billing_types/migration.sql`
- Modify: `src/lib/permissions.ts` (matters category, after `matters.edit`)
- Test: existing permission tests (`npx vitest run src/lib/permissions`)

**Interfaces:**
- Produces: `PracticeArea.allowedBillingTypes: string[]`, `PracticeArea.defaultBillingType: string`; permission key `matters.billing_type.edit`.

- [ ] **Step 1:** Add to `PracticeArea`:
  `allowedBillingTypes String[] @default(["hourly", "flat", "contingent", "court_appointed", "pro_bono"])` and `defaultBillingType String @default("contingent")`, with doc comments. Rewrite the `defaultBillingMode` comment to `DEPRECATED (expand/contract): replaced by defaultBillingType; no code reads it. Drop in a later migration.` (mirror `statutePeriodDays`).
- [ ] **Step 2:** Generate SQL with `prisma migrate diff` from the current migrations to the new schema using a local Docker scratch DB (`--shadow-database-url` on the :5433 test DB or a throwaway container). Append the backfill:
  ```sql
  UPDATE "practice_areas" SET "defaultBillingType" = CASE "defaultBillingMode"
    WHEN 'court_voucher' THEN 'court_appointed'
    WHEN 'none' THEN 'pro_bono'
    ELSE 'contingent' END;
  ```
- [ ] **Step 3:** `npx prisma generate && npm run check:migrations` → passes, no drift.
- [ ] **Step 4:** Add permission entry: key `matters.billing_type.edit`, label `Change billing type`, description `Change a matter's billing type after it is created (hourly, flat fee, contingency, court-appointed, pro bono). Set at creation from the practice area's allowed types otherwise. Logged.` Update `matters.edit` description: replace "fee structure" with nothing (drop it from the list).
- [ ] **Step 5:** `npm run typecheck && npx vitest run src/lib/permissions` → PASS (fix any snapshot/count test the key addition touches).
- [ ] **Step 6:** Commit `feat(matters): practice area billing types schema and permission`.

### Task 3: Practice-area settings

**Files:**
- Modify: `src/app/actions/practice-areas.ts` (schema ~line 132, create ~200, update ~293, log ~440)
- Modify: `src/components/settings/edit-practice-area-form.tsx`
- Modify: `src/app/(dashboard)/settings/practice-areas/[id]/page.tsx` (~line 101) and the create form/page if it posts `defaultBillingMode`
- Test: `src/app/actions/practice-areas.test.ts` (create if absent, else extend), `src/components/settings/edit-practice-area-form.test.tsx`

**Interfaces:**
- Consumes: Task 1 `BILLING_TYPES`, `BILLING_TYPE_OPTIONS`, `isBillingType`; Task 2 columns.
- Produces: form posts repeated `allowedBillingTypes` checkboxes, hidden `allowedBillingTypesPresent` marker, and `defaultBillingType` select (same pattern as `requiredMatterFields` / `requiredMatterFieldsPresent`). Area prop gains `allowedBillingTypes: string[]; defaultBillingType: string` replacing `defaultBillingMode`.

- [ ] **Step 1: Failing action tests:**
  - `updatePracticeArea` with `allowedBillingTypes=["court_appointed"]`, `defaultBillingType="court_appointed"` → saves both; activity log text contains `Billing types:`.
  - marker present, zero types → `{ ok:false }` with error on `allowedBillingTypes`, row unchanged.
  - default `hourly` with allowed `["contingent"]` → error on `defaultBillingType`, row unchanged. (Review Focus 5.)
  - unknown value `hybrid` in allowed → error.
  - marker absent → billing fields left unchanged.
  - `createPracticeArea` without billing fields → schema defaults.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: drop `defaultBillingMode` from the zod schema and writes; parse `formData.getAll("allowedBillingTypes")` deduped, ordered per `BILLING_TYPES`; validate in `superRefine`/inline; log `Billing types: <labels> → <labels>; default <label> → <label>` only when changed.
- [ ] **Step 4: Failing form test:** checkbox per type checked per prop; Default select lists only checked types; unchecking the current default switches the select to the first remaining checked type.
- [ ] **Step 5:** Implement form: replace the "Default billing mode" select with a fieldset "Billing types" (checkboxes, controlled state) + "Default" `NativeSelect`.
- [ ] **Step 6:** `npx vitest run src/app/actions/practice-areas src/components/settings/edit-practice-area-form` → PASS.
- [ ] **Step 7:** Commit `feat(settings): practice area allowed billing types`.

### Task 4: New-matter creation

**Files:**
- Modify: `src/app/actions/matters.ts` (`resolveAreaAndStage` ~335–392; create schema ~90; create write ~756)
- Modify: `src/components/matters/new-matter-form.tsx` (`AreaOption` ~94, area-change handler ~388, fee field ~676)
- Modify: the `/matters/new` page that builds `AreaOption`s (add the two fields to its Prisma select)
- Test: `src/app/actions/matters.test.ts`, `src/components/matters/new-matter-form.test.tsx`

**Interfaces:**
- Consumes: Task 1 `billingTypeFields`, `isBillingType`, `BILLING_TYPE_OPTIONS`.
- Produces: `resolveAreaAndStage` ok-result replaces `defaultBillingMode` with `allowedBillingTypes: BillingType[]; defaultBillingType: BillingType`. `AreaOption` gains the same two fields. Form field name `billingType` (replaces `feeStructure`).

- [ ] **Step 1: Failing action tests:**
  - area allows `["court_appointed"]`, post `billingType=court_appointed` → matter `feeStructure=hourly`, `billingMode=court_voucher`.
  - same area, post `billingType=hourly` → `fieldErrors.billingType = ["Not offered for this practice area"]`, no matter row. (Review Focus 1.)
  - post omits `billingType` → area default used.
  - `pro_bono` → `pro_bono` + `none`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: create schema `billingType: z.enum(BILLING_TYPES).optional()`; after `resolveAreaAndStage`, default to area default, reject if not in allowed, spread `billingTypeFields(type)` into the create; remove `feeStructure` from the create schema and the `defaultBillingMode` snapshot.
- [ ] **Step 4: Failing form test:** with area A (allows hourly, contingent; default hourly) and area B (allows court_appointed only), select shows A's two options with hourly selected; switching to B shows only Court-appointed selected; switching back to A resets to hourly.
- [ ] **Step 5:** Implement form: "Billing type" `NativeSelect` controlled by state, options filtered from `BILLING_TYPE_OPTIONS`; reset in the existing area-change handler when the current value isn't allowed. Keep the existing select-revert comment (~183) accurate.
- [ ] **Step 6:** `npx vitest run src/app/actions/matters.test.ts src/components/matters/new-matter-form` → PASS.
- [ ] **Step 7:** Commit `feat(matters): pick billing type at creation`.

### Task 5: Lead conversion

**Files:**
- Modify: `src/app/actions/leads.ts` (schema ~232, area select ~314, write ~542)
- Modify: `src/components/intake/convert-lead-button.tsx` (local `FEE_OPTIONS` ~55, state ~110, field ~255)
- Modify: `src/lib/lead-conversion-form.ts` (field key `feeStructure` → `billingType`)
- Modify: wherever the convert dialog receives practice-area options (add the two fields)
- Test: `src/app/actions/leads.test.ts`, `src/components/intake/convert-lead-button.test.tsx`

**Interfaces:**
- Consumes: Task 1; same field name `billingType` and error copy as Task 4.

- [ ] **Step 1: Failing tests:** convert with allowed type → both matter fields written per mapping; disallowed type → field error, lead not claimed (stage unchanged), no matter; dialog option list follows chosen area and preselects its default.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: delete the local `FEE_OPTIONS`; schema `billingType: z.enum(BILLING_TYPES).optional()`; select `allowedBillingTypes`, `defaultBillingType` on the area (drop `defaultBillingMode`); check before the conditional claim inside the transaction; write `billingTypeFields`.
- [ ] **Step 4:** `npx vitest run src/app/actions/leads.test.ts src/components/intake/convert-lead-button` → PASS.
- [ ] **Step 5:** Commit `feat(intake): billing type on lead conversion`.

### Task 6: Edit-matter lock

**Files:**
- Modify: `src/app/actions/matters.ts` (update schema ~992–1002, select ~1083, write ~1389, diff ~1548)
- Modify: `src/components/matters/edit-matter-form.tsx` (fields ~420–465, props ~70)
- Modify: `src/app/(dashboard)/matters/[id]/edit/page.tsx` (permission flags ~125, init ~201)
- Test: `src/app/actions/matters.test.ts`, `src/components/matters/edit-matter-form.test.tsx`, `src/app/(dashboard)/matters/[id]/edit/page.test.tsx`

**Interfaces:**
- Consumes: Task 1 `billingTypeOf`, `billingTypeFields`, `BILLING_TYPE_LABEL`, `BILLING_TYPE_OPTIONS`; Task 2 key.
- Produces: form prop `canEditBillingType: boolean`; init `billingType: BillingTypeOrLegacy` replaces `feeStructure`/`billingMode`.

- [ ] **Step 1: Failing action tests:**
  - without permission, post `billingType` differing from stored → `{ ok:false }` with field error `You don't have permission to change the billing type`, fields unchanged. (Review Focus 2.)
  - without permission, post omitted → save ok; legacy `hybrid` preserved (Review Focus 3); `fee_petition` preserved (Review Focus 4).
  - without permission, post equal to stored type → ok, no billing write.
  - with permission, `hourly` → `court_appointed` → `hourly`+`court_voucher`; activity diff `billing type Hourly → Court-appointed`.
  - with permission, may choose a type outside the area's allowed list.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: replace `feeStructure` / `billingMode` in the update schema with `billingType: z.enum(BILLING_TYPES).optional()`; compare against `billingTypeOf(stored)`; when changed, require `currentUserHasPermission("matters.billing_type.edit")`, write `billingTypeFields`, log diff with labels.
- [ ] **Step 4: Failing form tests:** `canEditBillingType=false` → text `Court-appointed · set at creation`, no `billingType` input; `true` → select with five options (plus "Hybrid" option only when current is hybrid), current selected.
- [ ] **Step 5:** Implement form + page (load flag via `currentUserHasPermission`, pass `billingTypeOf(matter)`). Remove the billing-mode select and its hint.
- [ ] **Step 6:** Run the three test files → PASS.
- [ ] **Step 7:** Commit `feat(matters): lock billing type after creation`.

### Task 7: Matters list filter and labels

**Files:**
- Modify: `src/lib/matters-filters.ts` (`FEE_LABELS` ~71, filter field `feeStructures`, URL param `fee`)
- Modify: `src/lib/queries/matters.ts` (where ~107, sort ~220, row ~325, options ~404–448)
- Modify: `src/components/matters/matters-toolbar.tsx`, `matters-table.tsx` (~145), `matters-kanban.tsx` (~120)
- Test: `src/lib/matters-filters.test.ts`, `src/lib/queries/matters.test.ts`, `src/components/matters/matters-toolbar.test.tsx`

**Interfaces:**
- Consumes: Task 1 `billingTypeOf`, `BILLING_TYPE_LABEL`.
- Produces: filter field renamed `billingTypes: string[]` (URL param stays `fee` so saved links keep working); list rows expose `billingType: BillingTypeOrLegacy`; `FEE_LABELS` removed in favour of `BILLING_TYPE_LABEL`.

- [ ] **Step 1: Failing query tests:** filter `court_appointed` returns only `court_voucher` matters; filter `hourly` excludes `court_voucher` matters; both together return both; filter-options list includes `court_appointed` when such a matter exists; table/kanban label shows `Court-appointed`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the where clause: `OR` of `{ billingMode: "court_voucher" }` (if `court_appointed` selected) and `{ feeStructure: { in: rest }, billingMode: { not: "court_voucher" } }` (if any rest); AND it with the existing where without clobbering other `OR`s. Sort `fee` compares labels of `billingTypeOf`. Options: distinct on `[feeStructure, billingMode]`, mapped through `billingTypeOf`, deduped.
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(matters): filter list by billing type`.

### Task 8: Docs, cleanup, full verification

**Files:**
- Modify: `docs/features/time-and-billing.md`, `docs/features/matters.md`, `docs/ROADMAP.md` (one line)
- Create: `docs/decisions/060-billing-type-derived-court-appointed-is-hourly.md` (next free number — check), row in `docs/decisions/README.md`
- Modify: `src/lib/billing-mode-constants.ts` header comment (billing mode now set via billing type; fee_petition dormant)
- Delete: spec and this plan

- [ ] **Step 1:** `grep -rn "defaultBillingMode\|FEE_OPTIONS\|FEE_LABELS" src --exclude-dir=generated` → only the schema-generated types remain; fix stragglers.
- [ ] **Step 2:** Write the ADR (context: court-paid is hourly work with different payer/output; decision: derived type, two stored fields, lock + permission; consequences: fee petition needs its own switch; `defaultBillingMode` to drop). Update feature docs to end state.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → all pass.
- [ ] **Step 4:** Commit docs + deletions `docs(matters): billing types shipped`, then push to main (per workflow memory) once the hook passes.
