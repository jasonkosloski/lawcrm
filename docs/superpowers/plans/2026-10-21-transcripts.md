# Transcripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On-request AssemblyAI transcripts for audio/video Documents, with a Reduct-style synced transcript pane, flag-from-selection, corrections, global search and a timecode PDF export.

**Architecture:** `Transcript` (one per Document) + `TranscriptSegment` (one row per speaker paragraph, word timings as JSON). A server action submits an async AssemblyAI job against a presigned Blob URL; a webhook (and a cron sweep fallback) fetches the result, normalizes it into segments and deletes the provider copy. The viewer's `MediaReview` grows a transcript pane; corrections re-align words to keep timings.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before route/page code), Prisma/Postgres, AssemblyAI REST v2 via `fetch` (no SDK), Vitest + happy-dom, Docker test DB on :5433.

**Spec:** `docs/superpowers/specs/2026-10-21-transcripts-design.md`

## Global Constraints

- Every test run needs `docker compose -f docker-compose.test.yml up -d`.
- Migrations: NEVER `prisma migrate dev` (it targets the remote lawcrm-dev DB). Make a scratch DB in the Docker Postgres, export BOTH `DATABASE_URL` and `DIRECT_DATABASE_URL=postgresql://lawcrm_test:lawcrm_test@localhost:5433/<scratch>`, confirm `npx prisma migrate status` names localhost, `migrate deploy`, then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<ts>_<name>/migration.sql`, `npm run check:migrations`, drop the scratch DB.
- Migrations are expand-only (they auto-apply to prod on push, ADR-058).
- Commit in one step with explicit pathspecs (`git commit -m "…" -- <paths>`; `git add -N` new files first). Never leave files staged. Other sessions share this checkout.
- Every read/write on a transcript goes through the Document's scope: `assertChildMatterAccess("document", documentId)` / `matterAccessWhere` (ADR-039). Never query transcripts by id alone without that.
- Mutations are server actions in `src/app/actions/transcripts.ts`, gated by `requirePermission`, logged with `logActivity`, `revalidatePath` of the document viewer path. The webhook and sweep are the sanctioned API-route exceptions.
- Permission keys (exact): `documents.transcribe`, `documents.transcript.edit`, `documents.transcript.delete`.
- Status values (exact): `queued | processing | completed | failed`. Provider id: `"assemblyai"`.
- Env (exact): `ASSEMBLYAI_API_KEY` (server-only), `TRANSCRIPTION_MONTHLY_HOURS` (default `50`).
- Presigned media URL lifetime is the existing `signedBlobUrl(url, { media: true })` (6 h). Job timeout: 6 h. Sweep picks up `processing` jobs older than 2 min; cron every 10 min.
- Segment split cap: ~90 s, split at a sentence end.
- Times are seconds (Float). Timecodes print as `[hh:mm:ss]`; copy-with-timecode prints `mm:ss` under an hour, `h:mm:ss` over.
- Clients never see transcripts (no portal surface).
- Export footer copy (exact): `Uncorrected machine transcript` / `Machine transcript, corrected by staff`.

## Review Focus

1. **No speech** (silent bodycam, music only): provider returns zero words → transcript `completed` with zero segments; pane says "No speech detected", never an endless spinner. Test in Task 4.
2. **Stale webhook after a re-run**: the old job's webhook arrives after the transcript was re-submitted with a new `providerJobId` → ignored (200, no writes). Test in Task 4.
3. **Paragraph edited to blank** → refused with "A paragraph can't be empty." (no silent deletion of speech). Test in Task 5.
4. **Selection spanning two paragraphs** → one flag from the first selected word's start to the last selected word's end, quote is the selected text. Test in Task 8.
5. **Three-hour recording (~25k words, ~400 segments)**: advancing playback re-renders only the segment holding the active word (segments are memoized on `activeWordIndex` within them). Test in Task 7 with a render counter.

---

### Task 1: Schema, migration, permissions, notification type

**Files:**
- Modify: `prisma/schema.prisma` (add `Transcript`, `TranscriptSegment` exactly as in the spec's Data model; back-relations on `Document` (`transcript Transcript?`) and `User` (`transcriptsRequested`, `transcriptsCorrected` with the spec's relation names))
- Create: `prisma/migrations/20261021210000_transcripts/migration.sql` (via migrate diff; then append the grant block below)
- Modify: `src/lib/permissions.ts` (three entries after `documents.organize`, same shape as `documents.edit`)
- Modify: `src/lib/notifications.ts` (add `"transcript_ready"` and `"transcript_failed"` to `NotificationType`), `src/lib/notification-type-meta.ts` (icons: `FileText`/ok tone, `CircleX`/danger tone like existing failure types)
- Modify: `docs/PERMISSIONS.md`, `docs/SCHEMA_NOTES.md`
- Test: `src/lib/permissions.test.ts` (existing; extend)

**Interfaces:**
- Produces: Prisma models `Transcript`, `TranscriptSegment`; permission keys above; notification types `transcript_ready`, `transcript_failed`.

- [ ] **Step 1: Failing test** — in `src/lib/permissions.test.ts`: `test("transcript keys are catalogued", () => { for (const k of ["documents.transcribe","documents.transcript.edit","documents.transcript.delete"]) expect(isKnownPermission(k)).toBe(true); })`.
- [ ] **Step 2: Run** `npx vitest run src/lib/permissions.test.ts` → FAIL.
- [ ] **Step 3: Add schema + permissions + notification types.** Labels: "Transcribe recordings" / "Correct transcripts" / "Delete transcripts".
- [ ] **Step 4: Generate the migration** per Global Constraints, then append (idempotent, mirrors `20261021120000_documents_edit_permission`):

```sql
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", p.key FROM "role_permissions"
CROSS JOIN (VALUES ('documents.transcribe'), ('documents.transcript.edit')) AS p(key)
WHERE "permission" = 'documents.upload'
ON CONFLICT ("roleId", "permission") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'documents.transcript.delete' FROM "role_permissions"
WHERE "permission" = 'documents.delete_any'
ON CONFLICT ("roleId", "permission") DO NOTHING;
```

- [ ] **Step 5: Run** `npm run check:migrations && npx tsc --noEmit -p . && npx vitest run src/lib/permissions.test.ts src/lib/notification-type-meta.test.ts` → PASS.
- [ ] **Step 6: Docs** — PERMISSIONS.md rows; SCHEMA_NOTES.md: one transcript per document (unique `documentId`), segment `text` always derived from `words`, scope via Document only.
- [ ] **Step 7: Commit** `feat(transcripts): schema, permissions, notification types`.

### Task 2: Pure transcript helpers

**Files:**
- Create: `src/lib/transcription/types.ts`, `src/lib/transcription/normalize.ts`, `src/lib/transcription/align.ts`, `src/lib/transcription/timecode.ts`, `src/lib/transcription/cap.ts`
- Create: `src/lib/transcription/__fixtures__/assemblyai-completed.json` (a small realistic AssemblyAI v2 completed response: 2 speakers, ~40 words, one utterance > 90 s via sparse words)
- Test: `normalize.test.ts`, `align.test.ts`, `timecode.test.ts`, `cap.test.ts` beside each

**Interfaces:**
- Produces:
  - `type Word = { w: string; s: number; e: number; c?: number }`
  - `type NormalizedSegment = { index: number; speaker: string; startSeconds: number; endSeconds: number; text: string; words: Word[] }`
  - `type NormalizedResult = { language: string | null; durationSeconds: number | null; speakers: string[]; segments: NormalizedSegment[] }`
  - `normalizeAssemblyAI(raw: AssemblyAITranscript): NormalizedResult` (`AssemblyAITranscript` typed in `types.ts`: `utterances?: { speaker: string; words: { text: string; start: number; end: number; confidence: number }[] }[] | null; words?: …; language_code?: string; audio_duration?: number`; ms → seconds)
  - `wordsToText(words: Word[]): string`
  - `alignWords(old: Word[], newText: string): Word[]`
  - `activeWordIndex(words: Word[], t: number): number` (last word with `s <= t`; `-1` before the first)
  - `formatTimecode(seconds: number): string` → `"00:04:12"`; `formatShortTimecode(seconds: number): string` → `"4:12"` / `"1:04:12"`
  - `monthStart(now: Date, tz: string): Date`; `capExceeded(usedSeconds: number, capHours: number): boolean`

- [ ] **Step 1: Failing tests** (key assertions):
  - normalize: fixture → speakers `["A","B"]`; first segment `startSeconds` = first word start/1000; segment over 90 s splits at the last word ending in `.`/`?`/`!` before 90 s; `text === wordsToText(words)`; no `utterances` (speaker labels missing) → one speaker `"A"` built from `words`; zero words → `segments: []`.
  - align: unchanged text returns identical array; replacing one word keeps neighbours' `s/e` and gives the new word the replaced word's `s/e`; inserting two words between `a(1–2)` and `b(5–6)` gives them `2–3.5` and `3.5–5`; deleting a word drops it; leading insertion before the first word takes `[old[0].s, old[0].s]` spread across 0 width (`s===e===old[0].s`); punctuation-only differences (`"hello"`→`"Hello,"`) count as matches (tokens compared lowercased with punctuation stripped) but the new spelling is kept.
  - timecode: `formatTimecode(252)` → `"00:04:12"`, `formatTimecode(3852.9)` → `"01:04:12"`; `formatShortTimecode(252)` → `"4:12"`, `(3852)` → `"1:04:12"`.
  - activeWordIndex: before first → -1; exactly at a word start → that index; between words → previous.
  - cap: `capExceeded(50*3600, 50)` true, `capExceeded(50*3600-1, 50)` false; `monthStart` in `America/Denver` for 2026-11-01T03:00Z → 2026-10-01T06:00Z.
- [ ] **Step 2: Run** `npx vitest run src/lib/transcription` → FAIL.
- [ ] **Step 3: Implement.** `alignWords`: tokenize `newText` on whitespace; LCS over normalized tokens against `old`; walk the alignment, emitting matched tokens with old timings (new spelling), and for each run of unmatched new tokens spread evenly across `[prevMatched.e, nextMatched.s]` (`old[0].s` / `old.at(-1).e` at the ends).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(transcripts): normalize, align, timecode helpers`.

