# ADR-041: PDFs render in the page with pdf.js; PDF flags anchor to page + quote

**Date:** 2026-10-18
**Status:** Accepted

**Context:** PDFs were shown in an iframe using the browser's PDF plugin. The plugin is a black box: the app can't read its current page, see the reviewer's selection, or jump without reloading it. So PDF flags could only carry a hand-typed page number, unlike Word documents where a selection becomes a quote flag.

**Decision:**
- Render PDFs ourselves with **pdf.js** (`pdfjs-dist`, pinned): a canvas plus pdf.js's transparent text layer per page (`src/components/documents-viewer/pdf-document-viewer.tsx`). The worker is bundled via `new Worker(new URL(...))`, and the library is dynamic-imported so it loads only on PDF pages.
- **Virtualized pages.** Every page gets a sized placeholder (sizes from page 1, corrected per page as pages render), so jumps are arithmetic. Only pages within ~1,200 px of the viewport render, and pages that leave are cleared. Pure layout math lives in `src/lib/pdf-viewer-math.ts`.
- **Anchor = page (+ optional span end) + optional quote.** A selection on a page becomes `{ pageNumber, quote }`; one that runs across a page break also stores `endPageNumber` (added 2026-10-18, max 25 pages), and the viewer keeps the whole span rendered so the passage can be relocated across the break. The corner page numbers are CSS-generated content, so they never leak into a cross-page quote. The page disambiguates repeated phrases; relocation uses the same `locateQuote` matcher as the Word viewer, scoped to that page's text layer. Highlights use the CSS Custom Highlight API: no DOM changes to pdf.js's layer.
- **Hardening:** pdf.js 6 never evals font code. No annotation, form or XFA layer is mounted, so embedded links and scripts are inert. The bytes come from the same auth-gated download route (blob 302s are followed, as for docx-preview).

**Trade-offs:**
- (+) PDF tagging matches Word: select, flag, click to return to the highlighted passage
- (+) In-app navigation: no plugin reload per jump; current page known (prefills "Flag this page")
- (-) Roughly 430 KB of library plus a 1.2 MB worker, loaded on PDF pages only
- (-) No in-viewer text search yet (the browser's find only sees rendered pages); scanned PDFs with no text layer can only take page flags until OCR
- (-) Rendering fidelity is pdf.js's, not the browser plugin's (in practice equal or better; forms and annotations aren't shown)
