# ADR-067: Text styles are firm-wide independent JSON, resolved once before rendering

**Date:** 2026-10-22
**Status:** Accepted.

**Context:** Firms format filings and letters with named paragraph styles (Caption, Block quote, Signature), as in Word. Templates ([ADR-063](063-templates-are-structured-documents.md)) knew only Body text from the house style and three fixed heading sizes, with spacing set once per document. Courts also need to change individual values of individual styles ([ADR-065](065-court-formats-override-blocks.md)). Output renders to Word, PDF and an HTML preview from one resolved document ([ADR-064](064-letters-render-twice-from-one-style.md), [ADR-066](066-template-tables-split-into-rows-and-columns.md)).

**Decision:**

- Styles are firm-wide, named and independent: each style spells out every value (size, bold/italic/underline/small caps/all caps, alignment, indents, first line, space before/after, line spacing, keep with next, keep lines together, page break before). Nothing inherits. Eight built-ins always exist (body, title, heading1-3, caption, blockquote, signature): renamable and editable, never deletable. Firms add custom styles (slug key fixed at creation, at most 50).
- Storage is JSON validated in code (`src/lib/templates/paragraph-styles.ts`): the full list in `DocumentStyle.paragraphStyles`, sparse per-style overrides in `CourtFormat.styleOverrides`. `paragraphStyles` stays NULL until the firm first saves styles; NULL means defaults derived from the house style. No SQL backfill.
- A paragraph stores a style key (absent = body) plus optional direct settings; text carries marks (bold, italic, underline, small caps, all caps, font size). Settings are overrides, so an explicit 0, false or "none" is kept.
- One pure resolver (`resolve-styles.ts`) runs once, in `renderTemplate`, per field: paragraph direct setting, then court override (filings), then the firm style, then the built-in default. Word, PDF and HTML read the result (`attrs.resolved`) and never resolve styles themselves.
- Unknown style keys (a style deleted later) render as Body and show as warnings; they never block a save. Deleting a style is refused while a template or block uses it.
- Template headings are stored as paragraphs with heading1-3 styles; old `heading` nodes convert on open and before render.
- Word gets real paragraph styles; Normal, Title and Heading 1-3 use Word's built-in ids and names so the navigation pane and outline levels work, so a firm's rename of those is not visible in Word. The preview HTML carries resolved inline styles under a strict per-property sanitizer allowlist.
- Font family stays firm-wide (or per court), not per style.
- The legacy house size/spacing columns are no longer read: Body is the source. The legacy court columns are mirrored from `styleOverrides.body` on every court save and still overlaid on read, because existing courts hold their values only there. Both sets are dropped in a later expand-only migration.

**Rejected:**

- A normalized table of styles (one row per style, one per court override): relational queries nobody needs, a join on every render, and a larger migration, for a list capped at 50 that is always read whole.
- Styles that inherit (`basedOn`, as in Word): the resolver, the editor's "what does this style say" display and court overrides all get harder to reason about, and a change to Body would silently move other styles. Independent styles can be read at a glance and a court override touches exactly one style.
- A SQL backfill of `paragraphStyles` at migration time: hand-built JSON in a production migration for no difference in output; the loader's derived defaults give the same result.

**Trade-offs:**

- (+) One resolver feeds every output, so the editor, preview, Word and PDF cannot drift
- (+) Expand-only migration; existing templates and courts render as before
- (-) Independent styles mean changing the size everywhere takes editing each style
- (-) PDF keep-with-next is an approximation (react-pdf `minPresenceAhead` of the next paragraph's first line), so a heading can occasionally strand
- (-) Sent emails carry no template styles: the outgoing-mail sanitizer is a deliberate security boundary and was not widened. Preview shows spacing the email lacks
- (-) The legacy-column mirror is extra writes until the drop migration
- (-) JSON is validated by code, not the database, so reads parse defensively