### Task 3: AssemblyAI adapter

**Files:**
- Create: `src/lib/transcription/assemblyai.ts` (server-only: `import "server-only"`)
- Test: `src/lib/transcription/assemblyai.test.ts` (mock `global.fetch`)

**Interfaces:**
- Consumes: `AssemblyAITranscript` (Task 2).
- Produces:
  - `transcriptionConfigured(): boolean` (`!!process.env.ASSEMBLYAI_API_KEY`)
  - `submitJob(input: { audioUrl: string; webhookUrl: string | null; webhookSecret: string }): Promise<{ jobId: string }>` — `POST https://api.assemblyai.com/v2/transcript` with `{ audio_url, speaker_labels: true, punctuate: true, format_text: true, webhook_url?, webhook_auth_header_name: "x-transcript-secret", webhook_auth_header_value }`, header `authorization: <key>`.
  - `fetchJob(jobId: string): Promise<{ status: "queued" | "processing" | "completed" | "error"; error?: string; raw?: AssemblyAITranscript }>` — `GET /v2/transcript/{id}`.
  - `deleteJob(jobId: string): Promise<void>` — `DELETE /v2/transcript/{id}`; logs and swallows failures.
  - `uploadBytes(bytes: Uint8Array): Promise<string>` — `POST /v2/upload`, returns `upload_url` (local-driver dev only).
  - `WEBHOOK_SECRET_HEADER = "x-transcript-secret"`

