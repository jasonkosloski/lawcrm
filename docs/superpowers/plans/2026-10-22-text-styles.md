# Text Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firm-wide named paragraph styles (built-in + custom, independent, court-overridable) that templates apply per paragraph, rendered alike in the editor, preview, Word and PDF.

**Architecture:** Styles live as validated JSON on `DocumentStyle` (`paragraphStyles`) with sparse per-court `CourtFormat.styleOverrides`. One pure resolver turns (paragraph settings → court override → firm style → built-in default) into finished values attached to each resolved paragraph; the converters only read those values. Four phases, each shippable.

**Tech Stack:** Next.js server actions, Prisma/Postgres, zod, TipTap 3, docx, @react-pdf/renderer, sanitize-html, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-22-text-styles-design.md`

## Global Constraints

- Every test run needs the Docker test DB: `docker compose -f docker-compose.test.yml up -d`.
- Migrations: expand-only; generate with `prisma migrate diff` against a local scratch Docker DB, never `migrate dev` (`.env` points at remote dev); then `npm run check:migrations`.
- Commit with an explicit pathspec (`git add` new files, then `git commit -m … -- <paths>`); never leave files staged; commit straight to main and push once the hook passes.
- Mutations are server actions, permission-gated (`firm.edit_document_style`, `court_formats.edit`), logged with `logActivity`, `revalidatePath`.
- Style value ranges (spec §1): size 8–72 step 0.5; indents 0–4 in step 0.01; first line indent/hanging 0–4 in; space before/after 0–72 pt; line spacing `single|1.15|1.5|double` or `{ exactPt }` 6–144; names 1–60 chars, unique case-insensitive; ≤ 50 styles per firm.
- Built-in keys fixed: `body`, `title`, `heading1`, `heading2`, `heading3`, `caption`, `blockquote`, `signature`. Built-ins are never deletable.
- Absent paragraph `style` = `body`. Unknown keys render as Body and are reported, never rejected on template save.
- Font family stays page-level (house style / court), never per style.
- Docs updated in the same commit as the change that makes them stale.

## Review Focus

1. **Existing templates look identical after phase 2.** Heading nodes (with `textAlign`) convert to Heading 1–3 paragraphs whose defaults equal today's `headingSizePt` and bold; PDF text positions for the existing converters fixture must not move. Test in Task 6.
2. **A custom style is deleted while a court block replacement still uses it.** Delete is refused if any template _or block_ references the key (blocks include court replacement blocks); if content still arrives with an unknown key, it renders as Body and `checkTemplateFit` lists it. Tests in Tasks 4 and 5.
3. **Hanging indent larger than the left indent.** The first line must not start left of the margin: effective first-line offset is clamped to ≥ 0 from the page margin in PDF and HTML, and Word gets the same clamped values. Test in Task 3.
4. **Exact line spacing smaller than the text** (e.g. 8pt exact with 12pt text). Must render without error in all outputs (lines may overlap, as in Word). Tests in Tasks 7 and 8.
5. **Stored style JSON is missing or malformed** (a row predating the backfill, a bad manual edit). Reads fall back to built-in defaults derived from the house style and log a warning; generation never fails. Test in Task 1.

---

## Phase 1 — Model, migration, resolver, Settings → Styles

### Task 1: Style model and validation

**Files:**

- Create: `src/lib/templates/paragraph-styles.ts`
- Test: `src/lib/templates/paragraph-styles.test.ts`

**Interfaces:**

- Produces:
  - `type LineSpacingValue = "single" | "1.15" | "1.5" | "double" | { exactPt: number }`
  - `type FirstLine = { kind: "none" } | { kind: "indent"; in: number } | { kind: "hanging"; in: number }`
  - `type StyleValues = { sizePt; bold; italic; underline; smallCaps; allCaps; align: TextAlign; indentLeftIn; indentRightIn; firstLine: FirstLine; spaceBeforePt; spaceAfterPt; lineSpacing: LineSpacingValue; keepWithNext; keepLinesTogether; pageBreakBefore }`
  - `type ParagraphStyle = { key: string; name: string; builtIn: boolean; values: StyleValues }`
  - `const BUILT_IN_KEYS: readonly ["body","title","heading1","heading2","heading3","caption","blockquote","signature"]`
  - `const styleValuesSchema` (zod, full), `const styleOverrideSchema` (zod, `styleValuesSchema.partial()`), `const paragraphStylesSchema` (array; ≤ 50; unique keys; unique names case-insensitive; every built-in key present exactly once with `builtIn: true`)
  - `defaultParagraphStyles(house: { fontSizeHalfPt: number; lineSpacing: LineSpacing; spaceAfterPt: number }): ParagraphStyle[]` — spec §1 defaults; names "Body", "Title", "Heading 1/2/3", "Caption", "Block quote", "Signature".
  - `parseParagraphStyles(json: unknown, house): ParagraphStyle[]` — valid → parsed; otherwise `defaultParagraphStyles(house)` and `console.warn`.
  - `newStyleKey(name: string, taken: Set<string>): string` — lowercase slug, `[a-z0-9-]`, `-2`, `-3`… on collision, never a built-in key.

- [ ] **Step 1: Write failing tests** — `defaults mirror the house style` (body sizePt 12 from 24 half-pt, lineSpacing/spaceAfter copied; heading1 bold sizePt 18, keepWithNext; blockquote indents 0.5/0.5 and "single"; title bold allCaps center); `schema rejects` each of: missing built-in, duplicate key, duplicate name ("caption" vs "Caption"), 51 styles, size 7.5, spaceAfter 73, exactPt 5, indentLeft 4.01, bad firstLine kind; `parse falls back` on `null`, `{}`, `[{ key: "body" }]` (and warns); `newStyleKey("Numbered allegation", ∅) === "numbered-allegation"`, collision → `-2`, `"Body"` → `"body-2"`.
- [ ] **Step 2:** Run `npx vitest run src/lib/templates/paragraph-styles.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement the module.
- [ ] **Step 4:** Run the test — PASS.
- [ ] **Step 5:** Commit.

