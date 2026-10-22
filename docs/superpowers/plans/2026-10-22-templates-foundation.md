# Templates Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain-text `{{token}}` templates with structured TipTap documents (fields, blocks, show-if, repeat), a firm block library, a typed field catalog, one pure render engine, a full-page editor, and .docx generation from matters and leads.

**Architecture:** Templates and blocks store ProseMirror JSON validated by one shared zod schema. A pure `renderTemplate` resolves fields/blocks/logic against a plain `TemplateData` object into a `ResolvedDoc` of prose nodes, which three converters turn into HTML, plain text and .docx. A server-only loader builds `TemplateData` behind the existing scope-access checks; server actions wrap it for preview, generation and library CRUD.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before touching routes), Prisma 7 / Postgres, TipTap 3 (`@tiptap/react`, `@tiptap/starter-kit`, new `@tiptap/extension-table`, `@tiptap/extension-text-align` at the installed TipTap minor), `docx` (new), zod, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-22-templates-foundation-design.md`

## Global Constraints

- Follow `AGENTS.md`: mutations are server actions in `src/app/actions/`, permission-gated, logged with `logActivity`, `revalidatePath`; reads in server components.
- Scope: every record read goes through `assertScopeAccess(scope)` (`src/lib/scope-access.ts`) before any query; never query by `matterId`/`leadId` alone.
- Permissions: templates **and** blocks use `documents.template.create` / `.edit` / `.delete`; preview and generate use `documents.upload` (plus `records.view` for preview / `records.edit` for generate with a records request), exactly as today. No new keys.
- Dates: date-only values are UTC-midnight; format with `formatDateOnly`; `today` formats in the generating user's zone (ADR-012).
- Migration is expand-only (ADR-058: prod build applies migrations). Create it with `prisma migrate diff` against the local Docker scratch DB, not `migrate dev` (`.env` points at remote dev). Run `npm run check:migrations`.
- Content size cap **256 KB** serialized; depth cap **12**; tables have no merged cells.
- Missing field text: `[<Field label> — not on file]`. Archived/deleted block text: `[<Block name> block — archived]` (deleted: `[Missing block]`).
- Stale-template refusal copy: `This template changed — review the preview again.`
- Saved file name: `<template name> — <formatDate(today, "medium", tz)>.docx`, content type `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `source: "generated"`.
- Editor pages are desktop-only; under the `useIsDesktop` breakpoint show read-only preview + "Edit on a larger screen".
- Tests need `docker compose -f docker-compose.test.yml up -d`. Run single files with `npx vitest run <path>`. Format touched files with `npm run format -- <files>`.
- Commits: `git commit -m "…" -- <paths>` with explicit pathspecs; add new files with `git add -- <paths>` first; never leave anything staged.

## Review Focus

1. **A template edited by two people / between preview and save** — save must refuse on `updatedAt` mismatch, not write a document the user never previewed. Test in Task 8.
2. **A block that a template references is archived or deleted** — generation still succeeds with a visible marker and a report entry; deletion is refused while referenced. Tests in Tasks 4 and 7.
3. **Lead-scoped generation of a template that uses matter-only fields** — the save of such a template is refused; generation from an old `both` template on a lead never throws and reports invalid fields. Tests in Tasks 5 and 8.
4. **Signer/recipient ids from another record** (tampered client) — loader refuses a signer not on the record's team and a recipient not among its contacts. Test in Task 6.
5. **Legacy plain-text templates with typos or odd braces** — convert without throwing; unknown tokens stay literal and appear in `invalid`. Test in Task 5.

---

## File Structure

