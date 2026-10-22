# Letters Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A firm-wide house style (font, size, spacing, margins, first-page letterhead with logo, later-page header, page numbers) applied identically to generated `.docx` and new PDF output, with page-shaped previews and a Settings → Documents page.

**Architecture:** A `DocumentStyle` row resolves through a pure `resolvePageStyle` into one `PageStyle`. The existing `.docx` converter and a new `@react-pdf` converter both read that `PageStyle` plus the rendered body, letterhead and continuation blocks; a font registry maps each choice to the Word font name and bundled metric-compatible font files. Previews wrap the existing sanitized HTML in a page-shaped container styled from the same `PageStyle`.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before routes), Prisma 7 / Postgres, `docx@9`, `@react-pdf/renderer@4.9.0`, `pdf-lib` (tests), TipTap 3, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-letters-out-design.md`

## Global Constraints

- Follow `AGENTS.md`: server actions in `src/app/actions/`, `requirePermission`, `logActivity`, `revalidatePath`; pages authenticate themselves (ADR-028); document bytes never travel through server actions (ADR-034) — the logo uploads through a route handler.
- Migration is expand-only (ADR-058). Create SQL with `prisma migrate diff` against a local Docker scratch DB (container `lawcrm-test-postgres`, `lawcrm_test`/`lawcrm_test`, port 5433); never `migrate dev`; never point Prisma at a non-localhost DB. Run `npm run check:migrations`.
- New permission key `firm.edit_document_style`, granted by migration to every role holding `firm.edit_info` (pattern: `prisma/migrations/20261021120000_documents_edit_permission/migration.sql`).
- Ranges: font size 10–14 pt in half points (`fontSizeHalfPt` 20–28, default 24); line spacing `single|1.15|1.5|double` (default `single`); space after 0–24 pt (default 12); margins 0.50–2.00 in (default 1.00); page numbers `none|bottom_center|bottom_right` (default `bottom_center`), pages 2+ only; logo position `none|left|center|right` (default `none`); logo PNG/JPEG ≤ 1 MB by magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`).
- Headings: body size +6 / +4 / +2 pt for H1 / H2 / H3, bold.
- Paper: US Letter only.
- Copy, verbatim: Garamond note `Line breaks may differ slightly between Word and PDF.`; stale style save `Someone else saved the document style — reload to see their changes.`; logo load failure `Logo couldn't be loaded.`; unsupported characters `Some characters can't be shown in <font label>.`; block-delete refusal `This block is used by the firm's document style. Choose another block there first.`
- File names: `<template name> — <formatDate(today, "medium", tz)>.docx` / `.pdf`; PDF content type `application/pdf`.
- Tests need the Docker test DB up. Commit with `git add -- <paths>` then `git commit -m "…" -- <paths>`; never `--no-verify`; format touched files with `npm run format -- <files>`.

## Review Focus

1. **`both` format half-failure** — if the PDF store or the row transaction fails after the `.docx` is stored, no file or row survives. Test in Task 9.
2. **Logo replaced or deleted while a generation is in flight / logo unreadable** — generation still produces both files without the logo and reports it. Tests in Tasks 3 and 5.
3. **Firm with no `DocumentStyle` row yet** (every existing prod firm on deploy) — first read creates defaults; two concurrent first reads don't throw. Test in Task 3.
4. **Text the chosen font can't draw** (e.g. CJK in a Times letter) — PDF still generates, report carries the copy. Test in Task 5.
5. **House-style block archived or deleted** — letterhead/continuation render the archived/missing marker and the report lists it; block delete is refused while the style references it. Tests in Tasks 4 and 7.

---

## File Structure

