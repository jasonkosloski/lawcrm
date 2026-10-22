# Text styles for document templates — design

**Date:** 2026-10-22
**Tier:** Full (schema change; more than a day)
**Status:** Design approved in chat; awaiting spec review.

## Intent

Firms format filings and letters with named paragraph styles, the way they do in Word: a Caption paragraph, a Block quote, a Signature block. Today a template only knows Body text (from the house style) and three fixed heading sizes, with spacing set once for the whole document.

Success: picking "Caption" on a paragraph looks the same in the editor, the preview, the Word file and the PDF; changing the Caption style in Settings changes every template that uses it on its next generation; a court can require different spacing for a style without the firm editing its templates.

### What the user decided

- Named, firm-wide paragraph styles, defined in Settings → Documents beside the house style.
- A fixed set of built-in styles that always exist (editable, not deletable) plus firm-created custom styles.
- Styles are independent: each spells out every value; nothing inherits.
- Court formats override individual values of individual styles; styles a court doesn't mention stay as the firm defined them.
- Paragraphs pick a style; a paragraph can carry direct settings (spacing, line spacing, alignment, indents, page flow) and selected text can carry marks (bold, italic, underline, small caps, plus new all caps and font size). "Clear formatting" returns to the style.
- Storage approach A: a validated JSON list on the house style row, sparse JSON overrides on the court format row.

### Assumptions (stated in chat, not contradicted)

- The font family stays firm-wide (or per court), not per style: the PDF embeds bundled faces and documents use one face.
- Word output uses real Word styles, so the styles show in Word's style gallery.
- Existing templates render exactly as today after the migration.

## 1. Data model

### Style values

| Group     | Field                                                  | Values                                                                        |
| --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Character | `sizePt`                                               | 8–72, step 0.5                                                                |
|           | `bold`, `italic`, `underline`, `smallCaps`, `allCaps`  | boolean                                                                       |
| Paragraph | `align`                                                | left, center, right, justify                                                  |
|           | `indentLeftIn`, `indentRightIn`                        | 0–4, step 0.01                                                                |
|           | `firstLine`                                            | `{ kind: "none" }`, `{ kind: "indent", in }`, `{ kind: "hanging", in }` (0–4) |
| Spacing   | `spaceBeforePt`, `spaceAfterPt`                        | 0–72                                                                          |
|           | `lineSpacing`                                          | `"single" \| "1.15" \| "1.5" \| "double"` or `{ exactPt }` (6–144)            |
| Flow      | `keepWithNext`, `keepLinesTogether`, `pageBreakBefore` | boolean                                                                       |

A style is `{ key, name, builtIn, values }`. `values` always holds every field (styles are independent).

### Built-in styles