| File                                                                  | Responsibility                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_template_foundation/` | `DocumentTemplate` columns, `TemplateBlock`, seeded blocks                         |
| `src/lib/templates/schema.ts`                                         | Node types, zod content schema, `validateTemplateContent`                          |
| `src/lib/templates/catalog.ts`                                        | Field + list catalog, formats, scopes, `TemplateData` type, `SAMPLE_TEMPLATE_DATA` |
| `src/lib/templates/format.ts`                                         | Value formatting (dates, names, text, addresses, list joins)                       |
| `src/lib/templates/inspect.ts`                                        | `collectFieldPaths`, `collectBlockIds`, `checkTemplateFit`                         |
| `src/lib/templates/legacy.ts`                                         | `convertLegacyBody`                                                                |
| `src/lib/templates/render.ts`                                         | `renderTemplate` → `ResolvedDoc` + `RenderReport`                                  |
| `src/lib/templates/to-html.ts`, `to-text.ts`, `to-docx.ts`            | Converters                                                                         |
| `src/lib/templates/load-data.ts`                                      | Server-only `loadTemplateData`                                                     |
| `src/app/actions/document-templates.ts`                               | Template CRUD + preview + generate (rewritten)                                     |
| `src/app/actions/template-blocks.ts`                                  | Block CRUD                                                                         |
| `src/components/templates/editor/*`                                   | TipTap extensions, node views, toolbar, field picker, rule popovers, preview pane  |
| `src/app/(dashboard)/settings/templates/**`                           | List with tabs, `[id]` and `blocks/[id]` editor pages                              |
| `src/components/templates/generate-from-template-dialog.tsx`          | Signer/recipient pickers, folder, .docx                                            |
| `src/lib/template-merge.ts`                                           | Deleted in Task 12 (its keys move to the catalog)                                  |

---

### Task 1: Schema, migration and seeded blocks

**Files:**

- Modify: `prisma/schema.prisma` (`DocumentTemplate` at ~2345, `User` relations)
- Create: `prisma/migrations/<timestamp>_template_foundation/migration.sql`
- Test: `src/lib/templates/schema-migration.test.ts`

**Interfaces:**

- Produces: `DocumentTemplate.kind String @default("letter")`, `content Json?`, `subject Json?`, `appliesTo String @default("matter")`, `body String?`; model `TemplateBlock { id, key @unique, name, description?, content Json, isActive @default(true), createdById? (User, SetNull), createdAt, updatedAt; @@map("template_blocks") }`. Seeded rows with ids `tplblock_letterhead` (key `letterhead`) and `tplblock_signature` (key `signature`).

- [ ] **Step 1: Write the failing test** — integration test (pattern: `src/app/actions/document-templates.test.ts` header) that creates a `DocumentTemplate` with only `name` + `content` and asserts `kind === "letter"`, `appliesTo === "matter"`, `body === null`; and creates a `TemplateBlock` then asserts a second with the same `key` throws `P2002`.
- [ ] **Step 2: Run** `npx vitest run src/lib/templates/schema-migration.test.ts` — FAIL (unknown fields).
- [ ] **Step 3: Edit the schema; generate SQL** with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url <local scratch> --script`. Append idempotent inserts (`INSERT … ON CONFLICT (id) DO NOTHING`) for the two blocks. Letterhead content: centered paragraph `field firm.name` (bold), then `field firm.address` format `one_line`, then `field firm.phone` · `field firm.email`. Signature content: paragraph "Sincerely,", empty paragraph, `field signer.name`, `field signer.title`, "Bar No. " + `field signer.barNumber`, `field firm.name`. Use the node shapes defined in Task 2.
- [ ] **Step 4: Apply to the test DB, run** the test and `npm run check:migrations` — PASS.
- [ ] **Step 5: Commit** `feat(templates): template kinds, structured content and block library schema`.

### Task 2: Content schema

**Files:**

- Create: `src/lib/templates/schema.ts`, `src/lib/templates/schema.test.ts`

**Interfaces:**

- Produces:
  - `type TemplateKind = "letter" | "email" | "sms" | "filing"`; `type AppliesTo = "matter" | "lead" | "both"`; `TEMPLATE_KINDS`, `APPLIES_TO` const arrays.
  - Node types (ProseMirror JSON): standard `doc`, `paragraph` (`attrs.textAlign?`), `heading` (`attrs.level 1|2|3`, `textAlign?`), `text` (marks `bold|italic|underline`), `bulletList`, `orderedList`, `listItem`, `table`/`tableRow`/`tableCell`/`tableHeader` (no `colspan`/`rowspan` > 1), `hardBreak`, plus:
    - `pageBreak` (block atom)
    - `field` (inline atom) `attrs: { path: string; format: FieldFormat | null }`
    - `listField` (inline atom) `attrs: { list: string; itemPath: string; join: "and" | "oxford_and" | "lines" }`
    - `block` (block atom) `attrs: { blockId: string }`
    - `showIf` (container, content `block+`) `attrs: { path: string; op: "present" | "empty" | "true" | "false" | "in"; values: string[] }`
    - `repeat` (container, content `block+ repeatEmpty?`) `attrs: { list: string }`; `repeatEmpty` (container, content `block*`)
  - `type TemplateDoc`, `type TemplateNode` (discriminated by `type`).
  - `validateTemplateContent(kind: TemplateKind, json: unknown, opts?: { isBlock?: boolean }): { ok: true; doc: TemplateDoc } | { ok: false; error: string }`
  - `validateSubject(json: unknown): …` — a `doc` with exactly one paragraph of `text`/`field` only.

- [ ] **Step 1: Write failing tests:** accepts a letter with every node type; rejects `block` when `opts.isBlock`; rejects anything but `paragraph`/`text`(no marks)/`hardBreak`/`field` for `sms`; rejects `pageBreak` for `email`; rejects depth 13 nesting; rejects > 256 KB with error `Template is too large.`; rejects a table cell with `colspan: 2`; rejects unknown node type with error naming it.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with a recursive zod schema plus a post-pass for kind rules, depth and size (`JSON.stringify(json).length`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): structured template content schema`.

### Task 3: Field catalog and formatting

**Files:**

- Create: `src/lib/templates/catalog.ts`, `src/lib/templates/format.ts`, tests beside each

**Interfaces:**

- Produces:
  - `type FieldType = "text" | "date" | "boolean" | "enum" | "address" | "person"`; `type FieldFormat = "long" | "short" | "iso" | "full" | "first" | "last" | "as_is" | "upper" | "block" | "one_line"`.
  - `type CatalogField = { path; label; group; type; scopes: ("matter"|"lead")[]; formats: FieldFormat[]; defaultFormat: FieldFormat | null; get(d: TemplateData): FieldValue }` where `FieldValue = string | Date | boolean | AddressValue | null`, `AddressValue = { lines: string[] }`.
  - `type CatalogList = { path; label; scopes; itemFields: CatalogField[] /* paths relative: "name", "address", "counsel.name", … */; get(d): ListItem[] }`.
  - `FIELDS: readonly CatalogField[]`, `LISTS: readonly CatalogList[]`, `fieldByPath(path)`, `listByPath(path)`, `fieldsForScope(appliesTo)`, `FIELD_GROUPS` (order: Firm, Today & user, Matter, Lead, Client, Signer, Recipient, Parties, Records request).
  - `type TemplateData` — `{ scope: "matter"|"lead"; firm; user: {name}; today: Date; timeZone: string|null; matter: {...}|null; lead: {...}|null; client: ContactData|null; signer: SignerData|null; recipient: ContactData|null; parties: Record<PartyListKey, PartyItem[]>; team: PersonItem[]; request: {...}|null; custodian: ContactData|null }` with fields exactly as the spec's catalog section lists (matter: name, caseNumber, court, venueName, venueCity, venueCounty, venueState, practiceArea, stage, incidentDate, solDate, filedDate, trialDate, opposingParty; lead: name, incidentDate, location, source, summary, stage; contact: name, organization, email, phone, address lines; signer: name, title, barNumber, email, phone).
  - Paths keep every legacy key verbatim (`matter.solDate`, `firm.addressLine1`, `firm.addressLine2`, `firm.cityStateZip`, `custodian.*`, `request.*`, `user.name`, `today`, …) so legacy conversion is identity. Add `firm.address`, `client.organization`, `signer.*`, `recipient.*`, `matter.venue*`, `matter.filedDate`, `matter.trialDate`, `lead.*`.
  - Lists: `parties.clients`, `parties.opposing`, `parties.defendants` (opposing with role `defendant`), `parties.plaintiffs` (role `plaintiff`, any category), `parties.opposingCounsel`, `parties.witnesses` (`lay_witness`), `parties.experts` (`expert_witness`) — scopes `["matter"]`; `team` — both.
  - `SAMPLE_TEMPLATE_DATA: TemplateData` (obviously fake, every field and at least two items per list; port values from `SAMPLE_MERGE_CONTEXT`).
  - `format.ts`: `formatFieldValue(field: CatalogField, value: FieldValue, format: FieldFormat | null, tz: string | null): string | null`; `splitName(name): { first: string; last: string }` (split on last space; single word → first = last = word); `joinList(items: string[], join): string` ("A and B", "A, B and C" / "A, B, and C", lines joined with `\n`).

- [ ] **Step 1: Write failing tests:** `formatFieldValue` for date long → "October 22, 2026", short → "10/22/2026", iso; name first/last including single-word and organization (person type with `organization` set → always full); upper; address block (lines with `\n`) and one_line (", "); boolean → "Yes"/"No"; `joinList` all three joins with 1, 2, 3 items; `fieldsForScope("lead")` excludes `matter.caseNumber`, `fieldsForScope("both")` excludes both `matter.*` and `lead.*`; every legacy key from `template-merge.ts` resolves via `fieldByPath`; every field resolves to non-null on `SAMPLE_TEMPLATE_DATA`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): typed field catalog and value formatting`.

