# Transcripts for audio and video documents — design

Status: approved in conversation 2026-10-21; awaiting written-spec review.
Tier: Full (schema change, external provider, concurrency on edits).

## Goal

Reduct-style transcript review for recordings in a matter's (or intake's)
Documents: bodycam, dashcam, interviews, client calls, depositions. The
transcript is the primary surface for working a recording: read along while
it plays, click a word to jump there, flag passages straight from the text,
find words across every recording, correct the machine's mistakes, and
export something citable.

### What the user asked for

- Flag from the transcript, search across recordings, export / cite.
- "Think like Reduct."
- v1 includes corrections, highlights on the transcript, and clip reels.
- Provider: AssemblyAI. Trigger: on request only.
- Export: timecode PDF first; we want to expand export formats later.

### Decomposition

Clip reels are their own subsystem (reel records, cross-recording playback,
eventual video render). They get **Spec 2** after this ships. This spec
must not block them: reels will reference `(documentId, startSeconds,
endSeconds)` spans, never segment ids, so transcript edits never break a
reel.

### Assumptions (correct me)

- English-first; language auto-detected and stored, not user-selected.
- Transcripts are internal work product: never shown in the client portal
  in v1.
- One transcript per Document. A "Copy to…" copy (ADR-043, shares the
  stored file) reuses an existing completed transcript instead of paying
  again.

## Scope

In v1:

1. On-request transcription via AssemblyAI (async job, webhook + sweep).
2. Transcript pane in the media viewer: synced active word, follow mode,
   click-to-seek, speaker-labeled paragraphs with timecodes.
3. Flag from a text selection; flags shown as highlights in the text.
4. Find-in-transcript.
5. Corrections: edit paragraph text (word timings preserved/interpolated),
   reassign a paragraph's speaker, rename speakers, show/revert original.
6. Global search over transcript text with timecode deep links.
7. Timecode PDF export.
8. Cost cap and retention controls.

Out of v1 (follow-ups in `docs/features/documents.md`): clip reels (Spec 2);
export formats page:line PDF, .docx, .vtt/.srt; auto-transcribe on upload or
per matter; batch transcribe a folder; portal sharing; custom vocabulary;
multi-track sync with `EvidenceSync`; transcripts for the legacy `Evidence`
model.

## Data model

Two new models (one migration, expand-only per ADR-058).

```prisma
model Transcript {
  id              String    @id @default(cuid())
  documentId      String    @unique
  /// queued | processing | completed | failed
  status          String
  provider        String    @default("assemblyai")
  providerJobId   String?   @unique
  /// Per-job secret the webhook must echo in its auth header. Cleared
  /// when the job finishes.
  webhookSecret   String?
  language        String?
  durationSeconds Float?
  /// Speaker labels as the provider returned them, mapped to display
  /// names: { "A": "Officer Diaz", "B": "Speaker B" }.
  speakers        Json      @default("{}")
  /// Set once anyone edits text, speakers or names.
  correctedAt     DateTime?
  correctedById   String?
  error           String?
  requestedById   String
  requestedAt     DateTime  @default(now())
  completedAt     DateTime?
  updatedAt       DateTime  @updatedAt

  document      Document            @relation(fields: [documentId], references: [id], onDelete: Cascade)
  requestedBy   User                @relation("TranscriptRequestedBy", fields: [requestedById], references: [id])
  correctedBy   User?               @relation("TranscriptCorrectedBy", fields: [correctedById], references: [id])
  segments      TranscriptSegment[]

  @@index([status, requestedAt])
  @@map("transcripts")
}

/// One speaker turn / paragraph.
model TranscriptSegment {
  id           String     @id @default(cuid())
  transcriptId String
  index        Int        /// Order within the transcript
  speaker      String     /// Provider label key ("A"), names live on Transcript.speakers
  startSeconds Float
  endSeconds   Float
  /// Plain text, words joined: what search matches and export prints.
  text         String
  /// [{ w: string, s: number, e: number, c?: number }] — word, start/end
  /// seconds, provider confidence. Edited words get interpolated s/e.
  words        Json
  /// The provider's text before any correction; null when never edited.
  originalText String?
  /// Optimistic concurrency for corrections.
  revision     Int        @default(0)

  transcript Transcript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)

  @@unique([transcriptId, index])
  @@index([transcriptId, startSeconds])
  @@map("transcript_segments")
}
```

Invariants (SCHEMA_NOTES.md gets the non-obvious ones):

- `Transcript.documentId` unique = at most one transcript, so at most one
  active job, per document. Re-run replaces in place (status back to
  `queued`, segments deleted when the new result lands).
- Scope comes from the Document: every read and write goes through
  `assertChildMatterAccess("document", documentId)` / `matterAccessWhere`
  (ADR-039). No `matterId` on these tables.