- [ ] **Step 1: Failing tests**: submit sends the exact body/headers and returns `jobId` from `id`; non-2xx throws `Error` whose message includes the provider's `error` field; `fetchJob` maps `status:"error"` to `{status:"error", error}`; `deleteJob` resolves even on 500; `webhookUrl: null` omits the webhook fields.
- [ ] **Step 2: Run** `npx vitest run src/lib/transcription/assemblyai.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(transcripts): AssemblyAI adapter`.

### Task 4: Job lifecycle — request, finish, webhook, sweep, delete

**Files:**
- Create: `src/lib/transcription/jobs.ts` (server-only finisher shared by webhook + sweep)
- Create: `src/app/actions/transcripts.ts` (`requestTranscript`, `deleteTranscript`)
- Create: `src/app/api/webhooks/assemblyai/route.ts`, `src/app/api/transcription-sweep/route.ts`
- Modify: `src/proxy.ts` (`SELF_AUTHENTICATED_PATHS` += `/api/webhooks/assemblyai`, `/api/transcription-sweep`), `vercel.json` (cron `{ "path": "/api/transcription-sweep", "schedule": "*/10 * * * *" }`)
- Test: `src/app/actions/transcripts.integration.test.ts`, `src/lib/transcription/jobs.integration.test.ts`, `src/app/api/webhooks/assemblyai/route.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `requestTranscript(documentId: string, opts?: { replaceCorrections?: boolean }): Promise<{ ok: true; status: "processing" | "completed" } | { ok: false; error: string; needsConfirm?: "replace_corrections" }>`
  - `deleteTranscript(documentId: string): Promise<{ ok: boolean; error?: string }>` (`documents.transcript.delete`)
  - `finishTranscriptJob(transcriptId: string): Promise<"completed" | "failed" | "pending" | "gone">` in `jobs.ts`: `fetchJob`; on `completed` → one transaction: delete segments, insert normalized, set status/`durationSeconds`/`language`/`speakers` (each label → `"Speaker <label>"`), `completedAt`, clear `webhookSecret`, `correctedAt/By` null; then `deleteJob`; `logActivity` "Transcript ready"; `createNotification(type "transcript_ready")` to `requestedById` linking the viewer. `error` → `failed` + `error`, notify `transcript_failed`. Older than 6 h and still pending → `failed` "Timed out".
  - Webhook: `POST`; reads `transcript_id` from JSON; finds Transcript by `providerJobId` (none → 200); compares `x-transcript-secret` with `crypto.timingSafeEqual` against `webhookSecret` (mismatch → 401); calls `finishTranscriptJob`; returns 200.
  - Sweep: `GET`, `isAuthorizedCron`; up to 25 `processing` rows with `requestedAt < now-2min` oldest first → `finishTranscriptJob` each; `maxDuration = 60`.

`requestTranscript` order: permission → `assertChildMatterAccess("document", id)` → load doc; renderer (`resolveDocumentRenderer`) must be `audio`/`video` and `fileUrl` set, else "Only audio and video can be transcribed." → `transcriptionConfigured()` else "Transcription isn't set up yet." → existing transcript `queued|processing` → "Already transcribing." → existing with `correctedAt` and no `replaceCorrections` → `{ ok:false, needsConfirm:"replace_corrections", error:"This replaces the corrections made to the transcript." }` → reuse: another Document in the same scope with the same `fileUrl` whose transcript is `completed` → copy segments/speakers/language/duration, status `completed`, log "Transcript copied" → cap: sum `durationSeconds` of transcripts `completedAt >= monthStart(now, firmTz)` (exclude copies: copies set `provider = "copy"`) → over → "This month's transcription limit (<N> hours) is used up." → upsert `queued` with fresh `webhookSecret` (`crypto.randomBytes(24).toString("hex")`) → audio URL: blob driver → `signedBlobUrl(fileUrl, { media: true })`; local driver → `uploadBytes(await readStoredFile(fileUrl))` → `webhookUrl`: `${process.env.AUTH_URL}/api/webhooks/assemblyai` (the public origin the Google integration routes already use) when the storage driver isn't local and `AUTH_URL` is set, else null (the sweep finishes the job) → `submitJob` → store `providerJobId`, status `processing` → `logActivity` "Transcription requested" → `revalidatePath`. Submit failure → `failed` + message.

- [ ] **Step 1: Failing integration tests** (`transcripts.integration.test.ts`, adapter mocked via `vi.mock("@/lib/transcription/assemblyai")`): no permission → throws/redirect like other `requirePermission` tests; walled matter → refused; PDF → "Only audio and video can be transcribed."; happy path → row `processing` with `providerJobId`, `submitJob` got a presigned/`uploadBytes` URL; second request → "Already transcribing."; corrected transcript → `needsConfirm`; with `replaceCorrections` → proceeds; copy-reuse → no `submitJob`, segments copied; cap exceeded → refused, no `submitJob`.
- [ ] **Step 2: Failing tests for finisher/webhook** (`jobs.integration.test.ts`, `route.test.ts`): completed fixture → segments written, `deleteJob` called, notification created; zero-word result → `completed` with 0 segments (Review Focus 1); provider `error` → `failed` + notification; >6 h pending → `failed` "Timed out"; repeat webhook on `completed` → no writes; wrong secret → 401; unknown/stale `providerJobId` (re-run replaced it) → 200, nothing written (Review Focus 2); deleted Document → `"gone"`.
- [ ] **Step 3: Run** `npx vitest run src/app/actions/transcripts.integration.test.ts src/lib/transcription src/app/api/webhooks/assemblyai` → FAIL.
- [ ] **Step 4: Implement** the action, finisher, routes, proxy + cron entries.
- [ ] **Step 5: Run** → PASS; `npx tsc --noEmit -p .`.
- [ ] **Step 6: Commit** `feat(transcripts): request, webhook, sweep, delete`.

### Task 5: Correction actions

**Files:**
- Modify: `src/app/actions/transcripts.ts`
- Test: `src/app/actions/transcripts-edit.integration.test.ts`

**Interfaces:**
- Consumes: `alignWords`, `wordsToText` (Task 2).
- Produces (all `requirePermission("documents.transcript.edit")` + access via the segment's transcript's document; all set `correctedAt/By`, `logActivity`, `revalidatePath`):
  - `updateTranscriptSegment(segmentId: string, input: { text: string; revision: number }): Promise<{ ok: true; revision: number } | { ok: false; error: string; conflict?: true }>`
  - `revertTranscriptSegment(segmentId: string, revision: number): Promise<same>` — no-op `ok` when `originalText` is null.
  - `setSegmentSpeaker(segmentId: string, speaker: string, revision: number): Promise<same>` — `speaker` must be a key of `Transcript.speakers` or a new label `"A"…"Z"` not yet used (added as `"Speaker <label>"`).
  - `renameTranscriptSpeaker(transcriptId: string, speaker: string, name: string): Promise<{ ok: boolean; error?: string }>` — name trimmed 1–60 chars.

Concurrency: write with `updateMany({ where: { id, revision }, data: { …, revision: { increment: 1 } } })`; `count === 0` → `{ ok:false, conflict:true, error:"Someone else changed this paragraph. Reload to see their version." }`. Edits refused unless the transcript is `completed`.

- [ ] **Step 1: Failing tests**: edit keeps unchanged word timings and sets `originalText` once (second edit keeps the first original); stale revision → conflict, nothing written; blank text → "A paragraph can't be empty." (Review Focus 3); text over 5,000 chars → refused; revert restores original text; speaker reassign + rename; no permission / walled → refused; editing while `processing` → refused.
- [ ] **Step 2: Run** `npx vitest run src/app/actions/transcripts-edit.integration.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(transcripts): corrections with revision checks`.

### Task 6: Media flags may carry a quote

**Files:**
- Modify: `src/components/evidence/build-flag-anchor.ts`, `src/app/actions/flagged-moments.ts`, `src/lib/flag-anchor.ts` (label: `mm:ss–mm:ss "quote…"` when both)
- Test: `src/components/evidence/build-flag-anchor.test.ts`, existing flagged-moments action tests

**Interfaces:**
- Produces: media anchor `{ kind: "media"; timeSeconds: number; endSeconds: number | null; quote: string | null }` accepted end to end (quote trimmed, ≤ `MAX_QUOTE_CHARS`).

- [ ] **Step 1: Failing tests**: media anchor with quote builds and the action stores `timeSeconds`, `endSeconds`, `quote`; a quote without `timeSeconds` on a media document is still refused; `flagAnchorLabel` shows both parts.
- [ ] **Step 2: Run** the two test files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(evidence): media flags may carry a transcript quote`.

