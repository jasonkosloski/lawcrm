# Letters out: firm house style and PDF output — design

**Date:** 2026-10-22
**Status:** Draft for review
**Tier:** Full (schema change; new upload route; document storage)

## Goal

Generated letters and filings look like the firm's own paper, in both `.docx` and PDF, from one firm-wide house style. Project 2 of 4 in the templates programme (ADR-063): 1 foundation (shipped), 2 this, 3 emails and texts, 4 court-aware filings.

### What the user decided

- Staff both edit generated letters in Word and send them as-is, about equally, so the `.docx` and PDF must look the same.
- Letterhead on the **first page only**; later pages get a small running header.
- Fonts from a **curated list**; no uploaded fonts.
- PDF approach **A**: one resolved style feeds two converters (`.docx` via `docx`, PDF via `@react-pdf`) with bundled metric-compatible free fonts. Documents never leave our infrastructure. Rejected: LibreOffice/Gotenberg conversion (external service holding privileged documents, ops cost), headless Chromium (heavy, worse fidelity).

## Schema

New `DocumentStyle` (`document_styles`), one row per firm, created lazily with defaults on first read:

| Field                          | Type            | Notes                                                                                 |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------------- |
| `id`                           | String          | cuid                                                                                  |
| `firmId`                       | String          | unique, FK → Firm (Cascade)                                                           |
| `fontKey`                      | String          | `times` (default) \| `arial` \| `garamond` \| `schoolbook` \| `palatino` \| `courier` |
| `fontSizeHalfPt`               | Int             | 20–28 (10–14 pt in half points); default 24                                           |
| `lineSpacing`                  | String          | `single` (default) \| `1.15` \| `1.5` \| `double`                                     |
| `spaceAfterPt`                 | Int             | 0–24; default 12                                                                      |
| `marginTopIn` … `marginLeftIn` | Decimal(3,2) ×4 | 0.50–2.00; default 1.00                                                               |
| `letterheadBlockId`            | String?         | FK → TemplateBlock (SetNull); default the seeded Letterhead                           |
| `logoPosition`                 | String          | `none` (default) \| `left` \| `center` \| `right`                                     |
| `logoKey`                      | String?         | private storage key of the uploaded logo                                              |
| `logoContentType`              | String?         | `image/png` \| `image/jpeg`                                                           |
| `continuationBlockId`          | String?         | FK → TemplateBlock (SetNull); default the seeded Continuation header                  |
| `pageNumbers`                  | String          | `none` \| `bottom_center` (default) \| `bottom_right`; pages 2+ only                  |
| `updatedAt`, `createdAt`       |                 |                                                                                       |

