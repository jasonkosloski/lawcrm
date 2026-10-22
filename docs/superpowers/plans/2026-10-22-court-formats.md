# Court Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firm-defined court formats (formatting overrides, paper size, block replacements) that venues pick, applied to filings generated for a matter in that venue, in `.docx`, PDF and previews.

**Architecture:** A `CourtFormat` row resolves to `CourtFormatValues` plus a replacement map. The single page-rendering entry point (`renderPage` / `renderPageView` in `src/lib/templates/page-render.ts`) gains an optional `court` input: for filings it passes the values to `resolvePageStyle` (which now also yields `paperSize`) and swaps blocks via a pure `applyCourtBlocks` before rendering. Every generation and preview path already funnels through `renderPage`, so wiring is one loader plus one argument.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before routes), Prisma 7 / Postgres, `docx@9`, `@react-pdf/renderer@4.9.0`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-court-formats-design.md`

## Global Constraints

- Follow `AGENTS.md`: server actions in `src/app/actions/`, `requirePermission`, `logActivity` (firm-scope settings helper for settings changes), `revalidatePath`; pages authenticate themselves (ADR-028); record reads behind `assertScopeAccess`.
- Migration expand-only (ADR-058). Generate SQL by deploying existing migrations to a local scratch DB on the Docker Postgres (`lawcrm-test-postgres`, `lawcrm_test`/`lawcrm_test`, :5433) and running `prisma migrate diff` against it; never `migrate dev`, never a non-localhost DB. `npm run check:migrations`.
- Permission keys `court_formats.add`, `court_formats.edit`, `court_formats.delete` (labels "Add court formats", "Edit court formats", "Delete court formats"), granted by migration to every role holding `documents.template.edit`.
- Ranges (nullable on court formats; null = house style): font key in `FONT_KEYS`; `fontSizeHalfPt` 20–28; `lineSpacing` `single|1.15|1.5|double`; `spaceAfterPt` 0–24; margins 0.50–2.00 (2 decimals); `pageNumbers` `none|bottom_center|bottom_right`; `paperSize` `letter|legal` (default `letter`); `courtSystem` `state|federal|other` (default `state`).
- Page sizes: Letter 12240×15840 twips / 612×792 pt / 8.5×11 in; Legal 12240×20160 twips / 612×1008 pt / 8.5×14 in.
- Court formats apply only to `kind === "filing"` for a matter whose venue has an **active** court format. Letters, emails, texts, leads, venue-less matters: unchanged.
- Copy, verbatim: format delete refusal `This court format is used by: <venue names>. Archive it instead, or move those venues first.`; block delete refusal `This block is used by court format(s): <names>. Remove it there first.`; stale `Someone else saved this court format — reload to see their changes.`; dialog notes `Court format: <name>`, `No court format — house style`, `Court format <name> is archived — house style used.`; self-replacement `A block can't replace itself.`; duplicate `Each block can be replaced only once per court format.`
- Tests need the Docker test DB. Commit with `git add -- <paths>` then `git commit -m "…" -- <paths>`; never `--no-verify`; `npm run format -- <files>`.

## Review Focus

1. **Archived replacement block or archived court format** — archived replacement renders the archived marker under the replacement's name; archived format is ignored with the dialog note. Tests in Tasks 3 and 5.
2. **Lead or venue-less matter generating a filing** — no court lookup, house style unchanged, no crash. Test in Task 5.
3. **Replacement rows edited concurrently with a format save** — rows are replaced wholesale inside the same transaction as the stale-checked update; a stale save writes nothing. Test in Task 4.
4. **Deleting a block used by a court format** (either side) — refused with copy; FK Restrict is the backstop. Test in Task 4.
5. **Legal paper in all three outputs** — `.docx` `w:pgSz` 20160, PDF page height 1008 pt, preview page 14 in. Tests in Task 2.

---

### Task 1: Schema, migration, permission keys

**Files:** Modify `prisma/schema.prisma` (new `CourtFormat`, `CourtFormatBlock`; `Venue.courtFormatId`, `Venue.captionName`; back-relations on `TemplateBlock`), `src/lib/permissions.ts`, `src/test/integration-helpers.ts` (`TABLES_IN_DELETE_ORDER`); Create `prisma/migrations/<ts>_court_formats/migration.sql` (timestamp after `20261022150000`); Test `src/lib/templates/court-format-schema.test.ts`.

**Interfaces — Produces:** models per the spec's Schema section (`@@map("court_formats")`, `@@map("court_format_blocks")`, `@@unique([courtFormatId, blockId])`, FKs: format Cascade, both block FKs Restrict with distinct relation names, Venue.courtFormatId SetNull); permission entries in a new `court_formats` group (or the existing templates/documents group — follow the file's grouping).

