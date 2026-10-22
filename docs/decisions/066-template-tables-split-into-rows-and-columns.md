# ADR-066: Template tables merge freely if the PDF can split them; shared edges take the heavier rule

**Date:** 2026-10-22
**Status:** Accepted.

**Context:** Court captions (e.g. Colorado's JDF flexible caption) are tables: uneven columns, a title across the full width, thick rules around the parties, a court-use box with no inner line, text pinned to the bottom of a cell. Templates render to Word, PDF and an HTML preview from one resolved document ([ADR-064](064-letters-render-twice-from-one-style.md)). The PDF engine (react-pdf) lays a table out as rows of side-by-side boxes, with no table model of its own.

**Decision:**

- Tables have a width setting: full (margin to margin, the default and what older tables already did in Word and PDF) or fit to content. Full tables keep the editor's column proportions; fit tables size to content (Word autofits, the PDF measures text with fontkit).
- Cells may merge across columns (`colspan`) and down rows (`rowspan`). The PDF has no table model, so it draws a table by splitting it (`splitLayout`, `src/lib/templates/table-split.ts`): along full row lines no cell crosses into bands (which may break across pages), then along full column lines into side-by-side pieces that stretch to one height, repeating until each piece is one cell. A band of up to 10 rows stays on one page; a taller one may break. Holes in a ragged row are drawn as empty cells in every output. A merge that leaves no clean cut (cells interlocking like a pinwheel) is refused by the editor and the schema, so the PDF never meets one.
- Each cell side is none, thin (0.5pt) or thick (1.5pt); absent means thin, so older content renders as before. Vertical alignment is top (default), middle or bottom; horizontal alignment stays on the paragraphs inside the cell.
- The editor's border commands set both cells along a shared edge. Word and the preview get each cell's declared sides and collapse each shared segment themselves (heavier wins); the PDF draws every edge once, resolved with the same rule in `src/lib/templates/table-layout.ts`.
- Resizing one column makes the editor record every column's on-screen width, so outputs see the split the editor shows.
- The PDF falls back to DejaVu Sans for glyphs the text fonts lack (ballot boxes ☐ ☑ ☒, check marks), after Liberation Sans.

**Rejected:**

- Column spans only, merging across a row (first version of this ADR): a tall box had to be two stacked cells with the line between them off, which users found unnatural.
- Absolutely positioned PDF cells from measured row heights: our text measurement would have to match react-pdf's line breaking exactly, or text overflows its cell.
- Free-form border styles (colours, double, dashed): no court form we target uses them, and each one is three renderers' worth of work.
- Inline border styles in the preview HTML: the document sanitizer would have to admit border CSS; data attributes styled by the preview's own CSS keep the allowlist to a numeric `<col>` width.

**Trade-offs:**

- (+) One layout module feeds Word, PDF and preview
- (+) No migration: every setting is an optional attribute with today's output as its default
- (-) Fit-to-content widths are Word's autofit in .docx and our own measurement in the PDF, so they can differ slightly
- (-) In the PDF, a cell meeting several cells across one side draws that side at one weight; Word and the preview can vary it per segment
- (-) In the PDF, cells stacked beside a taller merged cell share its extra height evenly (Word gives it to the last row), so inner lines can sit slightly differently
- (-) Pinwheel-style merges are refused
- (-) Emailed templates get table structure but not borders (mail clients never see the preview CSS)
