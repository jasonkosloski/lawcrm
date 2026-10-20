# /matters/new v2, sub-project 1: venues, name template, dates, required fields

Status: design approved in chat 2026-10-20; awaiting spec review.
Tier: Full (schema change).

`/matters/new` v2 is split into three sub-projects, each with its own
spec, plan and build:

1. **This spec:** case location as a firm venue list, a configurable
   matter-name template, filed/trial date pickers, per-practice-area
   required fields, mobile layout.
2. Retainer + trust deposit at intake (money; separate spec).
3. Save draft and resume (last, because it must persist every field 1
   and 2 add).

## Goal

Matters are entered **consistently** (the same venue is always the same
record; names follow the firm's pattern) and **completely** (the fields
a practice area depends on cannot be skipped at creation).

Success looks like:
- A firm admin defines the venues, the firm's default name template,
  and per-area template overrides and required fields, all in Settings.
- Creating a matter offers venues from that list, builds the name from
  the template that applies, and refuses to save while a required field
  is empty, on both the client and the server.
- Filed and trial dates can be set on create and on edit.
- The form is usable on a phone.

Out of scope: retainer/trust (sub-project 2), drafts (sub-project 3),
new duplicate/date-sanity warnings (the user said validation is not the
problem), stage-based required fields, structured location filtering or
reports by county.

## Current state

- The form's "Case location" input feeds the auto name only; it is never
  stored (`new-matter-form.tsx`).
- `Matter.filedDate` / `Matter.trialDate` exist and display on the
  matter page, but no form sets them.
- The name pattern `Last, First - Case Number - Location` is hard-coded
  in `src/lib/matter-name.ts` (`buildAutoMatterName`).
- `Firm.state` exists (primary office address).
- The app is single-firm (see the schema note near `Firm`); new tables
  follow `PracticeArea` and carry no `firmId`.

## Data model

New model:

```prisma
model Venue {
  id        String   @id @default(cuid())
  name      String   /// Display name as typed, e.g. "Aurora"
  nameKey   String   @unique /// lower(trim(name)); case-insensitive uniqueness
  city      String?
  county    String?
  state     String   /// Two-letter US state; inline add defaults to Firm.state
  isActive  Boolean  @default(true) /// Archived venues stay on existing matters
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  matters   Matter[]
  @@map("venues")
}
```

`nameKey` is a plain column, not a functional index, so the uniqueness is
expressible in Prisma and the duplicate check is a normal P2002.

Changes to existing models:

- `Matter.venueId String?` → `Venue` (`onDelete: Restrict`), indexed.
  No backfill: location text was never stored.
- `Firm.matterNameTemplate String` with default
  `{client_last}, {client_first} - {case_number} - {location}` (today's
  pattern, so behavior is unchanged until someone edits it).
- `PracticeArea.matterNameTemplate String?`: null inherits the firm's.
- `PracticeArea.requiredMatterFields String[] @default([])`.

## Name template

A pure module, `src/lib/matter-name-template.ts`, shared by the form,
the settings preview and the settings actions:

- `MATTER_NAME_TOKENS`: `client_first`, `client_last`, `client_full`,
  `case_number`, `location` (venue name), `county`, `state`,
  `opposing_party`, `practice_area`, `year` (creation year, firm's local
  calendar).
- `parseTemplate(t)` → literal and token segments, or errors for unknown
  tokens, unbalanced braces, or a template with no tokens.
- `renderTemplate(t, values)` → string. Today's rule generalized: an
  empty token is dropped **together with the literal separator before
  it** (or after it, when it is the first token), then whitespace and
  separators are collapsed and trimmed. So
  `{client_last}, {client_first} - {case_number} - {location}` with no
  case number renders `Alvarez, Maria - Aurora`, matching today.
- Client first/last come from the existing `splitName` and
  `looksLikeOrganization`. An organization fills `client_last` and
  `client_full` and leaves `client_first` empty, so
  `{client_last}, {client_first}` renders just the org name.
- `buildAutoMatterName` / `autoMatterName` are removed. Their unit tests
  become renderer tests against the default template, so today's output
  is pinned.

Effective template: `area.matterNameTemplate ?? firm.matterNameTemplate`.

## Required fields

Fixed keys, in a `src/lib/matter-required-fields.ts` constant with
labels: `venue`, `caseNumber`, `court`, `filedDate`, `trialDate`,
`incidentDate`, `opposingParty`, `opposingFirm`, `description`,
`client`. Client and lead attorney are already required on every
matter; `client` is listed only so an area can make it explicit, and is
a no-op otherwise.

- **Create:** every required key must be non-empty; the server checks it
  inside the `createMatter` transaction against the area it reads there,
  not against anything the client sent.
- **Edit ("can't clear, don't block"):** a required field that currently
  has a value cannot be saved empty; one that is already empty may stay
  empty, and the rest of the edit saves. When the edit changes the
  practice area, the new area's list applies with the same rule.
  Rationale: tightening an area's rules must not make older matters
  unsavable. Recorded in the new ADR.

## Permissions

New keys in `src/lib/permissions.ts`: `venues.add`, `venues.edit`,
`venues.delete`. No `venues.view`: anyone with `matters.create` or
`matters.edit` can pick from the list, and the Settings → Venues page
needs at least one of the three keys. `venues.add` also gates
press-Enter-to-add on the matter forms.

