# ADR-063: Templates are structured documents, with formatting layered outside them

**Date:** 2026-10-22
**Status:** Accepted.

**Context:** Templates are a daily tool (letters, later emails, texts and filings), and each firm customizes its own. The first engine stored plain text with `{{token}}` placeholders: no formatting, no lists, no optional sections, no reusable pieces. Letters, emails, texts and filings should share one format so later outputs reuse the same engine.

**Decision:**

- A template's `content` is ProseMirror (TipTap) JSON with real `field`, `block`, `showIf`, `repeat` and `listField` nodes, validated by a hand-written validator (`src/lib/templates/schema.ts`: allowed nodes per `kind`, depth and size caps) on every save. Not text tags, not Markdown.
- Reusable pieces (letterhead, signature, closing, certificate of service) are firm-editable `TemplateBlock` rows. Templates reference a block by id inside `content`; "used by" is computed by scanning content, and a block still referenced cannot be deleted.
- Logic is fields, lists and simple conditions only (present / empty / true / false / in). No free-form expressions, comparisons or math.
- Templates hold content, never formatting. Formatting layers: firm house style (font, spacing, margins, letterhead placement), overridden by court rules for filings. Until those ship, `.docx` output uses plain defaults.
- One typed field catalog (`src/lib/templates/catalog.ts`) says what each field is, which scopes (matter, lead) it is valid in and which formats it allows. Templates work on matters and leads.
- `renderTemplate` is pure: it resolves content and data into a plain `ResolvedDoc` plus a report (missing, invalid, archived blocks), never silently dropping anything. One deliberate exception (amended 2026-10-23): a field chip set to "If missing → Leave blank" (`ifMissing: "hide"`) prints nothing when empty, and a paragraph emptied only by such fields is dropped. The author chose that blank, so it goes in the report's `blank` list (shown in the editor preview) rather than `missing` (the warnings at generate and send time). Unknown or out-of-scope paths are never hidden. Converters (html, plain text, docx) read the `ResolvedDoc`. Data loading is server-only and passes through the matter/lead scope guards first.
- Blocks nest (amended 2026-10-23): a block's content may include other blocks, up to 5 levels deep. Loops and depth are refused on save, checked over the whole block graph under one transaction-scoped advisory lock (`pg_advisory_xact_lock`, `src/lib/templates/block-graph-db.ts`; pure rules in `block-graph.ts`) so two saves cannot jointly create a cycle; the renderer guards against both anyway and reports an over-deep block rather than recursing. Each block has `appliesTo` (matter, lead, both; existing rows default to both): its own fields are checked against that scope on save, while misfits further up the chain only warn in the editor preview and never block a save. Delete's usage check stays outside the lock (accepted race; a missing block renders `[Missing block]`).
- Legacy plain-text bodies convert lazily (when opened in the editor or generated from), not by a bulk rewrite. `DocumentTemplate.body` stays, nullable, until every row is converted; a later expand-only follow-up migration drops it.

**Rejected:**

- Uploading Word files as templates: the firm wants templates authored in the app, and house-style/court formatting cannot be applied to a file that carries its own. May return later as an import.
- Text tags in the stored body: fragile to edit, no real formatting, and every output would need its own parser.
- Markdown: no fields, blocks or conditions without inventing tags again.
- Free-form logic: unreviewable by non-programmers and a way to ship broken letters; the fixed condition set covers the real cases.

**Trade-offs:**

- (+) One format and one engine for every later output; the editor shows fields, blocks and rules as objects, not syntax
- (+) Formatting changes (house style, court rules) never touch template content
- (-) A stored content tree is only as good as the schema that validates it; node changes need migration care
- (-) Block references live in JSON, so referential integrity is app-enforced (the delete refusal, the save-time loop and depth checks)
- (-) Authoring is desktop-only and needs a rich editor
