# ADR-063: Templates are structured documents, with formatting layered outside them

**Date:** 2026-10-22
**Status:** Accepted.

**Context:** Templates are a daily tool (letters, later emails, texts and filings), and each firm customizes its own. The first engine stored plain text with `{{token}}` placeholders: no formatting, no lists, no optional sections, no reusable pieces. Letters, emails, texts and filings should share one format so later outputs reuse the same engine.

**Decision:**

- A template's `content` is ProseMirror (TipTap) JSON with real `field`, `block`, `showIf`, `repeat` and `listField` nodes, validated by a zod schema (allowed nodes per `kind`, depth and size caps) on every save. Not text tags, not Markdown.
- Reusable pieces (letterhead, signature, closing, certificate of service) are firm-editable `TemplateBlock` rows. Templates reference a block by id inside `content`; "used by" is computed by scanning content, and a block still referenced cannot be deleted.
- Logic is fields, lists and simple conditions only (present / empty / true / false / in). No free-form expressions, comparisons or math.
- Templates hold content, never formatting. Formatting layers: firm house style (font, spacing, margins, letterhead placement), overridden by court rules for filings. Until those ship, `.docx` output uses plain defaults.
- One typed field catalog (`src/lib/templates/catalog.ts`) says what each field is, which scopes (matter, lead) it is valid in and which formats it allows. Templates work on matters and leads.
- `renderTemplate` is pure: it resolves content and data into a plain `ResolvedDoc` plus a report (missing, invalid, archived blocks), never silently dropping anything. Converters (html, plain text, docx) read the `ResolvedDoc`. Data loading is server-only and passes through the matter/lead scope guards first.
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
- (-) Block references live in JSON, so referential integrity is app-enforced (the delete refusal)
- (-) Authoring is desktop-only and needs a rich editor
