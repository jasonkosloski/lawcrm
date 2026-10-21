# Matter billing types — design

Tier: Full (schema + money-adjacent + new permission).

## Goal

Each practice area declares which **billing types** its matters may use and
which one is the default. A matter's billing type is chosen at creation
(new-matter form, lead conversion) from that list and is locked afterwards;
only holders of a new permission may change it.

## Decisions

- **Billing types:** `hourly`, `flat`, `contingent`, `court_appointed`,
  `pro_bono` (labels: Hourly, Flat fee, Contingency, Court-appointed,
  Pro bono). `hybrid` is no longer offered; existing hybrid matters keep it
  and display "Hybrid".
- **Court-appointed is a billing type but not a fee structure.** It is hourly
  work with a different payer and output (agency voucher, statutory rate,
  caps). Stored as `feeStructure = hourly` + `billingMode = court_voucher`,
  so hourly math never special-cases it.
- **Billing type is derived, not stored on Matter.** No new Matter column;
  the type is read from the existing two fields. Avoids a third copy of the
  same fact drifting. (Record as an ADR.)
- **Locked after creation.** Changing it needs `matters.billing_type.edit`
  (Admins have it implicitly). The override may pick any billing type, not
  only the area's allowed list.
- **Fee petition** is out of scope. Its billing-mode select disappears;
  matters already on `fee_petition` keep the value and read as their fee
  structure's type. It returns later as its own matter switch.

## Mapping — `src/lib/billing-type.ts` (client-safe)

- `BILLING_TYPES`, `BillingType`, `BILLING_TYPE_LABEL`, `BILLING_TYPE_OPTIONS`.
- `billingTypeFields(type) → { feeStructure, billingMode }`:
  - `court_appointed` → `hourly` + `court_voucher`
  - `pro_bono` → `pro_bono` + `none`
  - otherwise → same-named fee structure + `client`
- `billingTypeOf({ feeStructure, billingMode })`: `court_voucher` →
  `court_appointed`; otherwise `feeStructure` (may be legacy `hybrid`, so the
  return type is `BillingType | "hybrid"`, labelled "Hybrid").
- Hand-copied fee lists (lead-conversion `FEE_OPTIONS`, zod enums in
  `matters.ts` / `leads.ts`) import from here instead.

## Schema (expand-only migration)

- `PracticeArea.allowedBillingTypes String[] @default(["hourly","flat","contingent","court_appointed","pro_bono"])`
- `PracticeArea.defaultBillingType String @default("contingent")`
- Backfill `defaultBillingType` from `defaultBillingMode`: `court_voucher` →
  `court_appointed`, `none` → `pro_bono`, else `contingent`.
- `defaultBillingMode`: no code reads it; mark DEPRECATED in the schema
  comment; drop in a later migration.

## Practice-area settings

- Edit form: replace "Default billing mode" select with a **Billing types**
  checkbox group plus a **Default** select limited to the checked types.
  Unchecking the current default moves it to the first checked type.
- Server (`practice-areas.ts`, create + update): at least one type; every
  value in `BILLING_TYPES`; default ∈ allowed. Activity log line records the
  allowed list and default change. Existing practice-area permission.
- Narrowing an area never touches existing matters.

## Matter creation

- **New-matter form:** "Fee structure" → **Billing type**, options = selected
  area's allowed types, preselect area default; on area change, reset to the
  new default if the current value isn't allowed. Area options carry
  `allowedBillingTypes` + `defaultBillingType`.
- **`createMatterAction`:** `resolveAreaAndStage` also returns the allowed
  list. Disallowed type → field error "Not offered for this practice area".
  Write `billingTypeFields(type)`; stop snapshotting `defaultBillingMode`.
- **Lead conversion** (`convert-lead-button.tsx`,
  `convertLeadToMatterAction`): same option filtering, default, and
  in-transaction server check.

## Matter edit

- One **Billing type** field replaces the fee-structure and billing-mode
  selects.
- Without `matters.billing_type.edit`: read-only text ("Court-appointed · set
  at creation"); no input submitted.
- With it: select of all billing types (plus current legacy Hybrid when
  applicable). Change logged ("billing type hourly → court-appointed").
- `updateMatterAction`: billing fields applied only with the permission; a
  submitted value that differs from the stored type without the permission
  is rejected. Practice-area change does not alter billing type.

## Permission

- `matters.billing_type.edit` in `src/lib/permissions.ts` (matters category),
  description: change a matter's billing type after creation; logged.

## Matters list

- Fee-structure filter (`matters-filters.ts`, toolbar, table/kanban labels)
  becomes billing type, so Court-appointed is its own filter value. Filtering
  by `court_appointed` queries `billingMode = court_voucher`; other types
  query `feeStructure` with `billingMode != court_voucher`.

## Testing

- Unit: `billingTypeFields` / `billingTypeOf` round-trip, legacy hybrid,
  `fee_petition` reads as fee structure.
- Actions: create and convert reject a disallowed type and write both
  fields; update without the permission rejects a change and keeps fields;
  with it, changes and logs; practice-area validation (empty list, default not
  in list).
- Components: new-matter area switch resets type; edit form read-only vs
  select by permission; practice-area default follows checkboxes.
- Filters: court-appointed vs hourly separation.

## Docs

- `docs/features/time-and-billing.md`, `docs/features/matters.md`, ROADMAP
  line, new ADR (derived billing type; court-appointed = hourly + voucher)
  with its `decisions/README.md` row. Delete this spec and its plan in the
  finishing commit.
