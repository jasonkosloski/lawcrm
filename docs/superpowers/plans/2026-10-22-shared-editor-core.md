# Shared Editor Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every editor in the app is built from one shell, one set of toolbar controls and three named extension presets (Notes, Email, Document), each pinned to its sanitizer.

**Architecture:** A new `src/components/editor/` module holds the shell (lazy load, shared content CSS), the controls and `presets.ts`. `RichTextEditor` and the template editor become compositions of it. Email gets a superset preset and a new outgoing sanitizer profile applied server-side at every sent-body and signature write.

**Tech Stack:** TipTap 3 (`@tiptap/react`, `@tiptap/starter-kit`, extension-table, extension-text-align; Link and Underline already installed via StarterKit 3.32 — no new dependency), sanitize-html, Vitest + Testing Library + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-22-shared-editor-core-design.md`

## Global Constraints

- Every test run needs the Docker test DB: `docker compose -f docker-compose.test.yml up -d`.
- Commit with an explicit pathspec (`git add` new files, then `git commit -m … -- <paths>`); never leave files staged; straight to main; pushes happen at phase ends.
- Every commit must be deploy-safe (other sessions push main): no surface may lose a feature between commits.
- `sanitizeUserHtml` (notes) and `sanitizeEmailHtml` (synced inbound mail) must not change behaviour.
- Outgoing styles allowlist = the document profile's: `margin-*` non-negative lengths, `text-indent` signed length, `line-height` length or bounded unitless, `font-size` pt, `font-weight`, `font-style`, `text-transform`, `font-variant`, `text-align`; `style` only on `p`, `span`, `td`, `th`; links http/https/mailto only, `rel="noopener noreferrer"` and `target="_blank"` forced; no `class` anywhere.
- No new dependencies (Link and Underline ship with StarterKit 3.32).
- Docs updated in the same commit as the change that makes them stale.

## Review Focus

1. **Pasting rich HTML into compose** (from Word, a web page, or a quoted inbound email): disallowed styles and tags are dropped by the editor's passthrough filter and again by the server — nothing outside the allowlist reaches a recipient. Test in Task 5 and Task 6.
2. **Existing drafts and signatures** written under the old profile open and save unchanged under the Email preset. Test in Task 6.
3. **`javascript:` / `data:` links** are refused by the editor's Link config and by the server profile. Tests in Task 4 and Task 5.
4. **Notes stay exactly as they were**: the notes editor can't emit an Email-only tag (underline, link, table), so nothing reaching `sanitizeUserHtml` changes. Test in Task 3.
5. **Signature appended to a composed body**: the combined HTML passes the outgoing profile once and keeps both parts' allowed formatting. Test in Task 6.

---

## Phase 1 — Shell and controls (no behaviour change except notes list markers)

### Task 1: Editor shell and shared content CSS

**Files:**

- Create: `src/components/editor/editor-shell.tsx`, `src/components/editor/editor-shell.test.tsx`
- Modify: `src/components/shared/rich-text-editor.tsx`, `src/components/templates/editor/use-body-editor.ts` (`BODY_CLASS` keeps only document-specific rules)

**Interfaces:**

- Produces: `EDITOR_CONTENT_CLASS: string` (lists disc/decimal 2em with no vertical margin, blockquote, code, table borders and cell padding, `p:empty` min height); `EditorShell({ editor, className, label, placeholder, readOnly }): JSX` rendering `EditorContent` with aria-label, placeholder overlay and read-only handling.

- [ ] Step 1: Failing tests — `EDITOR_CONTENT_CLASS` contains `[&_ul]:list-disc`, `[&_ol]:list-decimal`; `RichTextEditor` renders its content element with those classes (notes now show markers); `BODY_CLASS` includes `EDITOR_CONTENT_CLASS`; read-only shell renders no toolbar slot.
- [ ] Step 2: Run `npx vitest run src/components/editor src/components/shared src/components/templates/editor` — FAIL.
- [ ] Step 3: Implement; move the placeholder overlay from `rich-text-editor.tsx` into the shell.
- [ ] Step 4: Run the same command plus `npx vitest run src/components/matters src/components/communication src/components/settings` — PASS (regression gate).
- [ ] Step 5: Commit.

### Task 2: Shared toolbar controls

**Files:**

- Create: `src/components/editor/controls/` — `tool-button.tsx` (moved `ToolButton`, `Divider`), `mark-buttons.tsx`, `list-buttons.tsx`, `align-buttons.tsx`, `font-size-field.tsx` (moved), `table-menu.tsx` (moved), `index.ts`; tests beside each.
- Modify: `src/components/templates/editor/toolbar.tsx`, `src/components/templates/editor/toolbar-button.tsx` (delete after moving), `font-size-field.tsx`, `table-menu.tsx` (delete originals, update imports and tests), `src/components/shared/rich-text-editor.tsx` (its `EditorToolbar`/`ToolbarButton`/`Divider` use the shared controls)

**Interfaces:**

- Produces: `ToolButton`, `Divider`; `MarkButtons({ editor, marks: MarkKind[] })` with `MarkKind = "bold" | "italic" | "underline" | "strike" | "code" | "smallCaps" | "allCaps"`; `ListButtons({ editor })`; `AlignButtons({ editor, values?: TextAlign[] })`; `FontSizeField`; `TableMenu({ editor, features?: { merge?: boolean; borders?: boolean; width?: boolean; valign?: boolean } })` (template editor passes all; email later passes none).

- [ ] Step 1: Failing tests — each control toggles its mark/node in a happy-dom editor and reflects `aria-pressed`; `MarkButtons` renders only the requested marks; `TableMenu` with no features shows insert/delete row/column/table only.
- [ ] Step 2–4: Run (FAIL), implement by moving code, run the Task 1 regression command (PASS).
- [ ] Step 5: Commit; at phase end run `npm test` and push.

## Phase 2 — Presets

### Task 3: Notes and Document presets with parity tests

**Files:**

- Create: `src/components/editor/presets.ts`, `src/components/editor/presets.test.ts`
- Modify: `src/components/shared/rich-text-editor.tsx` (uses `notesExtensions()`; `createEditorExtensions` re-exported from presets for existing imports, or callers updated), existing sanitizer-parity test for notes moved into `presets.test.ts`

**Interfaces:**

- Produces: `notesExtensions(): Extensions` (today's `createEditorExtensions` exactly), `documentExtensions(opts: TemplateExtensionOptions): Extensions` (re-export of `createTemplateExtensions`), `type EditorPreset = "notes" | "email" | "document"`.

- [ ] Step 1: Failing tests — notes parity: HTML for every node/mark the Notes preset can produce is unchanged by `sanitizeUserHtml`; notes preset has no underline/link/table/textAlign extension (Review Focus 4); document parity: `templateJSON` of a doc using every document node passes `validateTemplateContent`.
- [ ] Step 2–4: Run `npx vitest run src/components/editor` (FAIL), implement, run Task 1's regression command (PASS).
- [ ] Step 5: Commit; `npm test`; push.

## Phase 3 — Email preset and outgoing sanitizer

### Task 4: `sanitizeOutgoingEmailHtml`

**Files:**

- Modify: `src/lib/sanitize-html.ts`, `src/lib/sanitize-html.test.ts`

**Interfaces:**

- Produces: `sanitizeOutgoingEmailHtml(html: string): string` — the `sanitizeUserHtml` options plus the tags/attributes/styles in Global Constraints; reuses the document profile's style regex constants (one definition).

- [ ] Step 1: Failing tests — keeps `<u>`, `<a href="https://…">` (gets `rel="noopener noreferrer" target="_blank"`), `mailto:`, `<table><tr><td colspan="2">`, `<p style="margin-bottom:12pt;text-align:center;line-height:1.15">`, `<span style="font-size:9pt;text-transform:uppercase">`; strips `javascript:` and `data:` hrefs, `//evil.example` hrefs, `class`, `style` on `div`/`a`, `position:absolute`, `margin-left:-10pt`, `color:red`, `background:url(x)`, `<img>`, event handlers; `sanitizeUserHtml` and `sanitizeEmailHtml` outputs for the same inputs are unchanged (snapshot of current behaviour).
- [ ] Step 2–4: Run `npx vitest run src/lib/sanitize-html.test.ts` (FAIL), implement, run (PASS).
- [ ] Step 5: Commit.

