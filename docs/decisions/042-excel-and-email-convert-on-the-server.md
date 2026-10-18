# ADR-042: Excel and email convert on the server; TIFF and HEIC decode in the browser

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Discovery arrives as phone-record spreadsheets, exported emails (.eml from most clients, .msg from Outlook), multi-page TIFF scans and iPhone photos (HEIC). Browsers show none of these natively, so they were download-only.

**Decision:**
- **Excel (.xlsx) and email (.eml/.msg) convert server-side**, like the docx/text previews (`src/lib/office-preview.ts`). Libraries: `read-excel-file` (values only, maintained; SheetJS's npm release is stale with known advisories and `exceljs` is heavy), `postal-mime`, `@kenjiuno/msgreader`. The output is plain server-rendered text, so TextReview's quote flags work on it, and email bodies reuse `sanitizeEmailHtml` (the same hostile-mail profile as synced Gmail: no scripts, remote images blocked). Size caps (10 MB workbook, 25 MB email), zip-bomb bounds and row/column/sheet caps apply; every failure is a reason card.
- **TIFF and HEIC decode in the browser** from the auth-gated download route: TIFF with `utif` inside a Web Worker (its page-chain walk has no cycle guard, so a hostile file could spin forever; the worker is terminated after a timeout), HEIC with `heic-to` (libheif WASM, loaded on demand). Neither touches the server's CPU, and neither changes the download route's inline allowlist (fetch ignores Content-Disposition).
- PowerPoint and legacy .xls/.doc stay download-only: faithful rendering needs a real office converter (e.g. LibreOffice on a server), a bigger decision.

**Trade-offs:**
- (+) Four common evidence formats open inline; spreadsheets and emails take quote flags
- (-) Spreadsheets show values only (no formatting, formulas or charts); email attachments are listed, not opened
- (-) TIFF/HEIC flags are anchorless for now (page/region tagging deferred); heic-to is LGPL (loaded unmodified as a separate module)