### Task 7: Transcript read + pane (sync, seek, follow, find, highlights)

**Files:**
- Create: `src/lib/queries/transcript.ts` (`getDocumentTranscript`)
- Create: `src/components/transcripts/transcript-pane.tsx`, `transcript-segment.tsx`, `transcript-status.tsx`, `find-bar.tsx`
- Modify: `src/components/evidence/media-review.tsx` (render pane; expose `currentTime` + `seek` to it), both viewer pages `src/app/(dashboard)/{matters,intake}/[id]/documents/[documentId]/page.tsx` (load transcript + flags; pass permissions `canTranscribe`, `canEditTranscript`, `canDeleteTranscript`; `?t=` also scrolls the pane)
- Test: `src/components/transcripts/transcript-pane.test.tsx`, `src/lib/queries/transcript.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4 (`requestTranscript`), 6.
- Produces:
  - `type TranscriptView = { id: string; status: "queued"|"processing"|"completed"|"failed"; error: string | null; correctedAt: Date | null; correctedByName: string | null; speakers: Record<string,string>; segments: { id: string; index: number; speaker: string; startSeconds: number; endSeconds: number; text: string; words: Word[]; originalText: string | null; revision: number }[] }`
  - `getDocumentTranscript(documentId: string): Promise<TranscriptView | null>` (asserts access)
  - `<TranscriptPane transcript={TranscriptView | null} documentName currentTime onSeek flags canTranscribe canEdit durationSeconds />`

Behaviour: status UI per spec (button label `Transcribe (mm:ss)` using the media's duration; confirm dialog on `needsConfirm`); completed with 0 segments → "No speech detected"; words rendered as spans with `data-s`; active word from `activeWordIndex` per segment (only the segment containing `currentTime` gets a non-null active index, so `React.memo` skips the rest); follow mode scrolls the active word into view; a user wheel/touch scroll pauses it and shows "Resume following"; click word/timecode → `onSeek(s)`; flags with `endSeconds` tint covered words by category color (`flag-category.ts`), point flags render a marker before the nearest word; find bar (`⌘F`/`Ctrl+F` inside the pane, Enter/Shift+Enter) counts and cycles matches, seeking to each. A pane menu offers "Re-transcribe" (`canTranscribe`; confirms when corrected) and "Delete transcript" (`canDeleteTranscript`, `confirmAction`, calls `deleteTranscript`).

- [ ] **Step 1: Failing tests**: renders speakers + `[00:00:03]` timecodes; `currentTime` 4.2 marks the right word `aria-current`; clicking a word calls `onSeek` with its `s`; flag span tints words in range only; find "officer" shows `2 of 5` and Enter seeks; zero segments → "No speech detected"; failed → reason + Retry calls `requestTranscript`; Delete transcript hidden without `canDeleteTranscript` and calls `deleteTranscript` after confirm; render counter: with 400 segments, moving `currentTime` within one segment re-renders 1 segment (Review Focus 5). Query: walled user gets refused; returns `null` when none.
- [ ] **Step 2: Run** `npx vitest run src/components/transcripts src/lib/queries/transcript.integration.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; run existing viewer page tests.
- [ ] **Step 5: Commit** `feat(transcripts): synced transcript pane in the media viewer`.

