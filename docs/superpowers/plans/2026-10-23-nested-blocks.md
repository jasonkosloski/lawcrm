# Nested Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blocks can insert blocks (up to 5 deep, no loops), blocks get an "Applies to" scope, and the block editor gains scoped fields, fit warnings, real-record preview and Insert block.

**Architecture:** One pure module (`src/lib/templates/block-graph.ts`) owns the graph rules (children, height, ancestors, loop path, scope cover). The renderer, loader, inspectors, save actions and editor all call it. Saves that touch block references run under one Postgres advisory transaction lock so racing saves cannot form a loop; the renderer guards loops and depth anyway.

**Tech Stack:** Next.js 16 server actions, Prisma/Postgres, TipTap, Vitest (+ Docker test DB).

**Spec:** `docs/superpowers/specs/2026-10-23-nested-blocks-design.md`

## Global Constraints

- `MAX_BLOCK_DEPTH = 5`: a template's own blocks are level 1; level 5 is the deepest.
- `TemplateBlock.appliesTo`: `String @default("both")`, values `APPLIES_TO` from `src/lib/templates/schema.ts`. Migration expand-only (ADR-058): generate with `prisma migrate diff` against a local Docker scratch DB with BOTH `DATABASE_URL` and `DIRECT_DATABASE_URL` exported to `postgresql://…@localhost:5433/…`; never run Prisma against the `.env` remote; check `printenv | grep DATABASE` first. Then `npm run check:migrations`.
- `BlockSource` gains `appliesTo?: AppliesTo` — absent means `"both"` (keeps hand-built fixtures valid).
- Copy, verbatim:
  - Loop: `` `${a} already includes ${b}, so ${b} can't include ${a}.` `` (a = the block that already contains the saved one, b = the saved block).
  - Depth: `"This would nest blocks more than 5 deep."`
  - Scope (rule 2): `` `${block} applies to ${SCOPE_WORD[child]} only, so it can't go in a ${SCOPE_WORD[host]} ${"template" | "block"}.` ``
  - Own fields (rule 1, block save): `` `These fields don't fit a ${SCOPE_WORD[scope]} block: ${names}.` `` (same shape as the template message).
  - Narrowing (rule 3): `` `${parent} applies to ${SCOPE_WORD[parentScope]} and uses this block — change it first.` ``
  - Missing ref: `"A referenced block no longer exists."`
  - Render placeholders: `[Block includes itself]`, `[Blocks nested too deep]`; report entries in `report.invalid`: `` `${name} (includes itself)` ``, `` `${name} (nested too deep)` ``.
- `SCOPE_WORD` (currently private in `src/app/actions/document-templates.ts`) moves to `src/lib/templates/block-graph.ts` and is exported; both action files import it.
- Lock: `pg_advisory_xact_lock(73010001)` (constant `BLOCK_GRAPH_LOCK` in `src/app/actions/template-blocks.ts`), taken inside `prisma.$transaction` by block saves and by template saves whose content references blocks.
- Commits: straight to main, explicit pathspec (`git add -N` new files first), never leave files staged. Push only after the full `npm test` passes. Tasks 1–2 may push alone (no behaviour change); push Tasks 3–5 together (nesting becomes possible only once saves enforce the rules).

## Review Focus

1. A court replacement that contains the block it replaces (swap-made loop) must print `[Block includes itself]`, never hang → test in Task 2.
2. Archived templates and archived blocks still count as parents for rule 3 and for delete refusal → test in Task 4.
3. A brand-new block (no id yet) inserting children: loop check is skipped (nothing can contain it) but depth and scope still apply → test in Task 4.
4. A legacy `both` block with matter-only fields shows in the Blocks list and in a template's chain warnings, and its template still saves → tests in Tasks 3 and 5.
5. Changing a block's content to drop a child, while another save adds the reverse edge, must not deadlock or false-refuse → covered by the concurrency test in Task 4 (one of two reverse-edge saves succeeds; a later save that removes the edge succeeds).

---

### Task 1: `appliesTo` on blocks

**Files:**

- Modify: `prisma/schema.prisma` (`model TemplateBlock`), add `prisma/migrations/20261023160000_template_block_applies_to/migration.sql`
- Modify: `src/lib/templates/render.ts` (`BlockSource`), `src/lib/templates/editor-data.ts` (`loadBlockSources`, `loadEditorBlock` select `appliesTo`), `src/lib/templates/template-source.ts` (`loadBlockMap` select), `src/app/actions/template-blocks.ts` (`saveTemplateBlock` input + rule 1), `src/components/templates/editor/editor-model.ts` (`blockMeta`), `src/components/templates/editor/metadata-form.tsx` (`BlockMeta`, `BlockMetaFields`)
- Test: `src/app/actions/template-blocks.test.ts`, `src/components/templates/editor/editor-model.test.ts`

