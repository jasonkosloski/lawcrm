# Lead attorney and bar admissions — design

Status: approved in chat 2026-10-23. Tier: Full (new table, data backfill,
lead-pick rules on every matter entry point).

## Goal

Every matter has a lead attorney who is an attorney (holds a bar
admission). Attorneys can be admitted in several states. Document templates
can print the lead attorney, the matter's attorneys, and each one's bar
number for the right state.

## What exists (unchanged unless said)

- `MatterTeamMember.role` includes `lead` (label "Lead attorney"); at most
  one active lead; the team actions refuse to remove or demote the only
  lead. Matter create (`createMatter`, falls back to the current user) and
  lead conversion (`convertLeadToMatter`, the converter) always assign one.
- `User.barNumber`: one free-text number, no state, edited in Profile, Team →
  Edit member and Invite.
- Templates: `signer.barNumber`; a `team` list (name, email, phone, role).
- Firm and venue `state` are free text (usually a postal code).

## Decisions (from the user)

1. A printed bar number is the one for the matter's venue state.
2. "Attorneys on the matter" = active team members with role `lead`,
   `co_counsel` or `of_counsel`, lead first.
3. Existing `User.barNumber` values become admissions in the firm's state.
4. The lead must hold at least one bar admission.
5. Conversion picks the lead attorney in the convert dialog.
6. Existing matters whose lead has no admission are left alone, unflagged.

## 1. Data

- New model `BarAdmission { id, userId, state, number, createdAt }`, table
  `bar_admissions`. `state` is a two-letter postal code from
  `src/lib/us-states.ts`; `number` is trimmed text, 1–40 chars.
  `@@unique([userId, state])`; `onDelete: Cascade` from User;
  `@@index([userId])` is covered by the unique.
- `src/lib/us-states.ts`: `US_STATES` (50 states, DC, PR, GU, VI, AS, MP;
  code + name) and `stateCode(text): string | null` — case-insensitive
  code or full name, ignoring periods, extra spaces and case ("co", "C.O.",
  " colorado "); null otherwise (no informal abbreviations like "Colo.").
- Migration (expand-only): create the table, then backfill one row per
  user whose `barNumber` is non-blank, with `state` = the firm's state
  normalized in SQL (two-letter code uppercased, or full name via a CASE
  generated from `US_STATES`). No firm state, or an unrecognized one → no
  row; the number stays in the old column. `User.barNumber` is kept,
  no longer read or written by app code; dropping it is a later
  migration.

## 2. Editing admissions

- Profile, Team → Edit member and Invite replace the "Bar number" box with
  a "Bar admissions" repeater: state select + number, add / remove rows.
- Actions (`profile.ts`, `team.ts`) take `barAdmissions: {state, number}[]`
  (JSON in a hidden form field), validate (known state, number 1–40,
  no duplicate state, ≤ 60 rows) and replace the user's rows in the same
  transaction as the rest of the update. Existing permission gates; no
  new keys. The activity/settings log line names the change
  ("bar admissions updated") without numbers.
- `listTeamMembers`-style queries expose `barAdmissions` instead of
  `barNumber`.

## 3. Lead must be an attorney

One server helper, `isAttorney(userId)` / an `attorneyWhere` Prisma filter
(active user with ≥ 1 admission), used by every path that picks a lead:

- `createMatter`: the posted lead must qualify. The fallback to the
  current user applies only if the current user qualifies; otherwise the
  action returns a field error on `leadUserId`.
- `updateMatter` (lead change) and `addMatterTeamMember` with role
  `lead`: refuse a non-attorney with a field error. An unchanged lead is
  never re-validated (existing behaviour, and decision 6).
- `convertLeadToMatter`: new required `leadAttorneyId` form field; must
  qualify. The converter no longer becomes lead automatically; if the
  converter is on the intake team in another role or not at all, the
  existing carry-over rules still apply (the intake team joins; any intake
  `lead` other than the picked attorney joins as `co_counsel`). The SOL
  deadline owner follows the picked lead, where it followed the converter
  before.
- Pickers (new matter lead select, edit matter lead select, team
  management "Lead attorney" role option, convert dialog) list only
  attorneys. Convert dialog default: the converter if an attorney, else
  the intake team's only attorney, else empty. With no attorneys in the
  firm the picker shows "No one has a bar number yet — add one in
  Settings → Team." and the submit stays disabled.
- Deactivating a user is unchanged (an inactive lead stays lead).

## 4. Template fields

Bar number resolution: `barNumberFor(admissions, stateText)` picks the
admission whose state equals `stateCode(stateText)`; null otherwise (the
renderer prints its "[… — not on file]" marker). The state is the matter's
venue state; with no venue, or for lead-scoped records, the firm's state.

- Matter-scoped fields (group "Matter"):
  `matter.leadAttorney` (person type, name formats),
  `matter.leadAttorneyEmail`, `matter.leadAttorneyPhone`,
  `matter.leadAttorneyBarNumber`.
- List `attorneys` (matter scope): attorney-role team members, lead first,
  then by name; item fields name, email, phone, role, barNumber
  (`PersonItem` gains optional `barNumber`).
- `signer.barNumber` uses the same resolution.
- Sample data: a sample lead attorney and two attorneys with bar numbers.
- `load-data.ts` loads admissions for team users and the signer, and
  computes the resolved numbers once.

## Testing

- `us-states`: `stateCode` codes, names, case, periods, unknowns.
- Migration backfill: run against the test DB (code, full name, blank and
  unknown firm state).
- Actions: admission validation and replace; each lead path refuses a
  non-attorney and accepts an attorney; conversion with `leadAttorneyId`,
  defaults, intake carry-over.
- Catalog/load-data: lead fields, attorneys list order and filter, bar
  number by venue state, firm-state fallback, missing → null.
- UI: repeater add/remove/submit; pickers list only attorneys; empty
  states.

## Docs

- ADR-069 "Lead attorneys must hold a bar admission; bar numbers print by
  venue state" + README row.
- `docs/features/matters.md`, `settings-admin.md`, `documents.md`;
  `SCHEMA_NOTES.md` for the kept-but-unused `User.barNumber`.

## Out of scope

All of one person's numbers in one field; a primary admission; admission
dates/status; a warning on matters whose lead isn't an attorney.