### Task 8: Selection toolbar and edit mode

**Files:**
- Create: `src/components/transcripts/selection-toolbar.tsx`, `src/components/transcripts/segment-editor.tsx`, `src/components/transcripts/speaker-chip.tsx`
- Modify: `transcript-pane.tsx`, `src/components/evidence/media-review.tsx` (open the flag composer with a prefilled media+quote anchor)
- Test: `src/components/transcripts/selection-toolbar.test.tsx`, `src/components/transcripts/segment-editor.test.tsx`

**Interfaces:**
- Consumes: Task 5 actions, Task 6 anchor, Task 2 `formatShortTimecode`.
- Produces: `selectionToSpan(selection: Selection, root: HTMLElement): { startSeconds: number; endSeconds: number; quote: string } | null` (exported, pure over the DOM `data-s`/`data-e` attributes).

Behaviour: selecting words shows **Flag selection** (when the user can create flags) and **Copy with timecode** (`"<quote>" (<document name> at <m:ss>)`); edit mode (only with `canEdit`): Edit toggle → each paragraph shows a pencil; editing opens a textarea with Save/Cancel; conflict → inline "Someone else changed this paragraph." + Reload (`router.refresh()`); speaker chip → menu with Rename… (dialog) and "Change speaker for this paragraph" (existing speakers + "New speaker"); "Show original" toggles a muted original text under an edited paragraph with "Revert".