Templates and required fields: the per-area fields under
`firm.manage_practice_areas`; the firm default under `firm.edit_info`.

Defaults: Admin gets all three venue keys; roles that have
`matters.create` get `venues.add`. `docs/PERMISSIONS.md` is updated.

## Server actions

`src/app/actions/venues.ts` (new): `createVenue`, `updateVenue`,
`archiveVenue` / `unarchiveVenue`, `deleteVenue`. Each is
permission-gated, logged with `logActivity`, and revalidates
`/settings/venues` and `/matters/new`.

- `createVenue` maps a P2002 on `nameKey` to
  `{ ok: false, code: "exists", venue }` so the combobox selects the
  existing venue. This also resolves two users adding the same name at
  once.
- `deleteVenue` refuses when any matter references the venue and tells
  the user to archive it instead (`archiveVenue` is the normal path).

`src/app/actions/matters.ts`:

- `createMatter` accepts `venueId`, `filedDate`, `trialDate`; rejects a
  missing or archived venue; enforces required fields (above); stores
  the name as submitted (the template is a client-side convenience).
  The ADR-054 conflict gate is unchanged.
- `updateMatter` accepts the same three fields. An archived venue is
  accepted only if it is the matter's current venue. Venue and date
  changes are logged with old → new values. Enforces the edit rule.
- Dates are UTC-midnight calendar dates (ADR-012). The existing date
  parsing helpers are used.

Settings actions (existing practice-area and firm-info actions) accept
`matterNameTemplate` and `requiredMatterFields`, validated with
`parseTemplate` and the fixed key list.

## UI

**Venue combobox** (`src/components/matters/venue-combobox.tsx`, used by
the new and edit forms):
- Searches active venues by name (client-side filter; the list is
  firm-sized and loaded by the page). Each row shows `name · city,
  county, ST`.
- With `venues.add` and no exact (case-insensitive) match, the last row
  is "Press Enter to add 'X'". Enter opens a popover with name
  prefilled, state (required, defaults to `Firm.state`), and optional
  city and county. Save calls `createVenue` and selects the result.
- Without `venues.add`: "No venue matches. Ask an admin to add it." No
  free text is stored.
- On the edit form an archived current venue shows as "Name (archived)".

**New matter form:**
- The venue combobox replaces the location input. The page loads active
  venues, the firm template, each area's template override and required
  fields, and `canAddVenue`.
- The auto name renders from the effective template. Dirty-tracking and
  "Reset to auto" are unchanged; changing the area switches template
  (and re-renders unless the name is dirty). The hint under the name
  shows the effective template instead of the hard-coded pattern.
- Details section gains Filed date and Trial date pickers.
- Required fields for the selected area show an asterisk and "Required
  for {area}". Submitting with any empty shows inline errors and scrolls
  to the first.
- Mobile (below `sm`): single column; two-up rows stack; pickers and
  popovers go full width; the submit bar sticks to the bottom.

**Edit matter form:** gains the venue combobox and filed/trial dates,
and shows required markers with the edit rule.

**Settings → Venues** (`/settings/venues`, new): table (name, city,
county, state, matter count, status) with add, edit, archive/unarchive,
and delete (only at zero matters). Gated per the keys above. Added to
the settings nav.

**Settings → Practice areas:** each area gains a "Matter name" field
(blank = firm default, shown as placeholder) with a live preview against
sample values, and a "Required at creation" checklist.

**Settings → Firm:** "Default matter name" template field with the same
preview and a token reference.

## Testing

- `matter-name-template.test.ts`: every token; separators dropped with
  empty tokens at the start, middle and end; org and suffix names;
  parse errors; the default template reproduces every old
  `buildAutoMatterName` case.
- `venues.test.ts`: each action's permission gate; P2002 → `exists`;
  delete refused while referenced; archive/unarchive; activity rows.
- `matters.test.ts`: create rejects missing required fields (one per
  key type: string, date, venue); rejects archived or unknown venue;
  persists venue and dates. Edit: can't clear a filled required field;
  may leave an empty one empty; area change applies the new list;
  archived current venue accepted, archived other venue rejected.
- Settings action tests: bad templates and unknown required keys are
  rejected.
- Form interaction tests: Enter to add with and without `venues.add`;
  `exists` selects the existing venue; required markers follow the
  selected area; template switches with area unless the name is dirty;
  date pickers submit date-only values.
- Page tests: `/settings/venues` authenticates itself and gates.
- `npm run check:migrations` passes.

## Docs (same commit as the feature lands)

- `docs/features/matters.md`: move the shipped items out of the v2
  follow-up line; `docs/ROADMAP.md` line updated.
- `docs/features/settings-admin.md`: Venues page, template and required
  fields settings.
- New ADR-055: venues are a firm list (no free-text location); required
  fields are per area, enforced on create, and can't be cleared but
  don't block on edit. Row in `docs/decisions/README.md`.
- `docs/SCHEMA_NOTES.md`: `Venue.nameKey` for case-insensitive
  uniqueness.
- `docs/PERMISSIONS.md`: the three venue keys.
- Delete this spec and its plan in the commit that finishes the feature.
