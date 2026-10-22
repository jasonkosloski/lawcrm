# ADR-064: Letters render twice from one style

**Date:** 2026-10-22
**Status:** Accepted.

**Context:** Staff edit generated letters in Word and send them as-is about equally often, so the `.docx` and the PDF must look the same. Privileged documents must not leave our infrastructure. Formatting is layered outside templates ([ADR-063](063-templates-are-structured-documents.md)): firm house style now, court rules later.

**Decision:**

- One firm-wide `DocumentStyle` resolves to one `PageStyle` (`resolvePageStyle`, kind letter or filing). Two converters read the same `ResolvedDoc` and `PageStyle`: `.docx` via `docx` and PDF via `@react-pdf` (`to-pdf.tsx`). The HTML preview reads the same style.
- Fonts are bundled, metric-compatible free faces (`src/lib/templates/fonts.ts`), so Word's named font and the embedded PDF font wrap alike. The PDF line height is the factor times the font's natural line height, matching Word's single spacing.
- The letterhead is a real Word first-page header (title page), with a separate continuation header for later pages, not body content. Page 1 is never numbered.
- Logo uploads are re-encoded to PNG (longest side 1200 px) with `sharp`, so react-pdf never meets progressive, CMYK or odd JPEGs.
- Generate offers Word, PDF or Both, all-or-nothing.

**Rejected:**

- LibreOffice/Gotenberg `.docx` to PDF conversion: sends privileged documents to an external service (or an ops burden to host) and still renders differently from Word.
- Headless Chromium: heavy on serverless, and worse typographic fidelity than controlling the layout directly.

**Trade-offs:**

- (+) Documents never leave our infrastructure; one style source for every output
- (+) Matching metrics make the two outputs line up without a conversion step
- (-) Garamond has no metric-compatible bundled face, so line breaks may differ slightly between Word and PDF (the settings page says so)
- (-) CJK is not covered by the bundled fonts
- (-) Two converters must be kept in step whenever the node set or style changes