- [ ] **Step 1: Failing tests**: `selectionToSpan` across two paragraphs → first word's `s`, last word's `e`, quote = selected text (Review Focus 4); toolbar Flag opens composer with that anchor; Copy writes the exact string to `navigator.clipboard`; editor Save calls `updateTranscriptSegment` with `revision`; conflict result shows the message; rename calls `renameTranscriptSpeaker`; no edit controls without `canEdit`.
- [ ] **Step 2: Run** `npx vitest run src/components/transcripts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(transcripts): flag from selection, copy with timecode, corrections UI`.

### Task 9: Global search group

**Files:**
- Modify: `src/lib/queries/search.ts` (new `transcripts` group), the results page component that renders groups (follow the documents group)
- Test: `src/lib/queries/search.test.ts` (or its integration sibling where document scoping is tested)

**Interfaces:**
- Produces: result rows `{ type: "transcript"; documentId; documentName; speakerName; snippet; startSeconds; href }`, `href` = viewer path + `?t=<Math.floor(startSeconds)>`.

- [ ] **Step 1: Failing tests**: a segment containing the query is found with its timecode href; a segment on a walled matter is not; a lead document's transcript links to the intake viewer; group capped like documents.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — ILIKE on `TranscriptSegment.text` with the same `Document` where-clause documents use.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(search): transcripts in global search`.