### Task 2: Migration and loaders

**Files:**

- Modify: `prisma/schema.prisma` (`DocumentStyle.paragraphStyles Json?`, `CourtFormat.styleOverrides Json @default("{}")`)
- Create: `prisma/migrations/<timestamp>_paragraph_styles/migration.sql`
- Modify: `src/lib/templates/document-style.ts` (`getDocumentStyle` returns `paragraphStyles`), `src/lib/templates/court-context.ts` (values gain `styleOverrides`), `src/lib/templates/page-style.ts` (`DocumentStyleValues.paragraphStyles: ParagraphStyle[]`, `CourtFormatValues.styleOverrides: Record<string, Partial<StyleValues>>`, `DEFAULT_DOCUMENT_STYLE.paragraphStyles = defaultParagraphStyles(...)`)
- Modify: `docs/SCHEMA_NOTES.md`
- Test: `src/lib/templates/document-style.test.ts`, `src/lib/templates/court-context.test.ts`, `src/lib/templates/schema-migration.test.ts`

**Interfaces:**

- Consumes: Task 1 `parseParagraphStyles`, `styleOverrideSchema`.
- Produces: loaders always return a valid `paragraphStyles` (fallback when column null) and `styleOverrides` filtered to valid entries.

- [ ] **Step 1: Failing tests** — `getDocumentStyle` on a row with `paragraphStyles: null` returns defaults from that row's house values; with a stored list returns it; court context drops an override entry that fails `styleOverrideSchema` and keeps valid ones.
- [ ] **Step 2:** Run them — FAIL.
- [ ] **Step 3:** Edit `schema.prisma`; generate SQL with `prisma migrate diff --from-url <scratch> --to-schema-datamodel prisma/schema.prisma --script` on a scratch DB migrated to HEAD; append backfill SQL: for every `DocumentStyle`, build the default list via `jsonb_build_array(...)` from `fontSizeHalfPt`, `lineSpacing`, `spaceAfterPt` (same values as `defaultParagraphStyles`); for every `CourtFormat`, set `styleOverrides = jsonb_build_object('body', jsonb_strip_nulls(jsonb_build_object('sizePt', "fontSizeHalfPt"/2.0, 'lineSpacing', "lineSpacing", 'spaceAfterPt', "spaceAfterPt")))` when any is non-null.
- [ ] **Step 4:** Apply to the scratch DB; check a seeded firm's backfilled list parses with `paragraphStylesSchema` (one-off script output pasted in the PR description — not committed). Run `npm run check:migrations`.
- [ ] **Step 5:** Implement loader changes; run the tests — PASS. Add the SCHEMA_NOTES line: JSON columns validated in code; legacy size/spacing columns kept in sync until a later drop migration.
- [ ] **Step 6:** Commit (schema, migration, loaders, tests, SCHEMA_NOTES).

### Task 3: Resolver and Body-driven page style

**Files:**

- Create: `src/lib/templates/resolve-styles.ts`
- Modify: `src/lib/templates/page-style.ts` (`PageStyleOf` gains `styles: ParagraphStyle[]`; `sizePt`, `lineSpacing`, `spaceAfterPt` taken from effective Body)
- Test: `src/lib/templates/resolve-styles.test.ts`, `src/lib/templates/page-style.test.ts`

