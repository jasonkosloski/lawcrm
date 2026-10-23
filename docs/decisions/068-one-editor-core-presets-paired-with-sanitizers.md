# ADR-068: One editor core; each preset is paired with its sanitizer

**Date:** 2026-10-23
**Status:** Accepted.

**Context:** Three TipTap setups had grown apart: the notes/compose editor (`RichTextEditor`), the template editor, and the subject editor. Each had its own toolbar, content CSS and StarterKit configuration. Email could not carry template styling, links or tables because the composer's editor did not know the outgoing sanitizer, and the two kept drifting ([ADR-067](067-text-styles-are-firm-json-resolved-once.md)).

**Decision:**

- One editor core in `src/components/editor/`: `editor-shell.tsx` (content CSS, aria, placeholder, read-only), `controls/` (toolbar buttons: marks, blocks, alignment, link popover, table menu) and `presets.ts`. A surface picks a preset and composes controls; every editor takes its extensions from a preset (the template body and subject use `documentExtensions`) and renders through `EditorShell`; it never configures its own StarterKit. A guard test fails if `@tiptap/starter-kit` is imported anywhere else (the template editor's `extensions.ts` is the one other allowed place).
- Three presets: Notes (`notesExtensions`), Email (`emailExtensions`) and Document (`documentExtensions`). Each is paired with the sanitizer that guards its output, and parity tests in `presets.test.ts` run what the editor can emit through that sanitizer and expect it back unchanged (and the reverse for what the sanitizer keeps).
- Email has its own outgoing profile, `sanitizeOutgoingEmailHtml` (compose, reply, signatures; applied server-side in the send actions): notes plus underline, links (http/https/mailto/tel, forced `rel`/`target`), plain tables and a bounded set of paragraph/span/cell styles (including the bounded `margin` shorthand). It is stricter than the inbound email profile and shares the document profile's style allowlist definitions.
- The Email editor keeps template styling through a style passthrough (`style-passthrough.ts`) that filters on parse and render with the server's own cleaner, `cleanOutgoingStyleValue`. Small caps are carried as `font-variant:small-caps` on the span, so they survive.

**Rejected:**

- B, one editor component with feature flags: every new surface adds a flag, flags interact (table plus alignment plus passthrough), and the pairing with a sanitizer becomes implicit. Presets make the contract a named object that can be tested.
- C, share only the toolbar buttons: the real drift was in the extension set and the sanitizer pairing, not the buttons, so it would have left the actual problem in place.

**Trade-offs:**

- (+) A new surface gets a toolbar, CSS and a tested sanitizer pairing by choosing a preset
- (+) The Email editor cannot hold a style or link the server would strip
- (-) The client bundle includes the server's style cleaner (`sanitize-html`'s allowlist data and the cleaner) for the Email preset
- (-) Notes keep StarterKit's underline and link extensions as they were; the notes sanitizer is unchanged
- (-) The notes sanitizer strips code-block language labels, so a code block does not round-trip its language
- (-) Table borders, widths and cell vertical alignment still do not reach sent email (the template "Use template" note says so)