### Task 5: Email preset

**Files:**

- Modify: `src/components/editor/presets.ts`, `presets.test.ts`
- Create: `src/components/editor/style-passthrough.ts` (+ test)

**Interfaces:**

- Consumes: Task 4's `sanitizeOutgoingEmailHtml` and its style allowlist.
- Produces: `emailExtensions(): Extensions` = Notes + Underline + TextAlign(paragraph, heading) + Link(protocols http/https/mailto, `autolink`, `openOnClick: false`) + Table/Row/Cell/Header (no resize) + `StylePassthrough` (a global attribute `style` on paragraph, span and table cells, filtered on parse and render through the outgoing allowlist).

- [ ] Step 1: Failing tests — email parity: HTML for every node/mark the Email preset can produce is unchanged by `sanitizeOutgoingEmailHtml`; pasting `<p style="margin-bottom:12pt;color:red;position:absolute">x</p>` keeps only `margin-bottom` in the editor (Review Focus 1); setting a `javascript:` link is refused by the editor (Review Focus 3); resolved template HTML (from `resolvedToHtml` of a styled doc) loads and re-serialises with its allowed styles intact.
- [ ] Step 2–4: Run `npx vitest run src/components/editor` (FAIL), implement, run (PASS).
- [ ] Step 5: Commit.