- [ ] **Step 1: Failing test:** create a `CourtFormat` with only `name` → defaults (`courtSystem` state, `paperSize` letter, all overrides null, active); duplicate name → P2002; duplicate (format, block) → P2002; deleting the format cascades its rows; deleting a referenced block throws P2003; deleting a format nulls `Venue.courtFormatId`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Schema + migration** (append the permission grant, pattern `20261021120000_documents_edit_permission`). Verify on a fresh scratch DB (record output; drop it). **Step 4: Run** test + `npm run check:migrations` — PASS.
- [ ] **Step 5: Commit** `feat(court-formats): schema and permission keys`.

### Task 2: Court values in the page style and Legal paper

**Files:** Modify `src/lib/templates/page-style.ts`, `to-docx.ts`, `to-pdf.tsx`, `to-html.ts` / `src/components/templates/page-preview.tsx`; tests beside each.

**Interfaces — Produces:**

- `page-style.ts`: `type PaperSize = "letter" | "legal"`; `PAPER_SIZES`; `COURT_SYSTEMS`; `type CourtFormatValues = { fontKey: FontKey | null; fontSizeHalfPt: number | null; lineSpacing: LineSpacing | null; spaceAfterPt: number | null; marginTopIn…marginLeftIn: number | null; pageNumbers: PageNumberPosition | null; paperSize: PaperSize }`; `PageStyle` (and `PageStyleOf`) gain `paperSize: PaperSize`; `resolvePageStyle(kind, style, logo, court?: CourtFormatValues | null)` — filings take each non-null court value; letters ignore `court`; `paperSize` = filing && court ? court.paperSize : "letter". Export `PAGE_DIMENSIONS: Record<PaperSize, { twips: { w; h }; pt: { w; h }; in: { w; h } }>` with the constraint values.
- Converters read `style.paperSize` for page size (docx `page.size`, PDF `size`, preview page height).

- [ ] **Step 1: Failing tests:** resolve with a court format: overrides applied for filings, null keeps house values, letter ignores; `.docx` Legal → `w:pgSz w:w="12240" w:h="20160"`; PDF Legal → first page height 1008 pt (pdf-lib); preview min-height uses 14 in.
- [ ] **Step 2–4:** FAIL → implement → PASS (existing converter/preview tests stay green: default `paperSize` letter).
- [ ] **Step 5: Commit** `feat(court-formats): court values and Legal paper in the page style`.

### Task 3: Block replacement, court context, caption field

**Files:** Create `src/lib/templates/court-blocks.ts` (pure), `src/lib/templates/court-context.ts` (server-only loader); Modify `src/lib/templates/page-render.ts`, `src/lib/templates/catalog.ts` (+ `load-data.ts` for the caption value); tests beside each.

**Interfaces — Produces:**

- `applyCourtBlocks(blocks: Map<string, BlockSource>, replacements: ReadonlyMap<string, BlockSource>): Map<string, BlockSource>` — returns a new map where each key present in `replacements` maps to the replacement source; others unchanged.
- `type CourtContext = { id: string; name: string; isActive: boolean; values: CourtFormatValues; replacements: Map<string, BlockSource> }` (replacements keyed by the default block id).
- `loadCourtContext(scope: RecordScope): Promise<CourtContext | null>` — `assertScopeAccess(scope)` first; lead → null; matter → venue's court format with replacement block sources (one query for rows + replacement blocks); none → null.
- `renderPage` / `renderPageView` input gains `court?: CourtContext | null`; for filings with an **active** court: `resolvePageStyle(kind, style, logo, court.values)` and blocks = `applyCourtBlocks(blocks, court.replacements)` before rendering body, letterhead, continuation; the replaced map is what signer/recipient detection should use (export a helper `effectiveBlocks(kind, blocks, court)` used by callers that run `usesPrefix`).
- Catalog: `matter.courtCaption` (label "Court caption", text, matter scope) = venue `captionName` ?? venue `name` ?? null; `TemplateData.matter.courtCaption`; sample value "DISTRICT COURT, CITY AND COUNTY OF SAMPLE, STATE OF EXAMPLE".

