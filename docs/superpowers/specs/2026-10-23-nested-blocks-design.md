# Nested blocks — design

**Status:** approved in chat 2026-10-23. Tier: Full (schema change; a
loop can be created by two saves racing).

## Goal

Build documents from small reusable pieces nested inside bigger ones:
a block may insert other blocks, a template inserts blocks, and editing
a block updates everywhere it is used. The block editor gains what it
lacks against the template editor: a scope ("Applies to"), scoped
fields, fit warnings, real-record preview and Insert block.

Templates and blocks stay two libraries (Settings → Templates, tabs
Templates and Blocks). Rejected: merging them into one "piece" model
(big migration, nothing gained over this design); copying a block's
content in on insert (loses edit-once-updates-everywhere).

## What exists today

- `block` nodes are allowed only in templates (`createTemplateExtensions`
  drops the node when `isBlock`; `validateTemplateContent(..., { isBlock })`
  rejects it). The renderer prints `[Missing block]` for a block inside a
  block (`render.ts` `blockRef`, `s.inBlock`).
- `loadBlockMap` (`template-source.ts`) loads only the blocks a template
  references directly (plus letterhead/continuation ids).
- `checkTemplateFit` skips block contents ("blocks are shared across
  scopes"); template save refuses a misfit field in its own content.
- `usesPrefix` (signer/recipient detection) looks one level into blocks.
- Block usage (`listBlockUsage`, delete refusal) counts templates and
  court formats only.
- Court formats swap a default block for a replacement in the block map
  (`applyCourtBlocks`), so every reference renders the replacement.
- The block editor (same `TemplateEditorPage`, `isBlock`) offers every
  field, skips fit checks, previews with sample data only, as a filing.

## Data

- `TemplateBlock.appliesTo` — same values and column type as
  `DocumentTemplate.appliesTo` (matter, lead, both), NOT NULL, default
  `both`. Expand-only migration; existing rows become `both`.
- Nesting lives in block content (`block` nodes inside a block's JSON),
  as it does in templates. No join table.

## Scope rules

"Fits" means the same thing as for templates: a `both` piece may use
only fields valid for both matters and leads.

1. A block's own fields must fit its `appliesTo` (as templates today).
2. A piece (template or block) may insert a block only if the block's
   scope covers the piece's: `both` fits anywhere; `matter` fits in
   `matter`; `lead` fits in `lead`.
3. A block's `appliesTo` may not narrow while a direct parent (template or
   block) is broader than the new value.

Rules 1–3 are enforced on save, direct level only; by induction the
whole chain fits. Existing blocks become `both`, so rule 1 can fail for
a block that already uses matter-only fields. That block saves only
after its scope is set; until then the chain check below surfaces it.

**Chain check (warning, not refusal):** the template and block editors
run the fit check through every nested block and highlight problems
anywhere down the chain, naming the path, e.g. "Matter case number (in
Signature → Attorney contact)". A template save is not refused for a
problem inside a nested block (the block is fixed in its own editor;
refusing would lock the template). The Blocks list marks blocks whose
own content does not fit their scope.

## Loops and depth

- **Save refuses a loop.** On block save the server walks the saved
  content's block references transitively through stored blocks; if it
  reaches the block being saved, refuse: "Signature already includes
  Attorney contact, so Attorney contact can't include Signature."
  (Names come from the found path.)
- **Saves take turns.** Block saves that add block references run in a
  transaction holding one Postgres advisory transaction lock (a fixed
  key for "template block graph"), with the loop check inside it, so two
  concurrent saves cannot each pass and together form a loop.
- **Depth limit 5** (a template's own blocks are level 1; level 5 is the
  deepest). On block save: the longest chain of parents above the block
  (from any template or parentless block) plus the depth of its own
  nested blocks must stay within 5, else refuse: "This would nest blocks
  more than 5 deep." Checked under the same lock as loops.
- **Renderer backstop, never throws:** it tracks the chain of block ids
  being expanded. A block already on the chain prints `[Block includes
itself]`; past depth 5 prints `[Blocks nested too deep]`. Both are
  marked runs (same `missing` mark) and are reported in `report.invalid`
  as "<block name> (includes itself)" / "<block name> (nested too deep)".
- The `inBlock` scope flag and its `[Missing block]` for nested blocks go.

## Loading and rendering

- `loadBlockMap` loads transitively: breadth-first by level up to the
  depth limit, starting from the template's ids plus letterhead and
  continuation ids, then court replacement ids. One query per level.
- Court swaps apply at every level: the swapped map is used for every
  lookup, so a replacement's own nested blocks expand too (and can
  themselves be swapped). The loop guard covers swap-made loops.
- `usesSigner` / `usesRecipient` look through the whole chain.
- Letterhead and continuation blocks may contain nested blocks.
- Archived and deleted nested blocks print today's placeholders.
- The editor's block chip preview (`blockPreview`) shows nested content.

## Editor

- **Insert block** is available in the block editor. The menu leaves out
  the block itself, every block that (transitively) contains it, and
  blocks whose scope does not fit (rule 2). The template editor's menu
  applies rule 2 too.
- **Applies to** select in the block metadata form, as on templates.
- The block editor uses the template editor's scoped field catalog
  (`catalogFor`), fit highlight, chain warnings and real-record preview
  (matter or lead picker per scope; `both` offers both, like templates).
  Blocks still preview as a filing page.
- `validateTemplateContent(..., { isBlock: true })` accepts `block` nodes.

## Usage and delete

- `listBlockUsage` lists templates, blocks (direct parents) and court
  formats that use the block.
- Delete is refused while any template, block or court format uses it
  (message lists them, as today).
- Archiving stays allowed while in use (as today).

## Errors (copy)

- Loop: "<A> already includes <B>, so <B> can't include <A>."
- Depth: "This would nest blocks more than 5 deep."
- Scope (rule 2): "<Block> applies to <scope> only, so it can't go in a
  <scope> <template|block>."
- Narrowing (rule 3): "<Parent> applies to <scope> and uses this block —
  change it first."
- Missing reference on save: "A referenced block no longer exists." (as
  templates today).

## Testing

- Renderer: nested expansion; loop placeholder; depth placeholder;
  court swap at depth 2 and a swap-made loop; letterhead with a nested
  block; report entries.
- Loading: transitive `loadBlockMap` stops at the depth limit.
- Save (integration, Docker DB): loop refused (direct and through two
  levels); depth refused; scope rules 1–3; two concurrent saves that
  would form a loop — exactly one succeeds.
- Fit: chain warnings name the path; template save not refused for a
  nested problem.
- Editor: Insert block menu filtering (self, ancestors, scope); Applies
  to select; block preview with nested content.
- Usage/delete: a block used only by another block cannot be deleted.

## Docs

`docs/features/documents.md` (end state), ADR-063 amended (blocks nest;
the loop/depth rules and why saves take turns), `SCHEMA_NOTES.md` only
if the advisory lock key needs recording.
