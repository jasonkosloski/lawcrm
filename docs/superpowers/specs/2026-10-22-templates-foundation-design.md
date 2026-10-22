# Templates foundation: one structured format for every template — design

**Date:** 2026-10-22
**Status:** Draft for review
**Tier:** Full (schema change; touches document storage and matter/lead scope)

## Goal

Templates become the daily document tool: real formatting, reusable pieces, lists and optional sections, usable from matters and leads. This is project 1 of 4; it fixes the format and engine every later project renders from.

### The four projects

1. **Foundation** (this spec): template format, editor, block library, field catalog, engine, generation from matters and leads, plain .docx output.
2. **Letters out:** firm house style (font, size, spacing, margins, letterhead placement) applied to .docx, plus PDF output.
3. **Emails and texts:** email templates in compose/reply; text templates ready for when an SMS provider exists.
4. **Court-aware filings:** venues gain a court system; per-court formatting rules (caption layout, pleading paper, spacing) and per-court template variants.

Later, unscheduled: template versioning, per-practice-area defaults, Word-file template upload.

### What the user decided

- One template system for letters, emails, texts and filings, as consistent as possible.
- Authored in the app, not uploaded Word files (maybe later).
- Highly customizable per firm. Formatting lives in a firm **house style**, overridden by **court rules** for filings; templates hold content only and never carry their own formatting (house style is project 2, court rules project 4).
- A firm-editable **block library** (letterhead, signature, closing, certificate of service, …).
- Logic: **fields + lists + simple conditions**; no free-form expressions.
- Templates work on **matters and leads**.
- Storage approach **A**: the editor's structured document (TipTap/ProseMirror JSON) with real field, block and logic nodes, not text tags.

## Schema

`DocumentTemplate` (existing table, expand-only migration):