### Task 10: Timecode PDF export

**Files:**
- Create: `src/lib/transcription/export.ts` (`toTranscriptExport`), `src/app/print/transcripts/[documentId]/page.tsx`
- Modify: transcript pane header (Export button → opens the print route in a new tab)
- Test: `src/lib/transcription/export.test.ts`, `src/app/print/transcripts/[documentId]/page.test.tsx`

**Interfaces:**
- Produces: `type TranscriptExport = { title: string; caption: string; documentName: string; durationSeconds: number | null; transcribedAt: Date; corrected: { by: string; at: Date } | null; paragraphs: { speaker: string; timecode: string; text: string }[] }`; `toTranscriptExport(view: TranscriptView, ctx): TranscriptExport` — the one input every future format renders.

Page: authenticates itself (ADR-028, guards never in try/catch), `getDocumentTranscript` for access, 404 when none/not completed; header per spec; footer exact copy from Global Constraints; dates in the user's zone (ADR-012); `@media print` page numbers like `/print/invoices/[id]`.

- [ ] **Step 1: Failing tests**: export maps speaker names and `[00:04:12]`; corrected vs uncorrected footer copy; page refuses a walled user; renders paragraphs.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(transcripts): timecode PDF export`.

### Task 11: Docs, ADR, finish

**Files:**
- Create: `docs/decisions/0NN-transcription-runs-at-a-provider-on-request.md` (next free number) + row in `docs/decisions/README.md`
- Modify: `docs/features/documents.md`, `docs/features/evidence-review.md`, `docs/features/search.md`, `docs/ROADMAP.md`, `.env.example` (`ASSEMBLYAI_API_KEY=`, `TRANSCRIPTION_MONTHLY_HOURS=50`)
- Delete: `docs/superpowers/specs/2026-10-21-transcripts-design.md`, `docs/superpowers/plans/2026-10-21-transcripts.md`

- [ ] **Step 1:** ADR: on request only; presigned URL, bytes never through our functions in prod; provider copy deleted after storing; dev uploads bytes from the server; no portal exposure; cap. 
- [ ] **Step 2:** Feature docs: shipped section; open work = clip reels (Spec 2), export formats (page:line PDF, .docx, .vtt/.srt — "we want to expand on this"), auto-transcribe, batch, portal sharing, custom vocabulary, settings UI for the cap; launch checklist line: AssemblyAI zero-retention/BAA signed by the firm.
- [ ] **Step 3:** Full `npm test` → PASS.
- [ ] **Step 4: Commit** `docs(transcripts): ship docs, ADR; remove spec and plan`.