Keys are fixed: `body`, `title`, `heading1`, `heading2`, `heading3`, `caption`, `blockquote`, `signature`. Built-ins can be renamed and edited, never deleted. Defaults (from the firm's current house style `S` = size, line spacing, space after):

- **Body:** S; left; no indents; space before 0.
- **Title:** S size, bold, all caps, centered, space after S.
- **Heading 1/2/3:** bold at S+6 / S+4 / S+2 pt (today's `headingSizePt`), keep with next.
- **Caption:** S size and line spacing, space after 0.
- **Block quote:** S size, single spacing, 0.5in left and right indent.
- **Signature:** S size and line spacing, space after 0, keep lines together.

### Custom styles

Created with a name; the key is a slug of the name at creation (`numbered-allegation`, deduplicated with `-2`), unique within the firm, and never changes on rename. Names are unique (case-insensitive), 1–60 characters. At most 50 styles per firm.

### Storage

- `DocumentStyle.paragraphStyles Json` — the full list. Validated by a zod schema in `src/lib/templates/paragraph-styles.ts` on every save and parsed defensively on every read.
- `CourtFormat.styleOverrides Json @default("{}")` — `{ [styleKey]: Partial<values> }`. An override for a key the firm no longer has is ignored.
- Migration (expand-only, per [ADR-058](../../decisions/058-production-build-applies-expand-only-migrations.md) practice): add both columns; backfill `paragraphStyles` from each firm's `fontSizeHalfPt`, `lineSpacing`, `spaceAfterPt` using the defaults above; backfill each court's non-null `fontSizeHalfPt`, `lineSpacing`, `spaceAfterPt` into `styleOverrides.body`. The old columns stay (still written in sync, see phase 4) until a later migration drops them, as with `DocumentTemplate.body`. Migration made with `migrate diff` against a local scratch DB (repo practice), and the backfill verified there.

### Permissions

Editing styles: existing `firm.edit_document_style`. Court overrides: existing `court_formats.edit`. Reading styles: anyone who can open the template editor (styles are not sensitive). No new permission keys.

## 2. Template content and resolution

### Content contract (`src/lib/templates/schema.ts`)

- `paragraph.attrs.style?: string` — a style key. Absent means `body`. Applies to every paragraph, including those in table cells, list items, blocks, Show-if and Repeat.
- Direct paragraph settings, all optional: `textAlign` (existing), `spaceBeforePt`, `spaceAfterPt`, `lineSpacing`, `indentLeftIn`, `indentRightIn`, `firstLine`, `keepWithNext`, `keepLinesTogether`, `pageBreakBefore`. Same ranges as style values. A setting equal to "absent" is dropped on save.
- Marks: existing `bold`, `italic`, `underline`, `smallCaps`; new `allCaps`; new `fontSize` with `attrs.pt` (8–72, step 0.5). SMS still rejects all formatting.
- Headings: `heading` nodes stay valid input. They are converted to `paragraph` + `style: heading1|2|3` (keeping `textAlign`) on open in the editor and before rendering, in the same place legacy bodies are converted (`initialDoc` / the render entry). New saves write paragraphs only.
- Unknown style keys are accepted on save (a style may be deleted later). They render as Body, and `checkTemplateFit` reports them ("Unknown style: …") alongside unknown fields.

### Resolution

New pure module `src/lib/templates/resolve-styles.ts`:

```
resolveParagraph(paragraph, styles, courtOverrides | null) → ResolvedParagraphStyle
```

Order, per field: paragraph direct setting → court override for that style (filings only) → firm style → built-in default for that key (or Body's, for an unknown key). The renderer (`renderTemplate`, which already resolves fields) attaches the result to each `ResolvedParagraph` as `attrs.resolved` and keeps `attrs.style`, so Word, PDF and HTML never resolve styles themselves. `PageStyle` gains `styles` (the effective style list after court overrides, for Word's styles.xml and the editor). Its existing `sizePt`, `lineSpacing` and `spaceAfterPt` are taken from the effective Body style, so code that reads them (headers, page numbers, list markers) follows Body; the legacy house-style and court columns stop being read.

Lists: markers and level indents are unchanged; the item paragraph's resolved indent adds to the list indent; its spacing and character values apply.

## 3. Output

All three read `attrs.resolved` from section 2.

### Word (`to-docx.ts`)

- Each effective style becomes a Word paragraph style: Body as `Normal` (id `Normal`), others with id = key and the style's name; headings with `outlineLevel` 0/1/2 and `basedOn` none (independent styles). Run properties: size, bold, italics, underline, `smallCaps`, `allCaps`. Paragraph properties: alignment, `indent` (left, right, firstLine/hanging in twips), `spacing` (before/after in twips; line: auto ×240 for multiples, `exact` for `{ exactPt }`), `keepNext`, `keepLines`, `pageBreakBefore`.
- Each paragraph references its style and writes only its direct settings and marks.
- The document default (`styles.default.document`) mirrors Body.

### PDF (`to-pdf.tsx`)

- Per paragraph: `fontSize`, weight/style, `marginTop`/`marginBottom`, `lineHeight` (multiple × the font's natural line height, as today; exact = `exactPt`/size), `paddingLeft`/`paddingRight` for indents, `textIndent` for first line (hanging = negative `textIndent` plus extra `paddingLeft`), `textTransform: "uppercase"` for all caps, the small caps helper for small caps.
- `pageBreakBefore` → `break`; `keepLinesTogether` → `wrap={false}`; `keepWithNext` → `minPresenceAhead` of the next paragraph's first line height (an approximation; documented).
- `naturalWidth` (fit tables) measures with resolved size, caps and indents.
- Header/continuation blocks use the same resolution.

### Preview and email HTML (`to-html.ts`, `sanitize-html.ts`)

- Each `p` gets an inline `style` with its resolved values: `margin-top`, `margin-bottom`, `margin-left`, `margin-right`, `text-indent`, `line-height`, `font-size`, `font-weight`, `font-style`, `text-transform`, `font-variant`, `text-align`, `break-before`.
- The document sanitizer allows exactly those properties on `p`/`h1–h3`, each with a strict regex (numbers with `pt`, `in`, `px` or `%`; fixed keyword sets). Everything else stays stripped. Tests cover rejection of other properties and values.
- Inline styles also give emailed templates real spacing (email clients never see the preview stylesheet).
- Page-flow switches have no effect in the one-page preview except page break before, shown like today's page break.

### Plain text / SMS

Styles ignored; `allCaps` (style or mark) uppercases.

## 4. Screens

### Template editor

- **Style** dropdown at the start of the toolbar (replaces H1/H2): shows the current paragraph's style, each option previewed in its own look; built-ins first, then custom. A dot marks paragraphs with direct settings.
- The editor renders paragraphs with the effective style values (passed in with the page, like the house style), so the editor matches the output.
- **Paragraph…** dialog for direct settings: spacing, line spacing, indents, first line, flow, alignment. Each field shows the style's value as a placeholder; a reset control per field.
- Text: **All caps** button beside small caps; a **size** input; **Clear formatting** removes direct settings and marks.
- The editor's own HTML (clipboard, kind-change reseed) carries the style key as `data-style` and direct settings as `data-*` attributes, so copy/paste between templates is lossless. This is separate from the output HTML of section 3, which carries resolved inline styles.

### Settings → Documents → Styles

- New section under the house style: style list on the left, the selected style's form on the right with live sample text.
- Add custom (copies the selected style), rename, delete custom. Delete is refused while any template or block references the key; the message names them (scan of `DocumentTemplate.content` and `TemplateBlock.content`).
- Saved as one form with the house style's stale check (`expectedUpdatedAt`); read-only without `firm.edit_document_style`. Server action in `src/app/actions/document-style.ts`, logged with `logActivity`.

### Court format editor

- New **Styles** section listing the firm's styles; per style, set only the values the court changes; unset fields show the firm's value as a placeholder.
- The court's current font size, line spacing and space after fields move into this section as Body overrides (phase 4 writes both the override and the legacy column so older code paths stay consistent until the drop migration).

## 5. Errors, testing, phases

### Errors

- Style and override saves validate on the server with specific messages ("Space after must be 0–72 pt.", "A style named Caption already exists.", "Body can't be deleted.", "Caption is used by 3 templates: …").
- Template saves reject malformed paragraph settings; unknown style keys are allowed (rendered as Body, reported in the fit check).
- A missing or unparseable stored style list falls back to built-in defaults derived from the house style and logs a warning, so documents always render.

### Testing

- Unit: style schema, slug/dedupe, resolver order, heading conversion, migration backfill (scratch DB).
- Output: Word `styles.xml` style definitions and paragraph properties; PDF text positions proving space before/after, indents, hanging indent, exact line spacing and page break before; HTML inline styles surviving the sanitizer and disallowed ones stripped.
- Editor: Style dropdown, Paragraph dialog, Clear formatting, round trip of every new attribute through JSON and HTML.
- Actions: permissions, stale check, delete refused while in use, court override save.
- Visual: one sample filing using every built-in style, rendered to PDF and compared by eye with the Word file.

### Phases (each shippable)

1. Model, migration, `paragraph-styles.ts`, resolver, Settings → Styles. Body drives output exactly as today.
2. Content contract, heading conversion, `allCaps` and `fontSize` marks, Word/PDF/HTML output.
3. Editor: Style dropdown, Paragraph dialog, Clear formatting, editor rendering real styles.
4. Court overrides UI and the move of the court's document-wide fields into Body overrides.

### Out of scope

List styles (numbering formats), character styles as a separate kind, per-style fonts, importing styles from a Word file. Added to the documents feature file's follow-ups.

## Docs to update when shipping

- New ADR: text styles are firm-wide independent named styles stored as JSON, court overrides per style, resolved once before rendering.
- `docs/features/documents.md` (feature entry, follow-ups) and its `docs/ROADMAP.md` line.
- `docs/SCHEMA_NOTES.md`: the JSON columns and the legacy columns kept in sync until dropped.
- Delete this spec and the plan when the feature ships, folding anything lasting into the ADR and feature file.
