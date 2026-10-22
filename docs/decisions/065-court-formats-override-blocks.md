# ADR-065: Court formats override blocks and formatting

**Date:** 2026-10-22
**Status:** Accepted.

**Context:** Filings must follow each court's rules (caption, font, margins, paper size), and the firm files in several states plus federal court. Venues already exist per matter ([ADR-055](055-venues-are-a-firm-list-required-fields-are-per-area.md)). Formatting is layered outside templates ([ADR-063](063-templates-are-structured-documents.md)) and both outputs render from one `PageStyle` ([ADR-064](064-letters-render-twice-from-one-style.md)).

**Decision:**

- A firm-defined `CourtFormat` (Settings, Court formats) holds optional formatting overrides on top of the house style (font, size, spacing, margins, page numbers), a paper size (Letter or Legal) and block replacements (`CourtFormatBlock`: block A is swapped for block B, e.g. the caption).
- A venue picks a court format and carries a caption name. A matter's `courtCaption` field feeds the caption.
- Applies to filings only; letters keep the house style. A filing for a matter whose venue has an active format uses it in Word, PDF and previews.
- Replacements apply to blocks a template inserts, and to the style's letterhead and continuation references. Blocks cannot contain blocks, so there is no nested case.
- An archived format is ignored (house style applies) with a note in the UI.
- The template editor's "Preview as" shows a template under a chosen format, since the swap is invisible in the template itself.
- Three permission keys: `court_formats.add`, `.edit`, `.delete`. The Court formats pages return not-found for staff holding none of them and the nav entry is hidden, like Venues; no `.view` key exists.
- No stale guard for court-format edits between a preview and the save: same precedent as house style and blocks. Word and PDF still match each other; a saved filing can differ from its earlier preview if the format changed in between.

**Rejected:**

- Template "slots" for court-specific parts: pushes court knowledge into every template.
- Per-court template variants: multiplies templates; revisit only if overrides prove too weak.
- Hard-coded state rules: the firm could not correct or extend them.

**Trade-offs:**

- (+) One template serves every court; courts are configured, not coded
- (+) Same resolver feeds Word, PDF and previews
- (-) The swap is invisible in the template, hence "Preview as"
- (-) Pleading paper and line numbers are not supported
- (-) Staff without a court_formats key cannot view formats read-only