**Interfaces:**

- Consumes: Task 1 types; Task 2 value shapes.
- Produces:
  - `effectiveStyles(firm: ParagraphStyle[], overrides: Record<string, Partial<StyleValues>> | null): ParagraphStyle[]`
  - `type ParagraphSettings = Partial<Pick<StyleValues, "align" | "spaceBeforePt" | "spaceAfterPt" | "lineSpacing" | "indentLeftIn" | "indentRightIn" | "firstLine" | "keepWithNext" | "keepLinesTogether" | "pageBreakBefore">>`
  - `type ResolvedParagraphStyle = StyleValues & { key: string; known: boolean }`
  - `resolveParagraph(styleKey: string | undefined, settings: ParagraphSettings, styles: ParagraphStyle[]): ResolvedParagraphStyle` — unknown key → Body's values, `known: false`. First line clamped so `indentLeftIn - hanging ≥ 0` (Review Focus 3).
  - `lineFactor(v: LineSpacingValue): number | null` (null for exact).
  - `resolvePageStyle(...)` keeps its signature; `court.styleOverrides` applied only for filings.

- [ ] **Step 1: Failing tests** — paragraph setting beats court beats firm; court override ignored for letters; unknown key → body values with `known: false`; hanging 0.75 with left 0.5 → first line clamped to hanging 0.5; `resolvePageStyle("filing", …)` sizePt follows a court Body override; letters ignore it; page style `styles` lists the effective set.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run these plus `npx vitest run src/lib/templates` — PASS (existing output unchanged because Body equals the house values).
- [ ] **Step 5:** Commit.

### Task 4: Settings → Styles

**Files:**

- Modify: `src/app/actions/document-style.ts` (add `saveParagraphStyles`), `src/app/(dashboard)/settings/documents/page.tsx`, `src/components/settings/document-style-form.tsx` (remove the size / line spacing / space after fields: they now live in Body)
- Create: `src/components/settings/paragraph-styles-form.tsx`, `src/lib/templates/style-usage.ts`
- Test: `src/app/actions/document-style.test.ts`, `src/components/settings/paragraph-styles-form.test.tsx`, `src/lib/templates/style-usage.test.ts`

**Interfaces:**

- Consumes: Task 1 schema + `newStyleKey`; Task 2 loader.
- Produces:
  - `styleKeysIn(doc: unknown): Set<string>` (walks any TipTap JSON for `attrs.style`)
  - `styleUsage(key: string): Promise<{ templates: string[]; blocks: string[] }>` (names; scans `DocumentTemplate.content` and `TemplateBlock.content`)
  - `saveParagraphStyles(input: { styles: ParagraphStyle[]; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }>` — `requirePermission("firm.edit_document_style")`; validates; refuses removing a built-in ("Body can't be deleted.") or a used custom style ("Caption is used by 3 templates: A, B, C."); same stale check and message as `saveDocumentStyle`; also writes the legacy `fontSizeHalfPt`, `lineSpacing`, `spaceAfterPt` from Body (multiple line spacings only; exact → leave legacy value); `logActivity`; `revalidatePath("/settings/documents")`.