### Task 4: Render engine

**Files:**

- Create: `src/lib/templates/render.ts`, `src/lib/templates/render.test.ts`

**Interfaces:**

- Consumes: Task 2 node types, Task 3 catalog/format.
- Produces:
  - `type BlockSource = { id: string; name: string; isActive: boolean; content: TemplateDoc }`
  - `type RenderReport = { missing: string[] /* labels */; invalid: string[] /* paths */; archivedBlocks: string[] /* names */ }` (each de-duplicated, first-seen order)
  - `type ResolvedDoc` — same node set minus `field`/`listField`/`block`/`showIf`/`repeat`/`repeatEmpty`; text may carry an extra mark `missing` (for placeholders).
  - `renderTemplate(doc: TemplateDoc, ctx: { data: TemplateData; blocks: Map<string, BlockSource> }): { doc: ResolvedDoc; report: RenderReport }`

- [ ] **Step 1: Write failing tests:**
  - field resolves with format; missing value → text `[Client address — not on file]` with `missing` mark, label in `report.missing`.
  - unknown path and wrong-scope path (matter field when `data.scope === "lead"`) → literal `{{path}}` text with `missing` mark, path in `report.invalid`; never throws.
  - block inlined; archived block → `[Signature block — archived]` + name in `archivedBlocks`; unknown id → `[Missing block]` + `"(deleted)"` in `archivedBlocks`.
  - showIf each op (`present`, `empty`, `true`, `false`, `in` with case-insensitive match against the field's formatted `as_is` value) keeps/drops its children (children unwrapped, not wrapped).
  - repeat over `parties.defendants` with 0 items renders `repeatEmpty` children; with 2 items renders children twice with `item.name` resolved per item; `item.*` outside repeat → invalid.
  - listField with `oxford_and` → "A, B, and C"; `lines` → hardBreaks between names.
  - nested showIf inside repeat evaluates `item.*` paths.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as a recursive tree walk carrying `{ item: ListItem | null }`; a `paragraph` whose only content was removed stays as an empty paragraph.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): render engine for fields, blocks, show-if and repeat`.

### Task 5: Inspection, fit check and legacy conversion

**Files:**

- Create: `src/lib/templates/inspect.ts`, `src/lib/templates/legacy.ts`, tests beside each

**Interfaces:**

- Produces:
  - `collectFieldPaths(doc): string[]` (field paths, showIf paths, listField/repeat list paths; `item.*` excluded)
  - `collectBlockIds(doc): string[]`
  - `checkTemplateFit(doc: TemplateDoc, appliesTo: AppliesTo, subject?: TemplateDoc | null): { ok: true } | { ok: false; invalid: { path: string; label: string | null }[] }` — paths unknown or not valid in every scope `appliesTo` implies; checks the subject too.
  - `usesSigner(doc)`, `usesRecipient(doc)` booleans (any `signer.*` / `recipient.*`, including inside referenced blocks when given `blocks`): `usesPrefix(doc, prefix: "signer." | "recipient.", blocks?: Map<string, BlockSource>): boolean`.
  - `convertLegacyBody(body: string): TemplateDoc` — split on blank lines into paragraphs, single newlines into `hardBreak`, `{{ key }}` with a catalog path → `field` (`format: null`), anything else stays literal text.

- [ ] **Step 1: Write failing tests:** fit refuses `matter.caseNumber` for `lead` and for `both`, accepts it for `matter`; reports unknown path with `label: null`; checks subject paths; `usesPrefix` sees a `signer.name` inside a referenced block; legacy conversion of `"Dear {{client.name}},\n\nRe: {{ matter.name }}\n{{typo}} {{a{{b}}"` gives two paragraphs, two field nodes, a hardBreak, and literal `{{typo}}` and `{{a{{b}}`; empty string → doc with one empty paragraph.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): template fit checks and legacy body conversion`.

### Task 6: Converters and data loader

**Files:**

- Create: `src/lib/templates/to-html.ts`, `to-text.ts`, `to-docx.ts`, `load-data.ts`, tests beside each
- Modify: `package.json` (add `docx`)

**Interfaces:**

- Consumes: `ResolvedDoc` (Task 4), `TemplateData` (Task 3).
- Produces:
  - `resolvedToHtml(doc: ResolvedDoc): string` — passed through `sanitizeDocumentHtml`; `missing` mark → `<mark data-missing>`; pageBreak → `<hr data-page-break>`.
  - `resolvedToText(doc: ResolvedDoc): string` — paragraphs separated by blank lines, lists as `- ` / `1. `, table rows as tab-separated cells.
  - `resolvedToDocx(doc: ResolvedDoc): Promise<Buffer>` — `docx` package; Word defaults (no house style), page break → `PageBreak`, alignment, bold/italic/underline, lists, tables; `missing` text highlighted yellow.
  - `loadTemplateData(input: { scope: RecordScope; signerId?: string | null; recipientContactId?: string | null; request?: LoadedRecordsRequest | null }): Promise<{ ok: true; data: TemplateData; recordName: string } | { ok: false; error: string }>` — server-only (`import "server-only"`); calls `assertScopeAccess(scope)` first; signer defaults to the current user; a `signerId` not in the matter/lead team → `{ ok: false, error: "That signer isn't on this record's team." }`; a `recipientContactId` not linked to the record (matter: `MatterContact` or `Matter.clientId`; lead: `Lead.contactId`) → `"That recipient isn't a contact on this record."`. Moves `composeContactAddress` and the records-request select/type out of `document-templates.ts` into this file (export `loadRecordsRequest(scope, id)` and `LoadedRecordsRequest`).

- [ ] **Step 1: Write failing tests:**
  - html: missing mark rendered, sanitizer keeps tables/alignment/headings; no `<script>` survives from text content.
  - text: a two-paragraph doc with a list and a table.
  - docx: unzip the buffer with `jszip` (add it as a devDependency if it is not directly resolvable) and assert `word/document.xml` contains the paragraph text and `<w:br w:type="page"/>`.
  - loader (integration): matter with client, two opposing parties with role `defendant`, one with representation; asserts `parties.defendants` names and `counsel.name`; lead scope fills `lead.*`, `client` from the lead contact falling back to lead name/email/phone, `matter: null`; signer outside the team refused; recipient from another matter refused; user without access → the access guard's rejection propagates.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: `npm i docx@9`; implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): html, text and docx converters and scoped data loader`.

### Task 7: Template and block CRUD actions

**Files:**

- Modify: `src/app/actions/document-templates.ts` (CRUD half), `src/lib/template-constants.ts`
- Create: `src/app/actions/template-blocks.ts`, `src/app/actions/template-blocks.test.ts`
- Modify: `src/app/actions/document-templates.test.ts`

**Interfaces:**

- Consumes: Tasks 2 and 5.
- Produces (all return `{ ok: true, id } | { ok: false, error }`; inputs are plain objects, not FormData, because content is JSON):
  - `saveDocumentTemplate(input: { id?: string; name; category; description?; kind: TemplateKind; appliesTo: AppliesTo; content: unknown; subject?: unknown; expectedUpdatedAt?: string })` — create needs `documents.template.create`, update `documents.template.edit`; validates with `validateTemplateContent`, `validateSubject` (email only; other kinds force `subject: null`), `checkTemplateFit` (error: `These fields don't fit a <matter|lead|matter-and-lead> template: <labels or paths>.`), unknown block ids (`A referenced block no longer exists.`); on update with a stale `expectedUpdatedAt` → `Someone else saved this template — reload to see their changes.`; writes `content`, sets `body: null`; logs as today via `logTemplateChange`.
  - `setDocumentTemplateActive`, `deleteDocumentTemplate` unchanged in contract.
  - `saveTemplateBlock(input: { id?; key; name; description?; content: unknown; expectedUpdatedAt? })` — `key` matches `/^[a-z][a-z0-9_]{1,39}$/`, duplicate → `That key is already used by another block.`; content validated with `isBlock: true` and kind `letter`.
  - `setTemplateBlockActive(id, active)` (edit key), `deleteTemplateBlock(id)` (delete key) — refused while referenced: `This block is used by: <template names>. Archive it instead, or remove it from those templates first.`
  - `listBlockUsage(blockId): Promise<{ id: string; name: string }[]>` — scans active and archived templates' `content` with `collectBlockIds`.
  - Remove `MAX_TEMPLATE_BODY` and the FormData parser once nothing imports them.

- [ ] **Step 1: Write failing tests** (extend the existing integration file's style): each action asks for the right key; template save refuses sms with a heading, lead template with `matter.caseNumber`, unknown block id, stale `expectedUpdatedAt`; email keeps subject, letter drops it; block delete refused while a template references it and the error names the template; archive allowed; duplicate key refused; every write logs one activity row.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): structured template and block library actions`.

### Task 8: Preview and generation actions

**Files:**

- Modify: `src/app/actions/document-templates.ts` (generation half), its test file

**Interfaces:**

- Consumes: Tasks 4–6.
- Produces:
  - `previewDocumentFromTemplate(templateId: string, scope: RecordScope, opts?: { recordsRequestId?; signerId?; recipientContactId? }): Promise<{ ok: true; templateName; html; text; report: RenderReport; templateUpdatedAt: string; needsSigner: boolean; needsRecipient: boolean } | { ok: false; error }>` — same gates as today; legacy rows render via `convertLegacyBody(body)` when `content` is null; only `letter`/`filing` kinds generate (`This template can't be saved as a document.`).
  - `generateDocumentFromTemplate(templateId, scope, opts?: { recordsRequestId?; signerId?; recipientContactId?; folderId?: string | null; expectedUpdatedAt: string })` → `{ ok: true; documentId; documentName; report } | { ok: false; error }` — same gates; stale `expectedUpdatedAt` → the stale copy from Global Constraints; `folderId` checked with a scoped `documentFolder.findFirst({ where: { id, ...scopeWhere(scope) } })` (`Folder not found.`); records requests keep `resolveRecordsRoleFolder` and ignore `folderId`; stores `.docx` via `storeFile(new File([buffer], name, { type: DOCX_MIME }))`; same cleanup, logging and revalidation as today.
  - `previewTemplateDraft(input: { content: unknown; subject?: unknown; kind; appliesTo; target: { sample: true } | { scope: RecordScope } }): Promise<{ ok: true; html; text; subjectText: string | null; report } | { ok: false; error }>` — needs `documents.template.edit` or `.create`; real targets also go through `loadTemplateData` (access-checked); loads active+archived blocks referenced by the content.

- [ ] **Step 1: Write failing tests:** generation stores a `.docx` with the DOCX mime and the expected name; stale `expectedUpdatedAt` refused and nothing stored; folder from another matter refused; lead generation of a legacy `both` template with a matter-only token returns `ok: true` with the path in `report.invalid`; a referenced archived block still generates and reports it; records-request generation still lands in the request-letter folder and tags the document; preview of an `email` template refused for saving but `previewTemplateDraft` renders its `subjectText`; `previewTemplateDraft` against a matter the user can't access is rejected.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; delete `resolveMergeContext` (replaced by `loadTemplateData`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): preview and .docx generation on the new engine`.

### Task 9: Editor extensions and node views

**Files:**

- Create: `src/components/templates/editor/extensions.ts`, `field-node.tsx`, `block-node.tsx`, `section-nodes.tsx` (showIf, repeat, repeatEmpty), `list-field-node.tsx`, `page-break.ts`, `editor-extensions.test.ts`
- Modify: `package.json` (`@tiptap/extension-table`, `@tiptap/extension-text-align`, same version as `@tiptap/react`)

**Interfaces:**

- Consumes: Task 2 node attrs (must match exactly), Task 3 catalog for labels.
- Produces: `createTemplateExtensions(opts: { kind: TemplateKind; isBlock: boolean; blocks: BlockSource[]; onEditBlock?: (id) => void; onEditRule?: (pos: number) => void; onEditField?: (pos: number) => void }): Extensions`. `sms` returns only Document/Paragraph/Text/HardBreak/Field. Commands: `insertField(path, format)`, `insertListField(attrs)`, `insertBlock(blockId)`, `wrapInShowIf(attrs)`, `wrapInRepeat(list)`, `updateNodeAttrs(pos, attrs)`, `insertPageBreak()`.
  - Field chip text: `<label> · <format label>` (format label omitted when null).
  - Rule header text: `Show if: <label> is filled in | is empty | is yes | is no | is one of <values>`; `Repeat for each: <list label>`; `If none:` header on `repeatEmpty`.

- [ ] **Step 1: Write failing tests:** round-trip — load a doc containing every node type into a headless `Editor` with `createTemplateExtensions({ kind: "letter", … })`, `editor.getJSON()` passes `validateTemplateContent("letter", …)` and deep-equals the input; sms extensions drop a heading on paste/set; `insertField("client.name","full")` produces the expected node; chip and rule header text render as above (happy-dom).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Install packages; implement** node views with `ReactNodeViewRenderer`; atoms are non-editable; block node renders the block's content read-only via `resolvedToHtml(renderTemplate(block.content, { data: SAMPLE_TEMPLATE_DATA, blocks }).doc)`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): editor nodes for fields, blocks and logic sections`.

### Task 10: Editor pages and Settings list

**Files:**

- Create: `src/app/(dashboard)/settings/templates/[id]/page.tsx` (`id = "new"` creates), `src/app/(dashboard)/settings/templates/blocks/[id]/page.tsx`, `src/components/templates/editor/template-editor-page.tsx`, `toolbar.tsx`, `field-picker.tsx`, `rule-popover.tsx`, `field-format-popover.tsx`, `preview-pane.tsx`, `record-picker.tsx`, tests beside the components
- Modify: `src/app/(dashboard)/settings/templates/page.tsx`, `src/components/templates/template-library.tsx` (tabs Templates/Blocks, kind + applies-to filters, rows link to editor pages)
- Delete: `src/components/templates/template-editor-dialog.tsx` and its test

**Interfaces:**

- Consumes: Tasks 7–9 actions/extensions.
- Produces: pages authenticate with `requireUser()` and pass `canCreate/canEdit/canDelete` flags; read-only rendering when the user lacks the key.
  - Template page metadata form: name, category, description, kind, applies-to; email shows a one-line subject editor (`createTemplateExtensions({ kind: "sms", … })` reused for its inline field support); sms shows `n characters · m segments` (160 GSM / 70 when any non-GSM char).
  - Changing applies-to runs `checkTemplateFit` client-side; invalid chips get an error outline and Save is disabled with `Remove or replace the highlighted fields to save.`
  - Preview pane: sample data renders client-side with `renderTemplate` + `resolvedToHtml`; "Preview with a real matter or lead" opens `record-picker`, which calls a new action `searchTemplatePreviewRecords(query: string): Promise<{ scope: RecordScope; label: string }[]>` in `document-templates.ts` (same gate as `previewTemplateDraft`; wraps `globalSearch(query, { type })` from `src/lib/queries/search.ts` for the matter and lead hit types, 8 each, which inherits its access scoping), then calls `previewTemplateDraft`; report listed under the preview.
  - Field picker: search box, groups in `FIELD_GROUPS` order, entries labelled with the example value from the current preview data; filtered by `fieldsForScope(appliesTo)`; inside a repeat, the list's `item.*` fields appear first.
  - Block page: same component with `isBlock`; header shows `Used by N templates` linking each.
  - Legacy template opened → content from `convertLegacyBody(body)` with a notice `Converted from the old text format — review and save.`
  - Below `useIsDesktop` the pages render the sample preview only plus `Edit on a larger screen.`

- [ ] **Step 1: Write failing tests** (component, happy-dom, actions mocked): list shows both tabs and filters by kind; editor saves with `saveDocumentTemplate` payload containing editor JSON and `expectedUpdatedAt`; changing applies-to to lead with a `matter.caseNumber` chip disables Save with the copy above; sms counter shows `161 characters · 2 segments`; legacy notice appears when `content` is null; mobile shows the read-only copy; block page lists usage.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**, reusing `Button`, form-field module, `EmptyState`, and the existing settings layout.
- [ ] **Step 4: Run** — PASS, plus `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(templates): full-page template and block editors`.

### Task 11: Generate dialog and records requests

**Files:**

- Modify: `src/components/templates/generate-from-template-dialog.tsx` (+ test), `src/components/documents/documents-browser.tsx` (pass current `folderId`, team members, record contacts; filter templates to `kind in (letter, filing)` and `appliesTo` fitting the scope), `src/components/records-requests/request-detail.tsx`

**Interfaces:**

- Consumes: Task 8 actions.
- Produces: dialog props add `folderId: string | null`, `team: { id; name }[]`, `contacts: { id; name; role: string | null }[]`. Flow: pick template → (signer select defaulting to current user, recipient select) only when preview says `needsSigner`/`needsRecipient` → preview HTML with report (missing labels, invalid paths, archived blocks) → **Copy text** (`text` to clipboard) / **Save to documents** passing `expectedUpdatedAt`. Stale refusal re-runs the preview and shows the copy inline.

- [ ] **Step 1: Write failing tests:** picker hides email/sms and matter-only templates on a lead; signer/recipient selects appear only when needed; save sends `folderId` and `expectedUpdatedAt`; stale error re-fetches preview; records-request detail still generates its letter.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(templates): generate .docx from matters and leads with signer and recipient`.

### Task 12: Cleanup and docs

**Files:**

- Delete: `src/lib/template-merge.ts` and its test (verify no importers: `grep -rn "template-merge" src`)
- Create: `docs/decisions/0NN-templates-are-structured-documents.md` (next free number) + row in `docs/decisions/README.md`
- Modify: `docs/features/documents.md` (rewrite the template entry to end state; follow-ups = projects 2–4, versioning, practice-area defaults, Word upload, contact salutation/DOB/minor fields), `docs/ROADMAP.md` (replace "Template follow-ups" with four lines, project 1 `[x]`), `docs/PERMISSIONS.md` if it describes template keys' scope (blocks now covered)
- Delete: this plan and the spec (fold anything lasting into the ADR/feature file first)

- [ ] **Step 1:** Delete `template-merge.ts`; `npm run typecheck` and `npm test` — PASS.
- [ ] **Step 2:** Write the ADR: context (daily-use templates, per-firm customization), decision (ProseMirror JSON with field/block/logic nodes; formatting layers house style → court rules; templates hold no formatting), rejected (Word upload for now, text tags, Markdown, free-form logic) and why, consequences (expand-only `body` drop later).
- [ ] **Step 3:** Update docs; `npm run format -- <docs>`.
- [ ] **Step 4: Commit** `docs(templates): ADR, feature file and roadmap for the templates foundation` and push after the full `npm test` passes.
