# Shared editor core — design

**Date:** 2026-10-22
**Tier:** Full (cross-cutting refactor; touches two sanitizer boundaries; more than a day)
**Status:** Design approved in chat; awaiting spec review.

## Intent

The app has two independent TipTap editor setups — the template editor (templates, blocks, email subjects) and `RichTextEditor` (notes, replies, captures, calendar notes, email compose/reply, email signature) — each with its own toolbar, buttons, list handling and lazy loading. Fixes land in one and not the other (e.g. list bullets were missing in the template editor; the notes editor still lacks them). The user wants editors not to reinvent the wheel.

Success: every editor is built from one shared shell, one set of toolbar controls and named extension presets; a fix to a control or the shared CSS lands everywhere it applies; each preset's output is pinned to its sanitizer by a test.

### What the user decided

- One core with per-surface presets (not identical features everywhere, not code-sharing only).
- Presets: **Notes**, **Email**, **Document**.
- Sent email keeps template paragraph styles under a strict allowlist (resolves the open follow-up from ADR-067).
- Structure: approach A — a shared module with a shell, composable controls and presets, each preset paired with its sanitizer and a parity test.

## 1. Module layout

`src/components/editor/`:

- `editor-shell.tsx` — the one wrapper: client-only lazy load (replaces `rich-text-editor-lazy.tsx`), `EditorContent`, focus/aria, read-only, placeholder, padding, and the shared content CSS (lists: disc/decimal, 2em indent; quotes; table borders and cell padding; empty-paragraph height). The template editor's `BODY_CLASS` keeps only document-specific rules on top.
- `controls/` — `ToolButton`, `Divider`, mark buttons (bold, italic, underline, strike, code, small caps, all caps), list buttons, align buttons, link button, `TableMenu`, `FontSizeField`. Moved from `src/components/templates/editor/` and `src/components/shared/rich-text-editor.tsx`; one implementation each.
- `presets.ts` — `notesExtensions()`, `emailExtensions()`, `documentExtensions(opts)` (re-export of `createTemplateExtensions`, which stays in the template editor folder because it owns fields/blocks/sections).

Surfaces compose:

| Surface                                             | Preset                     | Toolbar                                                                                                    | Stored as / sanitizer                  |
| --------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Notes, note replies, captures, calendar event notes | Notes                      | standard (headings, marks, lists, quote, code)                                                             | HTML / `sanitizeUserHtml` (unchanged)  |
| Email compose, reply, signature                     | Email                      | standard + underline, align, link, table                                                                   | HTML / new `sanitizeOutgoingEmailHtml` |
| Templates, blocks                                   | Document                   | standard + template controls (fields, blocks, rules, Style menu, Paragraph dialog, table menu, caps, size) | JSON / content schema                  |
| Email template subject                              | Document, single-line mode | field insert only                                                                                          | JSON / `validateSubject`               |

`RichTextEditor` becomes a thin surface: shell + Notes (or Email via a prop) preset + standard toolbar. Its public props stay compatible for existing callers.

## 2. Presets

- **Notes:** exactly today's `createEditorExtensions()` (StarterKit, headings 2–3, horizontal rule off).
- **Email:** Notes + Underline, TextAlign (paragraph, heading), Link (http, https, mailto; `rel="noopener noreferrer"`, `target="_blank"`), Table/TableRow/TableCell/TableHeader (no resizing, no merged cells), and a paragraph style passthrough: paragraphs keep an inline `style` attribute filtered to the outgoing allowlist on parse and render, so template HTML inserted into compose keeps its spacing through editing.
- **Document:** `createTemplateExtensions` unchanged.

Each preset has a parity test: render every node/mark the preset can produce (including table cells and styled paragraphs for Email), sanitize with the preset's profile, and assert the HTML is unchanged; and assert representative tags/attributes outside the preset are stripped.

## 3. Outgoing email sanitizer

`sanitizeOutgoingEmailHtml` in `src/lib/sanitize-html.ts`, derived from the `sanitizeUserHtml` options plus:

- Tags: `u`, `a`, `table`, `tbody`, `thead`, `tr`, `td`, `th`, `span`.
- Attributes: `a[href]` with schemes http/https/mailto only (no protocol-relative), `rel`/`target` forced by a transform; `td`/`th[colspan,rowspan]`; `style` on `p`, `span`, `td`, `th` only.
- Styles: the document profile's anchored per-property allowlist — `margin-*` (non-negative lengths), `text-indent` (signed length), `line-height` (length or bounded unitless), `font-size` (pt), `font-weight`, `font-style`, `text-transform`, `font-variant`, `text-align`. No `url(`, `expression(`, `position`, colours, or `class` anywhere.
- `sanitizeUserHtml` (notes) and `sanitizeEmailHtml` (synced inbound mail) are not changed.

Applied server-side wherever a sent body or signature is written today (email-send and the compose/reply/signature actions); stored sent mail is not re-sanitized. A test pins each call site to the outgoing profile.

## 4. Data flow and existing content

- "Use template" HTML (already document-sanitized, carrying resolved inline styles) is inserted into the compose editor; the Email preset keeps allowed styles; on send the outgoing profile keeps them, so recipients see the preview's spacing and alignment.
- Notes keep today's preset and sanitizer: no stored note changes meaning.
- Drafts and signatures re-open unchanged (Email is a superset of today's compose set).
- No database migration.

## 5. Testing

- Preset parity tests (section 2), outgoing-sanitizer negative and positive tests (section 3), call-site tests.
- Shell/control component tests: list markers, quote and table CSS present; each control toggles its mark/node; read-only hides controls.
- All existing notes, compose, reply, signature and template-editor tests pass unchanged (regression gate).
- New: a template inserted into compose keeps styles in the editor and in the sent HTML; adding a link in compose; a table in a signature round-trips.

## 6. Phases (each shippable)

1. Shell and controls moved to `src/components/editor/`, both toolbars pointed at them, shared content CSS in the shell. No behaviour change except the notes editor now shows list markers.
2. `presets.ts` with Notes and Document + parity tests; `RichTextEditor` = shell + Notes preset.
3. Email preset, `sanitizeOutgoingEmailHtml` at every send/signature write, link and table controls in compose/reply/signature, the "Use template" round trip.
4. Cleanup: remove duplicated toolbar code and `rich-text-editor-lazy.tsx`; ADR "one editor core, presets paired with sanitizers"; `docs/UI_PATTERNS.md`; `docs/features/communication-email.md`; `docs/features/documents.md` (styled sent email no longer a follow-up).

## Out of scope

Images in email, mentions, collaborative editing, moving notes to JSON storage.