### Task 6: Email surfaces use the Email preset and the outgoing profile

**Files:**

- Modify: `src/components/shared/rich-text-editor.tsx` (`preset?: "notes" | "email"`, default notes; email adds Underline, Align, Link and basic Table controls to the toolbar), `src/components/communication/compose-email.tsx`, `src/components/communication/reply-composer.tsx`, `src/components/settings/email-signature-form.tsx` (pass `preset="email"`), `src/app/actions/email-send.ts` (lines ~239 and ~459: `sanitizeOutgoingEmailHtml`), `src/lib/email-signature.ts` (~31: `sanitizeOutgoingEmailHtml`), header comments in those files
- Test: their existing test files plus `src/app/actions/email-send.test.ts`, `src/lib/email-signature.test.ts`, `src/components/communication/compose-email.test.tsx`

- [ ] Step 1: Failing tests — compose and reply send a body with a link, a table and a styled paragraph and the stored/sent HTML keeps them; a pre-existing signature/draft HTML (current-profile output) round-trips unchanged (Review Focus 2); body + appended signature keeps both parts' allowed formatting after one outgoing sanitize (Review Focus 5); "Use template" into compose keeps the template's paragraph spacing in the editor and in the sent HTML; notes surfaces still pass `sanitizeUserHtml` (unchanged tests).
- [ ] Step 2–4: Run the listed tests (FAIL), implement, run them plus `npx vitest run src/components/matters src/components/communication src/components/settings src/app/actions` (PASS).
- [ ] Step 5: Update `docs/features/communication-email.md` (compose/reply/signature: underline, alignment, links, tables; template styles reach recipients) and `docs/features/documents.md` (remove the "sent emails carry no template styles" follow-up; ADR-067 pointer). Commit; `npm test`; push.

## Phase 4 — Cleanup and docs

### Task 7: Remove duplicates; ADR

**Files:**

- Delete: `src/components/shared/rich-text-editor-lazy.tsx` (callers use the shell's lazy export) and any toolbar code left duplicated after Tasks 1–2
- Create: `docs/decisions/068-one-editor-core-presets-paired-with-sanitizers.md` (+ README row)
- Modify: `docs/UI_PATTERNS.md` (editor section: use `src/components/editor/`; pick a preset; never a new StarterKit setup), `docs/decisions/067-*.md` (trade-off about sent email updated), lazy-wrapper callers (`note-editor.tsx`, `compose-email.tsx`, `reply-composer.tsx`, `email-signature-form.tsx`)
- Delete at the end (after the final review): this plan and the spec

- [ ] Step 1: Grep for remaining `useEditor(`/`StarterKit` outside `src/components/editor/` and the template extension module; each remaining one must be a preset consumer — fix any that isn't. Test: a guard test that fails if `StarterKit` is imported outside `src/components/editor/presets.ts` and `src/components/templates/editor/extensions.ts`.
- [ ] Step 2: Remove the lazy wrapper; run the regression command (Task 1) — PASS.
- [ ] Step 3: Write the ADR and doc updates.
- [ ] Step 4: Commit; `npm test`; push.