**Interfaces:**

- Produces: `BlockSource = { id; name; isActive; content; appliesTo?: AppliesTo }`; `BlockMeta = { name; key; description; appliesTo: AppliesTo }`; `saveTemplateBlock(input: { …existing; appliesTo?: AppliesTo })` (absent on update = unchanged; absent on create = `"both"`).

- [ ] **Step 1: Failing tests** in `template-blocks.test.ts`:
  - `"creates a block with appliesTo both by default and saves matter"` — create without `appliesTo` → row `appliesTo === "both"`; update with `"matter"` → row `"matter"`.
  - `"refuses a block whose own fields don't fit its scope"` — content with a `field` `matter.caseNumber`, `appliesTo: "both"` → `{ ok: false, error: "These fields don't fit a matter-and-lead block: <label>." }` (`<label>` = the catalog label of `matter.caseNumber`; the message mirrors the template one, `SCOPE_WORD` + "block").
  - `"refuses an invalid appliesTo"` — `appliesTo: "client"` → `ok: false`.
- [ ] **Step 2:** Run `npx vitest run src/app/actions/template-blocks.test.ts` → FAIL.
- [ ] **Step 3:** Schema column, migration (`ALTER TABLE "template_blocks" ADD COLUMN "appliesTo" TEXT NOT NULL DEFAULT 'both';`), zod `appliesTo: z.enum(APPLIES_TO).optional()`, rule 1 via `checkTemplateFit(v.doc, appliesTo)` (own content only). Selects and `BlockSource` gain `appliesTo`. `BlockMetaFields` gets an "Applies to" select identical to the template one (`APPLIES_TO`, `APPLIES_TO_LABEL`); `blockMeta` reads it (default `"both"`).
- [ ] **Step 4:** Tests pass; `npm run check:migrations` passes.
- [ ] **Step 5:** Commit `feat(templates): blocks have an Applies to scope`.

### Task 2: Block graph, nested rendering and loading

**Files:**

- Create: `src/lib/templates/block-graph.ts`, `src/lib/templates/block-graph.test.ts`
- Modify: `src/lib/templates/render.ts` (`Scope.inBlock` → `chain: string[]`; `blockRef`), `src/lib/templates/inspect.ts` (`usesPrefix` transitive; comment), `src/lib/templates/template-source.ts` (`loadBlockMap` transitive), `src/app/actions/document-templates.ts` (import `SCOPE_WORD`)
- Test: `src/lib/templates/render.test.ts`, `src/lib/templates/inspect.test.ts`, `src/lib/templates/page-render.test.ts`, `src/lib/templates/template-source.test.ts` (create if absent; integration)

**Interfaces:**

- Produces (all in `block-graph.ts`, pure):
  - `MAX_BLOCK_DEPTH = 5`
  - `SCOPE_WORD: Record<AppliesTo, string>` (moved verbatim)
  - `childIds(doc: TemplateDoc): string[]` (= `collectBlockIds`, re-exported for one name)
  - `height(id: string, blocks: ReadonlyMap<string, BlockSource>): number` — 1 for a block with no children; children missing from the map count as 1; loop-safe (a block already on the walk counts 0 beyond itself).
  - `ancestors(id: string, blocks: ReadonlyMap<string, BlockSource>): Set<string>` — every block that transitively contains `id`.
  - `depthAbove(id: string, blocks): number` — longest chain of block ancestors above `id` (0 when only templates or nothing use it).
  - `loopPath(selfId: string, doc: TemplateDoc, blocks): string[] | null` — the ids from a child of `doc` down to a block that contains `selfId` (path ends at the block whose children include `selfId`), or null.
  - `scopeCovers(child: AppliesTo, host: AppliesTo): boolean` — `child === "both" || child === host`.
- Renderer: `blockRef` pushes the id onto `chain`; an id already on `chain` → placeholder `[Block includes itself]` + `report.invalid` `"<name> (includes itself)"`; `chain.length === MAX_BLOCK_DEPTH` when entering another → `[Blocks nested too deep]` + `"<name> (nested too deep)"`.
- `loadBlockMap(doc, extraIds, replacementIds?: string[])` loads level by level (one `findMany` per level, at most `MAX_BLOCK_DEPTH` levels), seeding from `childIds(doc)`, `extraIds` and `replacementIds`.

