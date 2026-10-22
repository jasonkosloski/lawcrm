# Court-aware filings: court formats — design

**Date:** 2026-10-22
**Status:** Draft for review
**Tier:** Full (schema change; new permission keys)

## Goal

Filings generated for a matter come out in that court's format — caption, signature and certificate blocks, font, spacing, margins, page numbers and paper size — from one template. Project 4 of 4 in the templates programme (ADR-063 structured templates, ADR-064 one style → Word and PDF).

### What the user decided

- The firm files in several states' courts plus federal courts, so rules are data set up per court format, not hard-coded per state.
- **Shared court formats**: the firm defines a handful (e.g. "Colorado state courts", "D. Colo."); each venue picks one.
- **One template, court-specific blocks**: a template uses ordinary blocks (Caption, Signature, Certificate of service); a court format replaces blocks with its own. No per-court template variants.
- **No pleading paper** (line numbers) for now.
- Approach **A**: court formats override blocks (no new template node).

## Schema (expand-only)

New `CourtFormat` (`court_formats`):

| Field                          | Type             | Notes                                            |
| ------------------------------ | ---------------- | ------------------------------------------------ |
| `id`                           | String           | cuid                                             |
| `name`                         | String           | unique                                           |
| `courtSystem`                  | String           | `state` \| `federal` \| `other`; default `state` |
| `fontKey`                      | String?          | null = house style                               |
| `fontSizeHalfPt`               | Int?             | 20–28                                            |
| `lineSpacing`                  | String?          | `single` \| `1.15` \| `1.5` \| `double`          |
| `spaceAfterPt`                 | Int?             | 0–24                                             |
| `marginTopIn` … `marginLeftIn` | Decimal(3,2)? ×4 | 0.50–2.00                                        |
| `pageNumbers`                  | String?          | `none` \| `bottom_center` \| `bottom_right`      |
| `paperSize`                    | String           | `letter` (default) \| `legal`                    |
| `isActive`                     | Boolean          | default true                                     |
| `createdAt`, `updatedAt`       |                  |                                                  |

New `CourtFormatBlock` (`court_format_blocks`): `id`, `courtFormatId` (FK Cascade), `blockId` (FK → TemplateBlock, Restrict), `replacementBlockId` (FK → TemplateBlock, Restrict); `@@unique([courtFormatId, blockId])`. A row may not replace a block with itself.

`Venue` gains `courtFormatId String?` (FK → CourtFormat, SetNull) and `captionName String?`.

Permissions: `court_formats.add`, `court_formats.edit`, `court_formats.delete` (granted by migration to every role holding `documents.template.edit`). A venue's court format and caption name use the existing `venues.*` keys.

Deletion: a court format can't be deleted while any venue uses it ("This court format is used by: <venue names>. Archive it instead, or move those venues first."); archiving is allowed. A block can't be deleted while a court format references it as either side ("This block is used by court format(s): <names>. …").

Catalog: new field `matter.courtCaption` (text, matter scope) = venue `captionName`, else venue `name`, else null.

## Style resolution

`resolvePageStyle(kind, style, logo, court?)` — new optional `CourtFormatValues` argument. For `kind === "filing"` with a court format, each non-null court value replaces the house value (font, size, line spacing, space after, each margin, page numbers); `paperSize` comes from the court format (else `letter`). Letters ignore the court argument. `PageStyle` gains `paperSize: "letter" | "legal"`; the `.docx` sets page size (Letter 12240×15840 twips, Legal 12240×20160), the PDF uses `LETTER` / `LEGAL`, the preview page height follows (11 in / 14 in).

## Block replacement

`applyCourtBlocks(blocks: Map<string, BlockSource>, replacements: Map<string, string>, replacementSources: Map<string, BlockSource>): Map<string, BlockSource>` — pure: for each default block id with a replacement, the map entry for that id becomes the replacement's `BlockSource` (its name, content and `isActive`). Rendering is otherwise unchanged: archived replacements render the archived marker under the replacement's name; a missing replacement row is impossible (FK Restrict). Replacement block content is loaded alongside the referenced blocks (one query). Signer/recipient detection (`usesPrefix`) runs on the replaced map.

Applies only to filings for a matter whose venue has an active court format. An archived court format is ignored (house style, default blocks) and the generate dialog says "Court format <name> is archived — house style used."

## Generation and previews

`loadTemplateData` (or a sibling loader called after it, under the same access check) returns the matter's venue court format with its replacements; leads and venue-less matters return null. `previewDocumentFromTemplate` / `generateDocumentFromTemplate` pass it to `resolvePageStyle` and `applyCourtBlocks` for filings. The dialog shows "Court format: <name>" or "No court format — house style" under filing previews.

Template editor: filing templates get a "Preview as" select (House style + active court formats). Sample preview applies the chosen format client-side (formats and their replacement block content loaded by the editor page loader); real-record preview uses the record's venue format.

## Screens

- **Settings → Court formats** (`/settings/court-formats`, nav after Venues): list grouped by court system with venue counts; archive / restore / delete. Page authenticates itself; manage affordances behind the new keys.
- **Court format editor** (`/settings/court-formats/new`, `/[id]`): name, court system, each formatting setting with "Use house style" (clears it), paper size, **Block replacements** table (block → replacement block; active blocks plus any current archived ones), live sample filing page (`PagePreview`) in the format with the replacements applied. Save sends `expectedUpdatedAt`; stale copy "Someone else saved this court format — reload to see their changes." Read-only without `court_formats.edit` (or `.add` on new).
- **Venue form**: Court format select (active formats + the current one if archived, "None") and Caption name.

Actions in `src/app/actions/court-formats.ts`: `saveCourtFormat` (create needs `.add`, update `.edit`; zod ranges as above; replacement rows replaced wholesale in one transaction with the format update; refuses self-replacement and duplicate source blocks; atomic stale check), `setCourtFormatActive` (`.edit`), `deleteCourtFormat` (`.delete`, refused while venues use it). All log via the firm-scope settings helper and revalidate `/settings/court-formats` and `/settings/venues`. `venues.ts` save accepts `courtFormatId` and `captionName`.

## Testing

- `resolvePageStyle` with/without a court format; null fields keep house values; letters ignore it; `paperSize`.
- `applyCourtBlocks`: replacement in the template and inside inserted blocks; archived replacement marker uses the replacement's name; no replacements = identity.
- `.docx` Legal page size; PDF Legal page dimensions; preview height.
- Generation for a matter with a court-format venue (style + blocks applied; docx and pdf both) and without (unchanged); archived format ignored with the note.
- Actions: permission gates; stale refusal; self-replacement / duplicate refused; delete refused while venues use the format; block delete refused while a format references it; venue save with court format and caption name.
- UI: court format editor payload, "Use house style" clears a field, replacement table; venue form fields; "Preview as".

## Docs

ADR 065: court formats override blocks (vs. template slots), and why. `docs/features/documents.md`, `docs/features/settings-admin.md`, ROADMAP line, PERMISSIONS note.

## Out of scope

Pleading paper / line numbers, per-court template variants, court rule libraries shipped with the app, e-filing.