- Segment `text` is always derivable from `words`; written together.
- Timings in seconds (Float), matching `FlaggedMoment.timeSeconds`.

## Provider adapter

`src/lib/transcription/` — the only code that knows AssemblyAI:

- `assemblyai.ts`: `submitJob({ audioUrl, webhookUrl, webhookSecret })` →
  `{ jobId }`; `fetchResult(jobId)` → normalized result or status;
  `deleteJob(jobId)`. Requests `speaker_labels: true`, word timestamps
  (default), punctuation/formatting on. Server-only env `ASSEMBLYAI_API_KEY`.
- `normalize.ts` (pure): provider utterances/words → our segments
  (`speaker`, `startSeconds`, `endSeconds`, `text`, `words`), splitting very
  long turns at sentence ends (~90 s cap) so paragraphs stay readable and
  edits stay small.
- `types.ts`: the normalized shape, so a second provider is a new file plus
  one switch.

## Job flow

1. **Request** — server action `requestTranscript(documentId)` in
   `src/app/actions/transcripts.ts`:
   `requirePermission("documents.transcribe")` → document access → must be
   audio/video (same resolver as the viewer) with a stored file → refuse if
   a job is `queued`/`processing` → if another document
   with the same `fileUrl` in the same scope has a `completed` transcript,
   copy it (segments + speakers, `requestedById` = caller) and finish
   (free, so it precedes the cap) → monthly cap check →
   else upsert Transcript `queued`, presign the file (existing
   `signedBlobUrl`, 6 h media lifetime), `submitJob`, store `providerJobId`,
   status `processing`. `logActivity` "Transcription requested". Re-running
   over a corrected transcript requires `{ replaceCorrections: true }`
   (the UI confirms first).
2. **Webhook** — `POST /api/webhooks/assemblyai` (webhooks are the existing
   exception to "mutations are server actions", see `src/app/api/webhooks`):
   look up Transcript by `providerJobId`; constant-time compare the auth
   header to `webhookSecret`; ignore the body beyond the job id and call
   `fetchResult` (never trust the payload); on success write segments in
   one transaction (delete old, insert new, status `completed`,
   `durationSeconds`, `language`, clear secret), then `deleteJob` on the
   provider; `logActivity`; `createNotification` to the requester. On
   provider error: status `failed`, `error` message, notify.
   Idempotent: a completed transcript ignores repeats.
