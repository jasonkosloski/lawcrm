# ADR-066: Template tables merge across a row only; shared edges take the heavier rule

**Date:** 2026-10-22
**Status:** Accepted.

**Context:** Court captions (e.g. Colorado's JDF flexible caption) are tables: uneven columns, a title across the full width, thick rules around the parties, a court-use box with no inner line, text pinned to the bottom of a cell. Templates render to Word, PDF and an HTML preview from one resolved document ([ADR-064](064-letters-render-twice-from-one-style.md)). The PDF engine (react-pdf) lays a table out as rows of side-by-side boxes, with no table model of its own.

**Decision:**

- Tables have a width setting: full (margin to margin, the default and what older tables already did in Word and PDF) or fit to content. Full tables keep the editor's column proportions; fit tables size to content (Word autofits, the PDF measures text with fontkit).
- Cells may merge across a row (`colspan`); merging down a column (`rowspan`) is rejected by the schema and not offered in the editor. A tall box is two stacked cells with the line between them turned off.
- Each cell side is none, thin (0.5pt) or thick (1.5pt); absent means thin, so older content renders as before. Vertical alignment is top (default), middle or bottom; horizontal alignment stays on the paragraphs inside the cell.
- The editor's border commands set both cells along a shared edge. Word and the preview get each cell's declared sides and collapse each shared segment themselves (heavier wins); the PDF draws every edge once, resolved with the same rule in `src/lib/templates/table-layout.ts`.
- Resizing one column makes the editor record every column's on-screen width, so outputs see the split the editor shows.
- The PDF falls back to DejaVu Sans for glyphs the text fonts lack (ballot boxes ☐ ☑ ☒, check marks), after Liberation Sans.

**Rejected:**

- Row spans: react-pdf has no way to stretch one box across rows; it would mean a column-based or absolutely positioned table layout of our own. Revisit if a court form genuinely needs a box the stacked-cells trick can't draw.
- Free-form border styles (colours, double, dashed): no court form we target uses them, and each one is three renderers' worth of work.
- Inline border styles in the preview HTML: the document sanitizer would have to admit border CSS; data attributes styled by the preview's own CSS keep the allowlist to a numeric `<col>` width.

**Trade-offs:**

- (+) One layout module feeds Word, PDF and preview
- (+) No migration: every setting is an optional attribute with today's output as its default
- (-) Fit-to-content widths are Word's autofit in .docx and our own measurement in the PDF, so they can differ slightly
- (-) In the PDF, a merged cell above split cells draws its bottom rule at one weight across its width; Word and the preview can vary it per segment
- (-) Emailed templates get table structure but not borders (mail clients never see the preview CSS)