- [ ] **Step 1: Failing tests:** applyCourtBlocks identity with no replacements; replacement in template body and inside an inserted block (render through `renderPage`); archived replacement renders `[<Replacement name> block — archived]` and reports that name; inactive court → house style and default blocks; letters ignore court; loader: lead → null, matter without venue → null, with venue+format → values and replacements, walled matter → access refusal; `matter.courtCaption` falls back to venue name.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(court-formats): block replacement and court context`.

### Task 4: Court format actions, venue fields, block protection

**Files:** Create `src/app/actions/court-formats.ts` (+ test); Modify `src/app/actions/venues.ts` (+ test), `src/app/actions/template-blocks.ts` (+ test).

**Interfaces — Produces:**

- `saveCourtFormat(input: { id?: string; name: string; courtSystem; fontKey: … | null; fontSizeHalfPt: number | null; lineSpacing: … | null; spaceAfterPt: number | null; marginTopIn…: number | null; pageNumbers: … | null; paperSize; replacements: { blockId: string; replacementBlockId: string }[]; expectedUpdatedAt?: string }): Promise<{ ok: true; id: string; updatedAt: string } | { ok: false; error: string }>` — create `.add`, update `.edit`; zod per constraints; block ids exist (archived allowed); self-replacement and duplicate source refused (copy); update = `updateMany` stale-checked on `updatedAt` + `deleteMany`/`createMany` of rows in one `$transaction` (stale → nothing written); duplicate name → friendly `A court format with that name already exists.`; log + revalidate.
- `setCourtFormatActive(id, active)` (`.edit`), `deleteCourtFormat(id)` (`.delete`, refused while venues use it, copy).
- `venues.ts` create/update accept `courtFormatId: string | null` (must exist; archived allowed only if already set on that venue) and `captionName: string | null` (trimmed, ≤ 300).
- `deleteTemplateBlock` refuses while any `court_format_blocks` row references the block on either side (copy), before the existing checks.

- [ ] **Step 1: Failing tests:** each gate; ranges; self/duplicate refusals; stale save writes nothing (format and rows unchanged); replacements replaced wholesale; delete refused with venue names; archive allowed; venue save with format + caption; block delete refused (both sides).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(court-formats): court format actions and venue fields`.

### Task 5: Generation and previews

**Files:** Modify `src/app/actions/document-templates.ts` (+ test), `src/components/templates/generate-from-template-dialog.tsx` (+ test).

**Interfaces — Consumes:** Task 3. **Produces:** preview/generate for filings call `loadCourtContext(scope)` once (after existing gates) and pass `court` to `renderPage` / `renderPageView`; replacement block sources join the block map load; signer/recipient detection uses `effectiveBlocks`; preview results gain `court: { name: string; archived: boolean } | null`; the dialog shows the verbatim notes under filing previews.

- [ ] **Step 1: Failing tests:** filing for a matter whose venue has a format: `.docx` has the court font/size/margins and Legal page, PDF Legal height, replaced caption text in both; inactive format → house style + note data; lead filing and venue-less matter → unchanged, `court: null`; letters unaffected; dialog renders each note.
- [ ] **Step 2–4:** FAIL → implement → PASS; full `npm test`.
- [ ] **Step 5: Commit** `feat(court-formats): filings use the matter's court format`.

### Task 6: Settings screens

**Files:** Create `src/app/(dashboard)/settings/court-formats/page.tsx`, `src/app/(dashboard)/settings/court-formats/[id]/page.tsx`, `src/components/settings/court-format-list.tsx`, `src/components/settings/court-format-editor.tsx` (+ tests); Modify `src/components/settings/settings-nav.tsx`, `src/components/settings/venue-editor.tsx` (+ test), the venues page loader.

**Interfaces:** list grouped by court system with venue counts and archive/restore/delete; editor per spec (each setting with "Use house style" clearing it to null; paper size; replacements table with active blocks plus current archived ones labelled "(archived)"; live `PagePreview` of a sample filing via `renderPageView` with `court` built client-side from the form state; save adopts returned `updatedAt`; stale error with Reload; read-only without keys). Venue editor: Court format select (active + current archived "(archived)" + None) and Caption name. Nav: "Court formats" after Venues.

- [ ] **Step 1: Failing tests:** editor payload incl. nulls and replacements; "Use house style" clears; self-replacement option not offered; read-only mode; list grouping and counts; venue editor fields in payload; nav link.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(court-formats): settings screens`.

### Task 7: "Preview as" in the template editor

**Files:** Modify the template editor page loader (`src/app/(dashboard)/settings/templates/[id]/page.tsx` / `editor-data.ts`), `src/components/templates/editor/preview-pane.tsx`, `template-editor-page.tsx` (+ tests).

**Interfaces:** for filing kind, loader passes active court formats with values and replacement block sources (serializable); preview pane shows a "Preview as" select (House style + formats); sample preview applies the chosen `court` via `renderPageView`; real-record preview uses the record's venue court (server, Task 5 path) and ignores the select (label shows "Using the matter's court format").

- [ ] **Step 1: Failing tests:** select only for filings; choosing a format changes the preview (replacement text shown, Legal height); real-record mode label.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(court-formats): preview filings as a court format`.

### Task 8: Docs

**Files:** Create `docs/decisions/065-court-formats-override-blocks.md` + README row; Modify `docs/features/documents.md`, `docs/features/settings-admin.md`, `docs/ROADMAP.md` (court-aware filings `[x]`), `docs/PERMISSIONS.md`.

- [ ] **Step 1:** ADR: context (several states + federal; shared formats), decision (court formats override blocks and formatting; filings only; archived = ignored), rejected (template slots; per-court template variants; hard-coded state rules), consequences (swap invisible in the template → "Preview as"; pleading paper not supported).
- [ ] **Step 2:** Feature files end state; follow-ups (pleading paper, per-court variants if ever needed, shipped court rule libraries). Format; keep `documents.md` lean.
- [ ] **Step 3: Commit** `docs(court-formats): ADR, feature files and roadmap`.