3. **Sweep** — cron `/api/transcription-sweep` every 10 min (and the dev
   path, where webhooks can't reach localhost): for `processing` jobs older
   than 2 min, `fetchResult` and finish as above; jobs older than 6 h →
   `failed` ("Timed out").
4. **Local dev** — the local storage driver has no public URL for the
   provider to fetch. Dev uploads the file bytes with AssemblyAI's upload
   endpoint (from the server, local only) instead of a presigned URL; prod
   never does (ADR-034: bytes don't pass through our functions).

## Viewer

`MediaReview` grows a transcript pane (new `src/components/transcripts/`):

- Layout: video player sticky on top, transcript scrolling below; audio uses
  the compact player bar with the transcript as the body; the flags rail
  stays on the right at desktop widths.
- States: none → "Transcribe (mm:ss)" button (shows duration; hidden
  without `documents.transcribe`); queued/processing → spinner, safe to
  leave; failed → reason + Retry; completed → transcript.
- Sync: active word from `currentTime` by binary search over word starts
  (pure helper), updated on `timeupdate` + `requestAnimationFrame` while
  playing. Follow mode auto-scrolls; manual scroll pauses it and shows a
  "Resume following" pill.
- Click a word → seek.
- Selection toolbar: **Flag selection** → media flag with `timeSeconds` =
  first word start, `endSeconds` = last word end, `quote` = selected text
  (relaxes the "media flags carry no quote" rule in `build-flag-anchor.ts`
  and the flag action; no schema change). **Copy with timecode** →
  `"…" (<document name> at mm:ss)`.
- Highlights: span flags tint the covered words by category color; point
  flags get a marker at the nearest word; clicking one focuses it in the
  rail.
- Find bar: matches across segment text, count, next/prev, scroll + seek.
- Speaker paragraphs: name chip + `[hh:mm:ss]` timecode (click seeks).

## Corrections

Gated by `documents.transcript.edit`. "Edit" toggle on the pane.

- Paragraph edit: the paragraph becomes a textarea; save calls
  `updateTranscriptSegment(segmentId, { text, revision })`. Server aligns
  new tokens to old words (pure `alignWords`: LCS over normalized tokens;
  matched words keep `s/e`; inserted/replaced runs get evenly interpolated
  timings inside the gap between their matched neighbours), sets
  `originalText` on first edit, bumps `revision`. Stale `revision` →
  `{ ok: false, conflict: true }` → UI shows "Someone else changed this
  paragraph" with Reload.
- Speaker: reassign a paragraph (`setSegmentSpeaker`) or rename a label
  everywhere (`renameTranscriptSpeaker`, edits `Transcript.speakers`).
- Show original / Revert paragraph: revert sets the text back to
  `originalText` through the same `alignWords` path. Timings for words that
  survived every edit are the provider's; re-typed words keep interpolated
  timings. Exact provider timings for the whole file come back only by
  re-running (which asks first, since it drops corrections).
- Each save sets `correctedAt/By` and logs one activity row per save.

## Search

`globalSearch` gains a Transcripts group: ILIKE on `TranscriptSegment.text`
joined through Transcript → Document with the same scope rules documents
use (matter access walls, lead scope). Result: document name, speaker,
highlighted snippet, timecode; link to the viewer with `?t=<startSeconds>`
(the viewer also scrolls the transcript there). Capped like other groups.

## Export

`/print/transcripts/[documentId]` — chrome-free page following
`/print/invoices/[id]` (browser Save-as-PDF):

- Header: matter caption (or intake name), document name, recording
  duration, transcribed date, "Corrected by <name> on <date>" or
  "Uncorrected machine transcript".
- Body: speaker-labeled paragraphs, `[hh:mm:ss]` at each paragraph.
- Footer on every page: page number + the corrected/uncorrected notice.
- Authenticates itself (ADR-028) and checks document access.
- **We want to expand on export.** Planned next formats: page:line
  deposition-style PDF ("Tr. 12:4"), .docx, .vtt/.srt captions. The
  export code takes a normalized `TranscriptExport` (segments + metadata)
  so each format is a renderer over the same data.

## Permissions

New keys in `src/lib/permissions.ts` (+ docs/PERMISSIONS.md), granted by
migration to roles holding `documents.upload` (transcribe/edit) and
`documents.delete_any` (delete):

- `documents.transcribe` — request / re-run (add).
- `documents.transcript.edit` — corrections, speakers (edit).
- `documents.transcript.delete` — delete a transcript (delete).
- View follows document view access; no key.

## Privacy, retention, cost

- Provider sees one presigned URL (6 h) per job; API key server-only;
  webhook verified by per-job secret; provider copy deleted after storing.
  Non-success paths (failure, timeout, a deleted transcript or document)
  also delete it; when the provider refuses, the job id goes into
  `transcript_purges` and the sweep retries (give up after 7 days). A
  BEFORE DELETE trigger on `transcripts` queues in-flight jobs, so
  document and matter cascades are covered.
- Launch checklist (owner: firm): AssemblyAI zero-data-retention / BAA terms
  signed before production use.
- Monthly cap: `TRANSCRIPTION_MONTHLY_HOURS` env (default 50). Sum of
  `durationSeconds` of transcripts completed this calendar month (firm TZ);
  over the cap → new requests refused with the cap in the message. Duration
  is only known once a job finishes, so jobs already in flight can push the
  month past the cap; that overshoot is accepted. Copy-reuse is free and
  not counted. Settings UI later.
- Activity log records every request, completion and correction.
- Decision worth an ADR: "Transcription runs at a third-party provider via
  presigned URL, on request only, provider copy deleted" (new ADR in
  `docs/decisions/`).

## Errors

- Unsupported/corrupt media, provider error, or 6 h timeout → `failed` +
  reason + Retry.
- Duplicate request while active → refused ("Already transcribing").
- Document deleted mid-job → cascade removes the Transcript; the late
  webhook finds nothing and returns 200.
- Cap exceeded → refused before any provider call.
- Missing `ASSEMBLYAI_API_KEY` → the Transcribe button explains
  transcription isn't configured (same pattern as other optional
  integrations).

## Testing

- Unit (pure): `normalize` (fixture of a recorded AssemblyAI response),
  `alignWords`, active-word lookup, timecode formatting, cap math.
- Integration (Docker DB): `requestTranscript` (permission, wall, wrong
  file type, duplicate, cap, copy-reuse), webhook (bad secret, idempotent
  repeat, failure path, deleted document), sweep (timeout), segment edit
  (revision conflict, alignment persisted), speaker rename, search scoping.
- Component: transcript pane sync highlight, click-to-seek, selection →
  flag composer prefill, edit/save/conflict, find bar.
- No real provider calls in CI; the adapter is mocked. One manual smoke
  checklist against AssemblyAI with three real files (bodycam, interview,
  phone call) before launch.

## Docs touched at ship

`docs/features/documents.md` and `evidence-review.md` (shipped + follow-ups
incl. export formats and reels), ROADMAP lines, `PERMISSIONS.md`,
`SCHEMA_NOTES.md` (one-transcript-per-document, text derivable from
words), new ADR, `search.md`. This spec and its plan are deleted in the
finishing commit.