| File                                                                                                                             | Responsibility                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_document_style/`                                                                 | `DocumentStyle`, continuation block seed, permission grant |
| `src/lib/permissions.ts`                                                                                                         | `firm.edit_document_style`                                 |
| `src/lib/templates/fonts.ts`, `src/lib/templates/fonts/*`, `public/fonts/templates/*`                                            | Font registry + bundled files + licences                   |
| `src/lib/templates/page-style.ts`                                                                                                | `PageStyle`, `resolvePageStyle`, constants/ranges          |
| `src/lib/templates/document-style.ts`                                                                                            | Server-only: `getDocumentStyle` (lazy create), `loadLogo`  |
| `src/lib/templates/to-docx.ts`                                                                                                   | Styled `.docx`                                             |
| `src/lib/templates/to-pdf.tsx`                                                                                                   | PDF                                                        |
| `src/lib/templates/to-html.ts`                                                                                                   | `resolvedToPageHtml`                                       |
| `src/app/actions/document-style.ts`                                                                                              | `saveDocumentStyle`                                        |
| `src/app/api/document-style/logo/route.ts`                                                                                       | Logo upload/delete                                         |
| `src/app/(dashboard)/settings/documents/page.tsx`, `src/components/settings/document-style-form.tsx`                             | Settings page                                              |
| `src/app/actions/document-templates.ts`, `src/components/templates/generate-from-template-dialog.tsx`, editor `preview-pane.tsx` | `format`, previews                                         |

---

### Task 1: Schema, migration, permission key

**Files:** Modify `prisma/schema.prisma` (new `DocumentStyle`, back-relations on `Firm` and `TemplateBlock`), `src/lib/permissions.ts`; Create `prisma/migrations/<ts>_document_style/migration.sql`; Test `src/lib/templates/document-style-schema.test.ts`.

**Interfaces — Produces:** model `DocumentStyle` exactly as the spec's schema table (`@@map("document_styles")`, `firmId @unique`, margins `Decimal @db.Decimal(3,2)`, FKs `letterheadBlockId`/`continuationBlockId` → `TemplateBlock` `onDelete: SetNull` with named relations); seeded block id `tplblock_continuation`, key `continuation`; permission entry `{ key: "firm.edit_document_style", label: "Edit document style", description: "Set the firm's letter and filing house style: font, spacing, margins, letterhead, logo and page numbers." }` in the `firm` group.

- [ ] **Step 1: Write failing test** — integration: create `DocumentStyle` with only `firmId`; assert every default from Global Constraints; second row for the same firm → `P2002`; deleting a referenced `TemplateBlock` nulls `letterheadBlockId`.
- [ ] **Step 2: Run** `npx vitest run src/lib/templates/document-style-schema.test.ts` — FAIL.
- [ ] **Step 3: Schema + SQL via `migrate diff`**; append continuation-block seed (`ON CONFLICT ("id") DO NOTHING`; content: one paragraph `field recipient.name`, text `·`, `field today` format `long`) and the permission grant from `firm.edit_info`. Add the permission entry.
- [ ] **Step 4: Run** the test, `npm run check:migrations`, and apply all migrations to a fresh scratch DB to confirm the seed row and grant (record output; drop the DB) — PASS.
- [ ] **Step 5: Commit** `feat(documents): document style schema and permission`.

### Task 2: Font registry and bundled fonts

**Files:** Create `src/lib/templates/fonts.ts`, `src/lib/templates/fonts/` (24 font files + `LICENSE-OFL.txt`, `LICENSE-GUST.txt`, `README.md` with sources/versions), `public/fonts/templates/` (same font files), test `src/lib/templates/fonts.test.ts`; Modify `next.config.*` (`outputFileTracingIncludes` adds `./src/lib/templates/fonts/**`).

**Interfaces — Produces:** `type FontKey = "times" | "arial" | "garamond" | "schoolbook" | "palatino" | "courier"`; `FONT_KEYS`; `FONTS: Record<FontKey, { label: string; wordName: string; pdfFamily: string; files: { regular: string; bold: string; italic: string; boldItalic: string }; metricCompatible: boolean }>` (file names relative to the fonts dir); `fontFilePath(file: string): string` (server, `path.join(process.cwd(), "src/lib/templates/fonts", file)`); `fontPublicUrl(file: string): string` (`/fonts/templates/<file>`). Labels: Times New Roman, Arial, Garamond, Century Schoolbook, Book Antiqua / Palatino, Courier New. Mapping and `metricCompatible` exactly as the spec's font table.

- [ ] **Step 1: Write failing test:** every registry file exists in both directories; every TTF/OTF parses with `@pdf-lib/fontkit` (installed); only `garamond` has `metricCompatible: false`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Download** official releases into a fresh directory, verify, copy in: Liberation Fonts 2.1.5 (Serif, Sans, Mono — regular/bold/italic/bold-italic; Sans regular/bold already exist in `src/lib/billing/fonts/` but copy fresh), TeX Gyre Schola and Pagella 2.x (`.otf`), EB Garamond (OFL, Google Fonts static TTFs). Record URLs and versions in the README. Implement the registry.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(documents): bundled metric-compatible font registry`.

### Task 3: Page style resolution and style loading

**Files:** Create `src/lib/templates/page-style.ts`, `src/lib/templates/document-style.ts`, tests beside each.

**Interfaces — Consumes:** Task 1 model, Task 2 `FontKey`. **Produces:**

- `page-style.ts` (pure, client-safe): constants for every range/default; `type DocumentStyleValues` (the editable columns, margins as numbers); `type LoadedLogo = { bytes: Uint8Array; contentType: "image/png" | "image/jpeg"; position: "left" | "center" | "right" }`; `type PageStyle` per the spec; `resolvePageStyle(kind: "letter" | "filing", style: DocumentStyleValues, logo: LoadedLogo | null): PageStyle`; `headingSizePt(sizePt: number, level: 1 | 2 | 3): number`.
- `document-style.ts` (server-only): `getDocumentStyle(): Promise<DocumentStyleValues & { id: string; updatedAt: Date; logoKey: string | null; logoContentType: string | null }>` — reads the current firm's row, creating it with defaults on first read (`upsert` on `firmId`, so concurrent first reads don't throw; letterhead/continuation default to `tplblock_letterhead`/`tplblock_continuation` when those rows exist); `loadLogo(style): Promise<{ logo: LoadedLogo | null; warning: string | null }>` — reads bytes from storage; any failure → `{ logo: null, warning: "Logo couldn't be loaded." }`; `logoPosition === "none"` → `{ logo: null, warning: null }`.

- [ ] **Step 1: Write failing tests:** filing drops letterhead/continuation, keeps font/margins/page numbers; letter keeps both; `lineSpacing` maps `single→1, 1.15, 1.5, double→2`; heading sizes; `getDocumentStyle` creates defaults once under `Promise.all` of two calls; `loadLogo` with a storage read that throws returns the warning.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(documents): page style resolution and lazy document style`.

### Task 4: Styled `.docx`

**Files:** Modify `src/lib/templates/to-docx.ts`, its test.

**Interfaces — Consumes:** `PageStyle`, `FONTS`, `ResolvedDoc`. **Produces:** `resolvedToDocx(input: { body: ResolvedDoc; letterhead: ResolvedDoc | null; continuation: ResolvedDoc | null; style: PageStyle }): Promise<Buffer>` (callers updated in Task 9; keep a thin `resolvedToDocx(doc)` overload only if needed for typecheck until then — remove in Task 9).

- [ ] **Step 1: Write failing tests** (unzip with `jszip`): `w:pgMar` = inches × 1440 for each side; `w:rFonts w:ascii="Times New Roman"` and `w:sz w:val="24"` in document defaults; `w:spacing w:after="240"` and `w:line="360" w:lineRule="auto"` for 1.5 spacing; `w:titlePg` present for letters; first-page header part contains the letterhead text and an image relationship when a logo is given (left/center/right alignment); default header contains the continuation text and a `PAGE` field; `bottom_right` → default footer has a right-aligned `PAGE` field, first-page footer none; filing → no `w:titlePg`, no headers; an archived-block marker in the letterhead renders highlighted.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** with `docx` `Header`/`Footer`, `ImageRun` (scale the logo to max 1.0 in tall × 3.0 in wide preserving aspect), `PageNumber.CURRENT`, document `styles.default`. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(documents): house style in generated .docx`.

### Task 5: PDF converter

**Files:** Create `src/lib/templates/to-pdf.tsx`, `to-pdf.test.ts`.

**Interfaces — Produces:** `resolvedToPdf(input: same as Task 4): Promise<{ buffer: Buffer; warnings: string[] }>` (server-only). Registers each `FontKey` family once (4 weights/styles) plus Liberation Sans as fallback. Warnings: the unsupported-characters copy when any body/header text contains a code point the chosen font lacks (check with the font's cmap via fontkit, or a conservative rule: any char outside Latin-1 Supplement + Latin Extended-A/B + General Punctuation for non-Liberation fonts — state which in the report).

- [ ] **Step 1: Write failing tests** (parse with `pdf-lib`): a body long enough for two pages → 2 pages; page 1 text includes the letterhead text (extract per-page text with `pdfjs-dist` 6.3.289, already a dependency — use its legacy/node build in tests); page 2 contains `Page 2`; embedded font base names include the registry's PDF family; filing has no letterhead text; a CJK name produces the warning and still a valid PDF; `missing` mark renders (no throw); logo null → valid PDF.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** following `src/lib/billing/invoice-pdf.tsx` patterns (`Font.register`, `renderToBuffer`, `fixed` header/footer with `render={({ pageNumber })}`). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(documents): PDF output from the house style`.

### Task 6: Page-shaped HTML preview

**Files:** Modify `src/lib/templates/to-html.ts` (+ test); Create `src/components/templates/page-preview.tsx` (+ test) and a global `@font-face` stylesheet entry (e.g. `src/app/fonts-templates.css` imported where previews render, or inline `<style>` in the component).

**Interfaces — Produces:** `resolvedToPageHtml(input: { body: ResolvedDoc; letterhead: ResolvedDoc | null; continuation: ResolvedDoc | null; style: PageStyle; logoUrl: string | null }): string` — sanitized; outer `<div data-page>` with inline CSS variables for font family (`pdfFamily`), size, line height, paragraph margin, padding = margins at 96 px/in scaled by the container; letterhead section; body; a `data-page2` strip with continuation + `Page 2`. `PagePreview` component renders it (scale-to-fit width). Logo in previews comes from `GET /api/document-style/logo` (Task 7) as `logoUrl`.

- [ ] **Step 1: Write failing tests:** CSS vars reflect style values; filing omits letterhead and strip; sanitizer keeps the `data-page*` structure and inline `style` only for the allowed properties (extend the document-profile allowlist minimally if needed, with a test); the component scales without throwing in happy-dom.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(documents): page-shaped previews`.

### Task 7: Style action, logo route, block protection

**Files:** Create `src/app/actions/document-style.ts` (+ test), `src/app/api/document-style/logo/route.ts` (+ test); Modify `src/app/actions/template-blocks.ts` (+ test).

**Interfaces — Produces:** `saveDocumentStyle(input: DocumentStyleValues & { expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }>` — gate, zod ranges, block ids exist (or null), atomic stale check, `logActivity` (firm scope, source "Settings"), revalidate `/settings/documents` and `/settings/templates`. Route: `POST` multipart one file → validate size + magic bytes → `storeFile` → update `logoKey`/`logoContentType` → delete previous file after the update → log; `DELETE` clears and deletes; `GET` streams the logo for previews (any signed-in user; 404 when none). `deleteTemplateBlock` refuses with the spec copy when `document_styles` references the block.

- [ ] **Step 1: Write failing tests:** permission gate (action and route); out-of-range values refused; stale refused; logo: `.png` name with JPEG bytes accepted as JPEG, a GIF refused, 1 MB + 1 byte refused, replace deletes the old key, failed row update deletes the new file; GET without a logo → 404; block delete refused while referenced.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(documents): document style action, logo upload and block protection`.

### Task 8: Settings → Documents page

**Files:** Create `src/app/(dashboard)/settings/documents/page.tsx`, `src/components/settings/document-style-form.tsx` (+ test); Modify `src/components/settings/settings-nav.tsx`.

**Interfaces — Consumes:** Tasks 3, 6, 7. Page: `requireUser()`; `getDocumentStyle()`; blocks list (active + current selections); `canEdit` from `firm.edit_document_style`. Form fields per spec; font options rendered in their own face; Garamond note; logo upload via `fetch` to the route with progress-free simple UI; live `PagePreview` with `SAMPLE_TEMPLATE_DATA`; save sends `expectedUpdatedAt` and adopts the returned one; stale error inline with Reload; read-only without the key.

- [ ] **Step 1: Write failing tests:** save payload; Garamond note; read-only mode; preview updates on font change; stale error shows Reload.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(documents): Settings → Documents page`.

### Task 9: Generation formats and styled previews

**Files:** Modify `src/app/actions/document-templates.ts` (+ test), `src/components/templates/generate-from-template-dialog.tsx` (+ test), `src/components/templates/editor/preview-pane.tsx` (+ test), records-request callers if they pass options.

**Interfaces — Produces:** `generateDocumentFromTemplate(…, opts & { format?: "docx" | "pdf" | "both" })` default `docx`: load style + logo once; render letterhead/continuation blocks via `renderTemplate` with the same data (merge their reports into the main report, plus `loadLogo` and PDF warnings); produce selected files; `both` → store both, then one `$transaction` creating both rows (records-request tagging on both); on any failure delete every stored key; result `{ ok: true; documents: { id; name }[]; report }`. `previewDocumentFromTemplate` and `previewTemplateDraft` return `pageHtml` (via `resolvedToPageHtml`) alongside `html`/`text`. Dialog: "Save as" radio Word / PDF / Both (default Word), shows `pageHtml` in `PagePreview`, success message lists the saved names. Editor preview pane uses `PagePreview` for letter/filing kinds.

- [ ] **Step 1: Write failing tests:** `pdf` stores `application/pdf` with `.pdf` name; `both` creates two rows with matching base names; `both` with the second `storeFile` rejecting → first key deleted, zero rows; transaction failure → both keys deleted; records request `both` tags both rows; letterhead block archived → report lists it; unreadable logo → report has `Logo couldn't be loaded.` and files still save; dialog sends `format`; editor preview renders the page wrapper.
- [ ] **Step 2–4:** FAIL → implement → PASS (also remove any temporary `resolvedToDocx` overload). Run full `npm test`.
- [ ] **Step 5: Commit** `feat(documents): save letters as Word, PDF or both`.

### Task 10: Docs

**Files:** Create `docs/decisions/0NN-letters-render-twice-from-one-style.md` (next free number) + README row; Modify `docs/features/documents.md`, `docs/ROADMAP.md` (project 2 line `[x]`), `docs/PERMISSIONS.md` (new key note), `docs/ARCHITECTURE.md` only if it lists output pipelines.

- [ ] **Step 1:** ADR: context (both outputs used equally), decision (one `PageStyle`, two converters, metric-compatible bundled fonts, first-page header), rejected (LibreOffice/Gotenberg, Chromium), consequences (Garamond wrap caveat, CJK limit, two converters to keep in step).
- [ ] **Step 2:** Feature file end state + follow-ups (legal paper, uploaded fonts, CJK font, pleading paper → project 4). `npm run format -- <docs>`.
- [ ] **Step 3: Commit** `docs(documents): house style and PDF output`.