| Field       | Type    | Notes                                                                                                   |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `kind`      | String  | `letter` \| `email` \| `sms` \| `filing`; default `letter` (backfills existing rows).                   |
| `content`   | Json?   | Structured document. Null only on legacy rows not yet converted.                                        |
| `subject`   | Json?   | Email only: one inline line (text + field nodes).                                                       |
| `appliesTo` | String  | `matter` \| `lead` \| `both`; default `matter` (today's templates are matter-only).                     |
| `body`      | String? | Existing column, relaxed to nullable. Legacy plain text; dropped by a later migration once all convert. |

`category`, `isActive`, `RecordsRequestType.defaultTemplateId` unchanged.

New `TemplateBlock` (`template_blocks`):

| Field         | Type    | Notes                                                    |
| ------------- | ------- | -------------------------------------------------------- |
| `id`          | String  | cuid                                                     |
| `key`         | String  | unique slug (e.g. `signature`); what templates reference |
| `name`        | String  |                                                          |
| `description` | String? |                                                          |
| `content`     | Json    | Same format as templates, minus block nodes              |
| `isActive`    | Boolean | archive flag                                             |
| `createdById` | String? | FK → User, SetNull                                       |
| timestamps    |         |                                                          |

Templates reference blocks by `id` inside `content` (not a join table); "used by" is computed by scanning template content. The block count is small, so this stays cheap, and it keeps content the single source of truth.

The migration seeds two blocks, **Letterhead** (`firm.name`, address, phone, email) and **Signature** (`signer.name`, title, bar number, firm), if absent.

## Document format

ProseMirror JSON with a template-specific extension set (separate from `createEditorExtensions()`, which serves notes/email and stays unchanged):

- Prose: paragraph, heading (1–3), bold, italic, underline, text alignment, bullet/ordered lists, table (rows/cells, no merged cells in v1), hard break, page break.
- `field` (inline atom): `{ path: "client.name", format: "full" }`.
- `block` (block atom): `{ blockId }`.
- `showIf` (block container): `{ path, op: "present" | "empty" | "true" | "false" | "in", values?: string[] }`.
- `repeat` (block container): `{ list: "parties.defendants" }`, with an optional `empty` child holding "if none" content. Inside it, `item.*` fields resolve against the current element.
- `listField` (inline atom): `{ list, itemPath: "name", join: "and" | "oxford_and" | "lines" }`.

`kind = sms` allows only paragraph, hard break and `field`. `kind = email` disallows page break.

A zod schema (`src/lib/templates/schema.ts`) validates content on every save: allowed nodes per kind, depth cap, size cap (256 KB serialized). The client editor and the server share it.

## Field catalog

One typed catalog (`src/lib/templates/catalog.ts`) replaces the flat list in `template-merge.ts`. Each entry has a path, label, group, type (`text | date | boolean | enum | address | person`), the scopes it is valid in (`matter`, `lead`), the formats it allows, and a sample value.

Groups:

- **Firm** `firm.*`; **Today** `today`; **User** `user.*` (the person generating).
- **Matter** `matter.*` (name, case number, court, venue name/city/county/state, practice area, stage, incident date, SOL date, filed date, trial date): matter scope only.
- **Lead** `lead.*` (name, incident date, location, source, summary, stage): lead scope only.
- **Client** `client.*` (name, address, email, phone, organization): both scopes. On a lead, the client is the lead's linked contact, falling back to the lead's own name/email/phone.
- **Signer** `signer.*` (name, title, bar number, email, phone). Defaults to the user generating; switchable at generation to any team member of the record.
- **Recipient** `recipient.*` (name, company, address, email). Chosen at generation from the record's contacts; only asked for when the template uses it.
- **Parties** (lists): `parties.clients`, `parties.opposing`, `parties.defendants`, `parties.plaintiffs`, `parties.opposingCounsel`, `parties.witnesses`, `parties.experts` (matter scope, built from `MatterContact` category/role) and `team` (both scopes; `MatterTeamMember` / `LeadTeamMember`). Items expose `item.name`, `item.address`, `item.email`, `item.phone`, `item.role`, and for opposing parties `item.counsel.*` (from the representation fields).
- **Request** `request.*` (records requests, as today).

Formats per type: dates `long | short | iso`; names `full | first | last` (first/last split the stored single `name` on the last space; organizations always render full); text `as_is | upper`; addresses `block | one_line`.

Contacts have no salutation, birth date or minor flag today; adding them is a separate change, so a "formal" name format and "client is a minor" conditions wait for it.

`appliesTo = both` allows only fields valid in both scopes.

## Engine

`src/lib/templates/render.ts`, pure and synchronous:

```ts
renderTemplate(content, { blocks, data, scope }) → { doc: ResolvedDoc, report: RenderReport }
```

- Resolves fields with their format; inlines blocks (blocks may not contain blocks, so no recursion); evaluates `showIf`; expands `repeat` and `listField`.
- `RenderReport`: `missing[]` (known field, no data), `invalid[]` (unknown path or wrong scope), `archivedBlocks[]`.
- Never silent: a missing field renders as a marked `[Client address — not on file]` run; an archived or deleted block as `[Signature block — archived]`.
- `ResolvedDoc` is plain prose (no field/logic nodes). Converters read it:
  - `toHtml` (preview, later email bodies), sanitized with the document profile.
  - `toPlainText` (copy, later SMS).
  - `toDocx` (saved file; uses the `docx` npm package; default font, no house style until project 2).

Data loading is server-only (`src/lib/templates/load-context.ts`): `loadTemplateData({ scope, recordId, signerId?, recipientContactId?, requestId? })` calls `assertMatterAccess` / `assertScopeAccess` before any query, and checks the signer is on the record's team and the recipient is one of its contacts.

## Legacy conversion

`convertLegacyBody(body)` turns plain text into paragraphs and `{{token}}` into `field` nodes (mapping old keys to catalog paths; unknown tokens stay as literal text and show in the report). It runs when a legacy template is opened in the editor and on generation from an unconverted template. Saving writes `content`. No bulk rewrite at deploy.

## UI

**Settings → Templates** (`/settings/templates`): tabs **Templates** (list filterable by kind and applies-to) and **Blocks**.

**Template editor page** (`/settings/templates/[id]`, `/settings/templates/new`): replaces the dialog.

- Left: the document with a toolbar (headings, bold, italic, underline, alignment, lists, table, page break) and **Insert**: Field, Block, Show if, Repeat for each.
- Field chips read `Client name · full`; click to change the format.
- Block nodes render the block's content shaded, read-only, with "Edit block".
- Show if / Repeat render as outlined sections whose header states the rule in words; click the header to edit it.
- Right: live preview against sample data or a real matter/lead picked by search; warnings listed under it.
- Kind changes the editor: SMS is plain with a character and segment count; email adds the subject line.
- Changing `appliesTo` flags now-invalid fields; save is blocked until they're fixed.
- Field picker: searchable, grouped, plain labels, with an example value from the current preview record.

**Block editor** (`/settings/templates/blocks/[id]`): same page without block insertion; shows "Used by N templates" with links.

Template editing is desktop-only: under the desktop breakpoint the pages show a read-only preview and "Edit on a larger screen". Generation works on any screen size.

## Generation flow

Matter Documents tab and lead Documents tab, "Generate from template":

1. Pick a template: active `letter`/`filing` templates whose `appliesTo` fits, grouped by category.
2. Signer and recipient pickers, shown only if the template uses them.
3. Preview with the report.
4. **Copy text** or **Save to documents** in the current folder as `<template> — <date>.docx` (`source: "generated"`).

The preview call returns the template's `updatedAt`; save re-renders on the server and refuses with "This template changed — review the preview again." if it differs. Records-request letters use the same engine and flow with `request.*` data; request-type default templates are unchanged.

## Permissions and logging

Existing keys cover templates and blocks: `documents.template.create/edit/delete`; generating needs `documents.upload` as today. Block deletion is refused while any template references it (the error lists them); archive is always allowed. Template and block create, edit, archive and delete log via `logActivity`; each generated document logs on its matter or lead.

## Testing

- Engine: each field type and format, show-if ops, repeat with and without the empty branch, list joins, missing data, archived blocks, scope fit, legacy conversion.
- Content schema: allowed nodes per kind, depth and size caps.
- `toDocx`: output parses (unzip + `document.xml` contains the text) and previews through `docx-preview`.
- Actions: permission gates, ethical walls via the loader, signer/recipient checks, the template-changed refusal, block-delete refusal.
- Editor: inserting chips, blocks and sections, editing a rule, appliesTo invalidation.

## Docs

- ADR: templates are structured documents; formatting layers firm house style → court rules; no Word upload or free-form logic (and why).
- `docs/features/documents.md`: template section rewritten to end state; follow-ups list projects 2–4.
- `docs/ROADMAP.md`: "Template follow-ups" line replaced by the four projects.

## Out of scope

House style, PDF, letterhead placement (project 2). Email/SMS use (project 3). Courts (project 4). Versioning, practice-area defaults, Word upload, merged table cells, "or" conditions, comparisons, math.