- [ ] **Step 1: Failing tests:**
  - `block-graph.test.ts`: `height` of A→B→C is 3; `ancestors("C")` = {A, B}; `depthAbove("C")` = 2; `loopPath`: map has B containing A; saving A with child B → `["B"]`; map has C containing B and B containing A; saving A with child C → `["C", "B"]`; no loop → `null`; `scopeCovers("both","lead") === true`, `scopeCovers("matter","both") === false`; `height` terminates on A→B→A.
  - `render.test.ts`: `"expands blocks nested in blocks"` (template → A → B text "deep" renders "deep"); `"a block loop prints [Block includes itself] once and reports it"` (A→B→A); `"a sixth level prints [Blocks nested too deep]"` (chain of 6); remove/replace the old "nested block prints [Missing block]" test.
  - `page-render.test.ts`: `"a court swap applies inside a nested block"` (template → A → S, court replaces S with R → R's text renders); `"a swap that includes the swapped block loops safely"` (replace S with R where R contains S → `[Block includes itself]`); `"letterhead may contain a nested block"`.
  - `inspect.test.ts`: `usesSigner` true when `signer.name` is two levels down.
  - `template-source.test.ts`: `loadBlockMap` returns A, B, C for template → A → B → C, and stops after 5 levels.
- [ ] **Step 2:** Run those files → FAIL.
- [ ] **Step 3:** Implement as above. Callers of `loadBlockMap` that have a court (`previewDocumentFromTemplate`, `generateDocumentFromTemplate`, `previewTemplateDraft` real-record branch) pass the court's replacement ids, so replacements' children are loaded. `blockPreview` in `block-node.tsx` needs no change (it passes the whole map).
- [ ] **Step 4:** Tests pass; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5:** Commit `feat(templates): render and load blocks nested in blocks`.

### Task 3: Chain fit check

**Files:**

- Modify: `src/lib/templates/inspect.ts`
- Test: `src/lib/templates/inspect.test.ts`

**Interfaces:**

- Produces: `checkNestedFit(doc: TemplateDoc, appliesTo: AppliesTo, blocks: ReadonlyMap<string, BlockSource>): NestedMisfit[]` with `NestedMisfit = { path: string; label: string | null; via: string[] /* block names, outermost first */ }` and `nestedMisfitText(m: NestedMisfit): string` → `"Case number (in Signature → Attorney contact)"`. Checks each nested block's content against the _host's_ `appliesTo` (fields, lists, repeats — reuse `check`), plus a scope entry when a nested block's `appliesTo` doesn't cover its parent (path = `block:<id>`, label = `` `${name} applies to ${SCOPE_WORD[x]} only` ``). Each block visited once per path; loop-safe; depth-capped.
- `checkTemplateFit` unchanged (own content; save still refuses on it).

- [ ] **Step 1: Failing tests:** `"reports a misfit two blocks down with its path"` (lead template → A → B using `matter.caseNumber` → one entry, `via: ["A", "B"]`, text `"Case number (in A → B)"`); `"reports a nested block whose scope doesn't cover its parent"`; `"is loop-safe"`; `"an empty list when everything fits"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(templates): fit check through nested blocks`.

### Task 4: Save rules, lock, usage and delete

**Files:**

- Modify: `src/lib/templates/schema.ts` (drop the `isBlock` refusal of `block` nodes at line ~417; keep `isBlock` for the SMS ctx), `src/app/actions/template-blocks.ts`, `src/app/actions/document-templates.ts`
- Test: `src/lib/templates/schema.test.ts`, `src/app/actions/template-blocks.test.ts`, `src/app/actions/document-templates.test.ts`

**Interfaces:**

- Consumes: Task 2 `block-graph.ts`; Task 1 `appliesTo`.
- Produces: `BlockUsage.kind: "template" | "block" | "court_format"`; `listBlockUsage` returns templates, then blocks (direct parents, active and archived), then court formats.
- `saveTemplateBlock` order inside `prisma.$transaction(async (tx) => …)`: take the lock → load all blocks (`id, name, appliesTo, isActive, content`) into a map with the saved block's _new_ content and scope substituted → missing child → rule 2 for each direct child (host = the block's scope, noun "block") → loop (`loopPath`; skipped when creating) → depth (`depthAbove(self) + height(self) > MAX_BLOCK_DEPTH`) → rule 3 (each direct parent block or template whose scope is not covered by the new scope; templates: all rows with content, active and archived) → write. Key clash and stale-version checks stay as they are.
- `saveDocumentTemplate`: when content references blocks, the existing missing-block check plus rule 2 (host = template scope, noun "template") and depth (`max height(child) > MAX_BLOCK_DEPTH`) run under the same lock in a transaction with the write.
- `deleteTemplateBlock`: also refused while a block references it: `` `This block is used by: ${names}. Archive it instead, or remove it from those templates and blocks first.` `` (one message listing templates and blocks).