The migration (expand-only) creates the table and seeds a `TemplateBlock` `tplblock_continuation` (key `continuation`, name "Continuation header"): one paragraph `field recipient.name`, text " · ", `field today` (format `long`). Idempotent `ON CONFLICT DO NOTHING`. The style row itself is created by the app on first read (the firm id isn't known to the migration).

Paper is US Letter only. Heading sizes derive from the body size (H1 +6 pt, H2 +4 pt, H3 +2 pt, all bold); not configurable.

`Firm.logoUrl` (a typed URL used by the client portal) is unchanged; documents use the uploaded logo bytes.

## Style resolution

`src/lib/templates/page-style.ts`, pure:

```ts
type PageStyle = {
  font: FontKey; sizePt: number; lineSpacing: 1 | 1.15 | 1.5 | 2; spaceAfterPt: number;
  marginsIn: { top: number; right: number; bottom: number; left: number };
  letterhead: { blockId: string | null; logo: { bytes: Uint8Array; contentType: string; position: "left" | "center" | "right" } | null } | null;
  continuationBlockId: string | null;
  pageNumbers: "none" | "bottom_center" | "bottom_right";
};
resolvePageStyle(kind: "letter" | "filing", style: DocumentStyleRow, logo: LoadedLogo | null): PageStyle
```

Letters get everything. Filings get font, size, spacing, margins and page numbers; `letterhead` and `continuationBlockId` are null. Project 4 adds a court layer as an extra argument.

## Fonts

`src/lib/templates/fonts.ts`: one registry, `FontKey → { label, wordName, pdfFamily, files: { regular, bold, italic, boldItalic }, metricCompatible: boolean }`.

| Key          | Word name          | Bundled PDF font | Metric-compatible  |
| ------------ | ------------------ | ---------------- | ------------------ |
| `times`      | Times New Roman    | Liberation Serif | yes                |
| `arial`      | Arial              | Liberation Sans  | yes                |
| `courier`    | Courier New        | Liberation Mono  | yes                |
| `schoolbook` | Century Schoolbook | TeX Gyre Schola  | yes                |
| `palatino`   | Book Antiqua       | TeX Gyre Pagella | yes                |
| `garamond`   | Garamond           | EB Garamond      | no (settings note) |

Files live in `src/lib/templates/fonts/` with their licence texts (SIL OFL 1.1; GUST Font License), shipped via `outputFileTracingIncludes` like `src/lib/billing/fonts/`. The browser preview loads the same files through `@font-face` from a static route (`public/fonts/templates/`, same files).

## Converters

Both consume the same `ResolvedDoc` (body), the resolved letterhead and continuation blocks (rendered through `renderTemplate` with the same `TemplateData`, so recipient/date fields work), and `PageStyle`.

**`.docx`** (`to-docx.ts`, extended): document defaults set font (`wordName`), size, line spacing (`line` = 240 × factor, `lineRule: auto`) and `spacing.after`; section margins; `titlePage: true` with the letterhead (logo `ImageRun` placed per position, then block content) in the first-page header; the continuation block plus a right-aligned "Page " + `PageNumber.CURRENT` in the default header; footer page number per `pageNumbers` on the default footer only (first page has none). Headings sized from the body size.

**PDF** (`to-pdf.tsx`, new, `@react-pdf`, server-only): fonts registered from the registry; `Page size="LETTER"` with padding from margins; a `fixed` header using `render={({ pageNumber })}` — letterhead when 1, continuation + "Page N" otherwise; a `fixed` footer page number from page 2; paragraphs, headings, bullet/ordered lists (own numbering per list), tables (no merged cells), page breaks (`break`), marks, and the `missing` mark as a yellow background. Characters missing from the chosen font fall back to Liberation Sans when the installed `@react-pdf` supports a font-family list (verify); otherwise they render as boxes. Either way the generate report notes "Some characters can't be shown in <font label>." when the text has characters outside the chosen font's coverage.

**HTML preview** (`to-html.ts` gains `resolvedToPageHtml(body, header, style)`): a page-shaped wrapper with CSS from `PageStyle` (font via `@font-face`, size, line height, paragraph margin, margins to scale), letterhead on top, a "Page 2 onward" strip showing the continuation header and page number. Not paginated. Sanitized as today.

## Logo upload

`POST /api/document-style/logo` (route handler, ADR-034: bytes never through server actions): `firm.edit_document_style`; accepts one file ≤ 1 MB; checks magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`), not the extension; stores via `storeFile` in private storage; writes `logoKey`/`logoContentType`, deleting the previous file after the row update; logs activity. `DELETE` removes it. Generation loads the bytes; a missing or unreadable logo renders without it and the report notes "Logo couldn't be loaded".

## Settings → Documents

`/settings/documents` (authenticates itself, ADR-028). Form: font (each option in its own face; Garamond shows "Line breaks may differ slightly between Word and PDF."), size, line spacing, space after, four margins, letterhead block, logo position + upload/remove, continuation block (or none), page numbers. Right: live sample page via `resolvedToPageHtml` with sample data, plus the page-2 strip. Read-only without the key.

Action `saveDocumentStyle(input)` in `src/app/actions/document-style.ts`: `requirePermission("firm.edit_document_style")`; zod ranges as in the schema table; block ids must exist; atomic stale check on `expectedUpdatedAt` (`updateMany` where `updatedAt` matches; copy "Someone else saved the document style — reload to see their changes."); logs; revalidates `/settings/documents` and `/settings/templates`.

Permission: new key `firm.edit_document_style` in `src/lib/permissions.ts` (granted by migration to roles holding `firm.edit_info`).

Block deletion (`deleteTemplateBlock`) is also refused while the style references the block: "This block is used by the firm's document style. Choose another block there first."

## Generation

`generateDocumentFromTemplate` gains `format: "docx" | "pdf" | "both"` (default `docx`). One render, then the selected converters. `both` stores two files and creates two `Document` rows in one transaction; if either store or the transaction fails, every stored file is deleted and one error returns. Names: `<template> — <date>.docx` / `.pdf`. Records-request letters: both rows tagged `request_letter` in the request folder. The Generate dialog adds "Save as: Word / PDF / Both"; previews (dialog and template editor) switch to `resolvedToPageHtml`.

Kinds: only `letter` and `filing` generate (unchanged).

## Testing

- `resolvePageStyle`: letter vs filing; defaults; logo presence.
- Fonts: every registry file exists and loads; `metricCompatible` false only for Garamond.
- `.docx`: unzip and assert `w:pgMar` values, `w:rFonts`/`w:sz` defaults, `w:spacing`, `w:titlePg`, first-page header contains letterhead text and an image part when a logo is set, default header contains continuation text and a `PAGE` field, footer page field only when configured.
- PDF: parse with `pdf-lib`: two-page letter has 2 pages; page 1 text includes the letterhead, page 2 includes "Page 2"; fonts embedded match the registry; an unreadable logo still produces a PDF.
- Actions/routes: permission gates; range validation; stale save refused; logo type/size/magic-byte refusal; previous logo deleted on replace; `both` atomicity (second store fails → first deleted, no rows); block delete refused while the style uses it.
- UI: settings form saves payload and shows the Garamond note; Generate dialog sends `format`.

## Docs

- ADR: one style source, two converters, metric-compatible bundled fonts instead of docx→PDF conversion; why.
- `docs/features/documents.md` (end state), `docs/ROADMAP.md` line `[x]`, `docs/PERMISSIONS.md` note for the new key.

## Out of scope

Court rules, legal paper size, pleading line numbers (project 4). Email/SMS (project 3). Uploaded fonts. CJK fonts. Per-template style overrides (rejected in project 1).