- [ ] **Step 1: Failing tests** — action: forbidden without permission; stale timestamp refused; deleting built-in refused; deleting custom used by a template refused with names; used only by a block refused (Review Focus 2); valid save persists and syncs legacy Body columns. Form: lists built-ins then custom; Add copies selected; rename; Delete hidden for built-ins; read-only without permission; shows server error.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `style-usage.ts`, the action and the form (style list left, form right, live sample paragraph using the style's values).
- [ ] **Step 4:** Run the tests — PASS. Run `npm test`.
- [ ] **Step 5:** Update `docs/features/documents.md` (feature entry "Text styles — phase 1") and ROADMAP line. Commit and push.

## Phase 2 — Content contract and outputs

### Task 5: Content schema, marks, heading conversion, fit report

**Files:**

- Modify: `src/lib/templates/schema.ts` (paragraph `attrs.style` + `ParagraphSettings`; marks `allCaps`, `fontSize` with `attrs.pt`), `src/lib/templates/inspect.ts` (`checkTemplateFit` gains `styleKeys: Set<string>` and reports unknown styles)
- Create: `src/lib/templates/headings.ts`
- Modify: `src/components/templates/editor/editor-model.ts` (`initialDoc` converts headings)
- Test: `src/lib/templates/schema.test.ts`, `src/lib/templates/headings.test.ts`, `src/lib/templates/inspect.test.ts`

**Interfaces:**

- Consumes: Task 1 ranges; Task 3 `ParagraphSettings`.
- Produces: `convertHeadings(doc: TemplateDoc): TemplateDoc` (heading level n → paragraph `style: "heading"+n`, keeps `textAlign`, recursive through every container); `ParagraphNode.attrs` type extended; `TemplateMark` union includes `{ type: "allCaps" }` and `{ type: "fontSize"; attrs: { pt: number } }`; unknown-style entries in the fit result as `{ kind: "style", key }`.

- [ ] **Step 1: Failing tests** — schema keeps valid settings and drops defaults (`spaceBeforePt: 0`, `keepWithNext: false`); rejects out-of-range values with "Invalid paragraph spacing." etc.; accepts unknown style keys; `fontSize` 7.5 rejected; SMS rejects both new marks. `convertHeadings` inside a table cell and a showIf. Fit lists `Unknown style: old-style`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit.

### Task 6: Resolve styles in the render engine

**Files:**

- Modify: `src/lib/templates/render.ts` (`renderTemplate` ctx gains `styles: ParagraphStyle[]`; runs `convertHeadings` first; `ResolvedParagraph.attrs.resolved: ResolvedParagraphStyle`), `src/lib/templates/page-render.ts` (passes `style.styles`), callers in `src/app/actions/document-templates.ts`, `src/app/actions/message-templates.ts`, `src/components/templates/editor/preview-pane.tsx`, `sms-count.ts`, `block-node.tsx`, `converters-fixture.ts`
- Test: `src/lib/templates/render.test.ts`, `src/lib/templates/to-pdf.test.ts`

**Interfaces:**

- Consumes: Task 3 `resolveParagraph`, Task 5 `convertHeadings`.
- Produces: every `ResolvedParagraph` carries `attrs.resolved`; `ResolvedHeading` no longer produced.

- [ ] **Step 1: Failing tests** — rendered heading1 paragraph has `resolved.sizePt === sizePt + 6` and `bold`; table-cell paragraph resolves; unknown key reported in `RenderReport` and resolves to body. Review Focus 1: snapshot the PDF text positions (`x`, `y`) of `renderFixture()` before the change (record values in the test) and assert they are unchanged after.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit.

### Task 7: Word output

**Files:**

- Modify: `src/lib/templates/to-docx.ts`
- Test: `src/lib/templates/to-docx.test.ts`

**Interfaces:**

- Consumes: `PageStyle.styles`, `ResolvedParagraph.attrs.resolved` + `attrs.style`.

- [ ] **Step 1: Failing tests** (read `word/styles.xml` and `document.xml`) — `Normal` carries Body values; a `caption` style exists with the firm's name; heading1 style has `<w:outlineLvl w:val="0"/>`; a paragraph with `style: "caption"` has `<w:pStyle w:val="caption"/>` and only its direct settings; exact 14pt → `w:lineRule="exact" w:line="280"`; hanging 0.5in → `w:hanging="720"`; keepNext/keepLines/pageBreakBefore present; `allCaps` mark → `<w:caps/>`; `fontSize` 9pt → `<w:sz w:val="18"/>`; exact 8pt with 12pt text produces a valid file (Review Focus 4).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit.

### Task 8: PDF output

**Files:**

- Modify: `src/lib/templates/to-pdf.tsx`
- Test: `src/lib/templates/to-pdf.test.ts`

- [ ] **Step 1: Failing tests** (text positions via pdfjs, as existing tests) — spaceBefore 24 moves the paragraph down 24pt; left indent 1in shifts x by 72; first-line 0.5in shifts only the first line; hanging 0.5in with left 0.5in puts the first line at the margin and the rest at +36; exact 24pt line spacing gives 24pt between baselines; pageBreakBefore starts page 2; all caps renders uppercase; fontSize mark 9pt renders at 9; exact 8pt with 12pt text renders without throwing (Review Focus 4); fit-table width uses resolved size; a list item whose paragraph style has a 0.5in left indent sits 36pt right of the same item without it (indents add to the list indent).
- [ ] **Step 2–4:** Run (FAIL), implement (`keepWithNext` → `minPresenceAhead` = next paragraph's first line height; `keepLinesTogether` → `wrap={false}`), run (PASS).
- [ ] **Step 5:** Commit.

### Task 9: HTML output, sanitizer, plain text

**Files:**

- Modify: `src/lib/templates/to-html.ts`, `src/lib/sanitize-html.ts`, `src/components/templates/page-preview.tsx` (drop rules now carried inline), `src/lib/templates/to-text.ts`
- Test: `src/lib/templates/to-html.test.ts`, `src/lib/sanitize-html.test.ts`, `src/lib/templates/to-text.test.ts`

- [ ] **Step 1: Failing tests** — a caption paragraph's inline style contains `margin-top:0pt;margin-bottom:0pt` and survives `sanitizeDocumentHtml`; sanitizer strips `position:absolute`, `margin-top:expression(1)`, `font-size:9em` and keeps `text-indent:-36pt`, `line-height:24pt`, `text-transform:uppercase`, `break-before:page` on `p` only; to-text uppercases `allCaps`.
- [ ] **Step 2–4:** Run (FAIL), implement (allowlist per property with regexes `^-?\d{1,3}(\.\d{1,2})?(pt|in|px|%)$` for lengths, keyword sets otherwise), run (PASS). Run `npm test`.
- [ ] **Step 5:** Update the feature file (phase 2 shipped; keep-with-next PDF approximation noted under house-style follow-ups). Commit and push.

## Phase 3 — Editor

### Task 10: Editor nodes and marks

**Files:**

- Modify: `src/components/templates/editor/extensions.ts` (paragraph attrs `style` and every `ParagraphSettings` field, parsed from / rendered to `data-style` and `data-*`; heading extension removed from rich kinds; `createTemplateExtensions` options gain `styles: ParagraphStyle[]` used to render each paragraph's effective CSS inline)
- Create: `src/components/templates/editor/text-marks.ts` (`AllCaps`, `FontSize` marks)
- Test: `src/components/templates/editor/editor-extensions.test.ts`

**Interfaces:**

- Produces: commands `setParagraphStyle(key: string)`, `setParagraphSettings(s: ParagraphSettings)`, `clearFormatting()` (removes marks and settings, keeps style), `toggleAllCaps()`, `setFontSize(pt: number | null)`.

- [ ] **Step 1: Failing tests** — round trip of style + every setting + both marks through JSON and HTML; `clearFormatting` keeps `style: "caption"` and removes settings and marks; a converted heading loads as a Heading 1 paragraph.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit.

### Task 11: Toolbar: Style dropdown, Paragraph dialog, caps, size, clear

**Files:**

- Create: `src/components/templates/editor/style-menu.tsx`, `src/components/templates/editor/paragraph-dialog.tsx`
- Modify: `src/components/templates/editor/toolbar.tsx` (replace H1/H2), `template-editor-page.tsx` / `editor-data.ts` (pass effective styles; court "Preview as" passes that court's effective styles)
- Test: `src/components/templates/editor/style-menu.test.tsx`, `src/components/templates/editor/paragraph-dialog.test.tsx`

- [ ] **Step 1: Failing tests** — dropdown shows the current paragraph's style name and a dot when it has settings; picking Caption sets the style; dialog shows style values as placeholders, saving a field writes only that setting, reset clears it; All caps and size controls toggle marks; Clear formatting button.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS). Run `npm test`.
- [ ] **Step 5:** Feature file update; commit and push.

## Phase 4 — Court overrides

### Task 12: Court format Styles section

**Files:**

- Modify: `src/app/actions/court-formats.ts` (input gains `styleOverrides`, validated with `styleOverrideSchema` and against the firm's keys; the document-wide size / line spacing / space after inputs removed — saved as `styleOverrides.body` and mirrored to the legacy columns), `src/components/settings/court-format-editor.tsx` (Styles section)
- Test: `src/app/actions/court-formats.test.ts`, `src/components/settings/court-format-editor.test.tsx`

- [ ] **Step 1: Failing tests** — saving a Body override writes `styleOverrides.body` and the legacy columns; an override for an unknown key is refused ("No style called …"); editor shows firm values as placeholders and only sends set fields; a filing under that court renders Body with the override (PDF line gap) while a letter does not.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS). Run `npm test`.
- [ ] **Step 5:** Commit and push.

### Task 13: Finish: ADR and docs

**Files:**

- Create: `docs/decisions/067-text-styles-are-firm-json-resolved-once.md` (+ row in `docs/decisions/README.md`)
- Modify: `docs/features/documents.md`, `docs/ROADMAP.md`
- Delete: `docs/superpowers/specs/2026-10-22-text-styles-design.md`, `docs/superpowers/plans/2026-10-22-text-styles.md`

- [ ] **Step 1:** Write the ADR (decision, rejected approaches B and C from the spec, trade-offs incl. keep-with-next approximation and independent styles). Fold lasting detail into the feature file; follow-ups: list styles, character styles, per-style fonts, Word style import, drop the legacy size/spacing columns.
- [ ] **Step 2:** Commit and push.