- [ ] **Step 1: Failing tests** (`template-blocks.test.ts`, Docker DB):
  - `"a block can contain a block"`; `"refuses a direct loop"` (A contains B; save B with A → loop message `"A already includes B, so B can't include A."`); `"refuses a loop through two levels"`; `"refuses nesting more than 5 deep"` (chain of 5, add a 6th under the 5th and also add a parent above the top); `"a new block skips the loop check but not depth or scope"`; rule 2 (`"refuses a matter block inside a both block"`); rule 3 (`"refuses narrowing a block used by a both template"`, including an archived template, and `"…used by a both block"`); `"listBlockUsage lists parent blocks"`; `"delete is refused while another block uses it"` (archived parent too).
  - Concurrency: `"two saves that would form a loop: exactly one succeeds"` — seed A and B empty; `Promise.all([save A with child B, save B with child A])` → one `ok: true`, one loop error; then saving A without B succeeds.
  - `document-templates.test.ts`: `"refuses a lead-only block in a matter template"`; `"refuses a template whose block chain is deeper than 5"`; `"saves a template whose nested block has a misfit field"` (chain problems don't block).
  - `schema.test.ts`: `validateTemplateContent("letter", docWithBlock, { isBlock: true }).ok === true`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, then full `npm test`.
- [ ] **Step 5:** Commit `feat(templates): save rules for nested blocks (loops, depth, scope)`.

### Task 5: Block editor parity and Insert block

**Files:**

- Modify: `src/components/templates/editor/extensions.ts` (`hasBlockRef` always true), `src/components/templates/editor/toolbar.tsx` (Insert block for blocks too, using `insertableBlocks`), `src/components/templates/editor/editor-model.ts` (`catalogFor(appliesTo)` — drop the `isBlock` parameter; `insertableBlocks`), `src/components/templates/editor/template-editor-page.tsx` (block scope from `bMeta.appliesTo`; fit check and chain warnings for blocks; `preview(canSave)` for both; save sends `appliesTo`), `src/components/templates/editor/preview-pane.tsx` (chain warnings row "Inside blocks"), `src/app/(dashboard)/settings/templates/blocks/[id]/page.tsx` (+ `new`) pass `blocks={await loadBlockSources()}`, `src/components/templates/template-library.tsx` + its query (`BlockListItem.misfit: boolean`, shown as a warn tag "Fields don't fit its scope")
- Test: `src/components/templates/editor/editor-model.test.ts`, `src/components/templates/editor/template-editor-page.test.tsx`, `src/components/templates/editor/editor-extensions.test.ts`, the blocks list test beside `template-library.tsx`

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces: `insertableBlocks(all: BlockSource[], host: { id: string | null; appliesTo: AppliesTo; isBlock: boolean }): BlockSource[]` — active blocks only, excluding `host.id`, `ancestors(host.id)`, blocks whose scope doesn't cover `host.appliesTo`, and blocks with `(host.isBlock ? depthAbove(host.id) + 1 : 0) + height(b) > MAX_BLOCK_DEPTH`. The preview pane gets `nested: NestedMisfit[]` and renders one row `"Inside blocks: " + texts.join(", ")`.
- `previewTemplateDraft` is called for blocks with `kind: "filing"` and the block's `appliesTo` (record picker follows scope; `both` offers both).

- [ ] **Step 1: Failing tests:**
  - `editor-model.test.ts`: `insertableBlocks` excludes self, an ancestor, a scope misfit, an archived block, and a block too tall for the host.
  - `editor-extensions.test.ts`: a block editor (`isBlock: true`) loads and round-trips a `block` node.
  - `template-editor-page.test.tsx`: block editor shows "Applies to", the Insert block menu (filtered), a "Preview with a real record" control, highlights a misfit field and shows `FIT_BLOCKED` on save; a template whose nested block misfits shows "Inside blocks: …" but saves.
  - Blocks list: a `both` block with a matter-only field shows "Fields don't fit its scope".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; full `npm test`; typecheck; lint.
- [ ] **Step 5:** Commit `feat(templates): block editor gets scope, preview and Insert block`.

### Task 6: Docs and cleanup

**Files:**

- Modify: `docs/features/documents.md` (Templates foundation line: blocks nest up to 5 deep, have Applies to, rules; end state), `docs/decisions/063-templates-are-structured-documents.md` (amend: blocks nest; loop and depth refused on save under one advisory lock, renderer guards anyway; direct-level scope rules, chain check warns), `docs/decisions/README.md` row note, `docs/ROADMAP.md` line if the feature has one.
- Delete: this plan and the spec.

- [ ] **Step 1:** Edit docs; `npx prettier --check` them.
- [ ] **Step 2:** Commit `docs: nested blocks` (with the spec and plan deletions); push after full `npm test`.
