# /matters/new v2, sub-project 2: matter drafts + originating document (fee agreement)

Status: design approved in chat 2026-10-20; awaiting spec review.
Tier: Full (schema, permissions, data moving between records, concurrency).

Merges the earlier sub-projects 2 (retainer) and 3 (save draft and
resume). "Retainer" here means the **fee agreement / engagement
document**, not money held: no trust deposit and no structured fee terms
at intake (both dropped by the user).

## Goal

With the firm switch on, **no matter is opened without its signed
originating document on file**. Drafts make that practical: intake can
start, be saved, and be finished once the agreement comes back signed.

Success looks like:
- An Admin turns on "Require originating document" in Settings → Firm.
- Each practice area names its originating document ("Contingency fee
  agreement", "Order of appointment"); blank shows "Fee agreement".
- On `/matters/new`, the user can save a draft, resume it later (or a
  teammate on the draft can), attach the agreement and other intake
  files, and Create only succeeds, with the switch on, when an
  originating file is attached, marked Signed, with a signed date.
- Lead conversion obeys the same switch.
- Every matter shows its agreement status on Overview.

Out of scope: trust deposit at intake; structured fee terms; e-sign;
required fields / venue on lead conversion (separate follow-up, ADR-055);
backfilling agreements on existing matters.

## Current state (facts this design relies on)

- `Document` must belong to exactly one of matter / lead
  (`scopeOf`, `src/lib/record-scope.ts`, used by ~55 files).
- Uploads: `POST /api/documents/upload` (local driver, busboy stream)
  and `src/app/api/documents/upload/blob/route.ts` (vercel-blob
  client-direct; `onBeforeGenerateToken` authorizes,
  `onUploadCompleted` writes the Document row). Bytes never go through
  server actions (ADR-034).
- Lead conversion (`convertLeadToMatter`, `src/app/actions/leads.ts`)
  claims the lead with a conditional `updateMany` and re-homes lead
  documents onto the matter.
- Crons: `vercel.json` `crons`, routes authorized with `isAuthorizedCron`
  (`src/lib/cron-auth.ts`, `Authorization: Bearer <CRON_SECRET>`, fails
  closed). Example: `src/app/api/notification-sweep/route.ts`.
- `requireAdmin()` exists in `src/lib/firm.ts`.

## Data model

```prisma
model MatterDraft {
  id          String   @id @default(cuid())
  createdById String
  /// The form's field values as posted (strings / string arrays). Read
  /// only by the form and createMatter; never queried into.
  values      Json
  /// Copied out of `values` for access checks (draft-access.ts).
  leadUserId  String?
  teamUserIds String[] @default([])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  files       MatterDraftFile[]
  @@index([createdById])
  @@index([updatedAt])
  @@map("matter_drafts")
}

model MatterDraftFile {
  id            String      @id @default(cuid())
  draftId       String
  draft         MatterDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  name          String
  fileUrl       String
  contentType   String?
  fileSize      Int?
  uploadedBy    String
  isOriginating Boolean     @default(false) /// at most one true per draft (app-enforced)
  createdAt     DateTime    @default(now())
  @@index([draftId])
  @@map("matter_draft_files")
}

model MatterAgreement {
  id         String    @id @default(cuid())
  matterId   String    @unique
  matter     Matter    @relation(fields: [matterId], references: [id], onDelete: Cascade)
  status     String    @default("not_sent") /// not_sent | sent | signed
  signedDate DateTime? /// date-only, UTC midnight (ADR-012)
  documentId String?   @unique
  document   Document? @relation(fields: [documentId], references: [id], onDelete: SetNull)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  @@map("matter_agreements")
}
```

- `PracticeArea.originatingDocLabel String?` (null/blank → "Fee agreement").
- `Firm.requireOriginatingDoc Boolean @default(false)`.

Draft files are **not** `Document` rows: the matter/lead scope invariant
is untouched. On Create they become Documents (same stored `fileUrl`, no
byte copy).

Migration is add-only (three tables, two defaulted/nullable columns).
**The user is asked before the migration commit lands on main**, and the
production deploy step goes in `docs/DEPLOY_BACKFILLS.md`.

## Access

`src/lib/draft-access.ts`:
- `draftAccessWhere(userId, isAdmin)`: Admin → all; else
  `createdById = me OR leadUserId = me OR me ∈ teamUserIds`.
- `assertDraftAccess(draftId)`: 404-style `notFound()` on miss (same
  shape as matter access), returns the draft.
- Every draft read, save, delete, file upload and Create goes through it.
- Users listed as lead/team only gain draft access if they hold
  `matters.create` (checked in `assertDraftAccess`): being named on a
  draft never grants intake rights.

## Permissions

New key in `src/lib/permissions.ts`: `matters.agreement.edit`: change
the agreement record (status, signed date, linked document) on an
existing matter. Migration grant: every role holding `matters.edit`.

Drafts: `matters.create` (plus `documents.upload` to attach files). The
firm switch: `requireAdmin()` (not delegable, like matter visibility).
The practice-area label: `firm.manage_practice_areas`.

## Server actions

`src/app/actions/matter-drafts.ts` (new):
- `saveMatterDraft(draftId: string | null, expectedUpdatedAt: string | null, values: Record<string, string | string[]>)`
  → `{ ok: true; draftId; updatedAt } | { ok: false; code: "stale" | "notfound" }`.
  Creates on null id. Stale = `updatedAt` mismatch → message
  "Someone else saved this draft. Reload to see their changes."
  Copies `leadUserId` / `extraTeam` out of `values`.
- `deleteMatterDraft(id)`: creator or Admin only; deletes rows, then
  removes stored files after commit.
- `setDraftFileOriginating(fileId)`, `removeDraftFile(fileId)`.
- All gated `matters.create` + `assertDraftAccess` and revalidate
  `/matters/new`. Draft creation, deletion and file add/remove write a
  firm-level `logActivity` row (`matterId: null`, type `"filing"`, as
  `createLead` does); auto-save updates are not logged. Titles never
  include client names or file names (drafts precede conflict checks),
  e.g. "Matter draft started", "Matter draft deleted", "File attached
  to a matter draft". The matter's create log adds "Opened from a draft
  started by {user} on {date}".

`createMatter` (existing) gains:
- Optional `draftId`. When present: `assertDraftAccess`, and inside the
  transaction claim the draft with
  `tx.matterDraft.deleteMany({ where: { id, updatedAt: expected } })`
  (0 rows → "This draft was already used to open a matter." or stale).
  Files are read before the claim (in the transaction) and re-homed:
  create an "Engagement" folder on the new matter, one `Document` per
  draft file (category `contract` for the originating file,
  `intake` otherwise; `source: "upload"`), then the `MatterAgreement`.
- Agreement fields: `agreementStatus`, `agreementSignedDate`,
  `originatingFileId` (a draft file id).
- **Gate** (read from DB inside the transaction): if
  `firm.requireOriginatingDoc`, require an originating file that belongs
  to this draft, `agreementStatus = "signed"`, and a valid
  `agreementSignedDate` not in the future (user's profile-zone today).
  Errors: `originatingFileId` "Attach the signed {label}.",
  `agreementStatus` "Mark the {label} as signed.",
  `agreementSignedDate` "Enter the date it was signed." / "The signed
  date can't be in the future."
- Without a draft and with the switch on: refused with the
  `originatingFileId` error (a file can only be attached via a draft).
- Switch off: agreement row written with whatever was entered (default
  `not_sent`), file optional.
- Order: after the existing required-field/venue checks, before the
  ADR-054 conflict gate (missing paperwork never asks for a conflict
  acknowledgement).
- Storage: nothing is deleted by Create (files are re-homed, not
  copied). Timeline/log: "{Label} signed YYYY-MM-DD" when signed.

`convertLeadToMatter` gains `agreementStatus`, `agreementSignedDate`,
`originatingDocumentId` (a Document on this lead). Same gate, same
errors, agreement row written in the conversion transaction after the
lead's documents are re-homed (the picked document moves with them).

`src/app/actions/matter-agreement.ts` (new): `updateMatterAgreement(matterId, …)`,
gated `matters.agreement.edit` + `assertMatterAccess`. With the switch
on, the result must still be signed with a date and a document (can only
move to another signed document of this matter). Logs old → new. Creates
the row if missing.

`src/app/actions/firm.ts`: `setRequireOriginatingDoc(on: boolean)`
gated `requireAdmin()`, logged.

Practice-area actions accept `originatingDocLabel` (trimmed, max 80,
blank → null).

## Uploads

Both upload paths accept `draftId` as a third, mutually exclusive target
(400 if combined with `matterId`/`leadId`):
- Authorization: `assertDraftAccess` equivalent that returns a status
  (route handlers can't redirect) + `documents.upload`.
- Limits for draft targets: 50 MB per file, 20 files per draft
  (counting existing rows); over → 400 with a clear message.
- Writes `MatterDraftFile` instead of `Document`. The first file
  uploaded while the draft has no originating file is not auto-marked;
  the form marks it explicitly.
- `onUploadCompleted` re-checks the draft exists; if it was deleted
  mid-upload, the stored blob is deleted and nothing is written.

## Cleanup cron

`src/app/api/matter-draft-sweep/route.ts`, daily (`0 6 * * *` in
`vercel.json`), `isAuthorizedCron`. Deletes drafts with
`updatedAt` older than 90 days and their stored files (rows first, files
after commit; a file-delete failure is logged, not retried). The drafts
list shows "Deletes in N days" when N ≤ 14.

## UI

**`/matters/new`:**
- Drafts list above the form (only when the user can see any): client
  name or "Untitled draft", practice area, last saved (profile zone),
  started by; Resume, and Delete for creator/Admin.
- `?draft=<id>` loads the draft (page does `assertDraftAccess`).
- "Save draft" button beside Create. First save (or first attach)
  creates the draft and `router.replace`s to `?draft=<id>`. After that,
  auto-save every 30 s when values changed, with "Saved h:mm a" /
  "Saving…" / the stale message.
- Drafts save regardless of required fields; all gates apply on Create
  only.
- **Engagement section** (after Details), titled with the area's label:
  status select (Not sent / Sent / Signed), signed date, file list with
  upload button (uses the existing uploader component with the draft
  target), a radio per file "This is the {label}", remove per file.
  With the switch on: section marked required; client-side check mirrors
  the server.
- Create posts `draftId` and the agreement fields.

**Lead conversion dialog:** Engagement block with status, signed date
and a picker of the lead's documents ("This is the {label}"). Required
with the switch on.

**Matter Overview:** agreement card "{Label}: Signed 2026-10-12 · View
document" / "No {label} on file". Edit (with `matters.agreement.edit`):
status, date, document picker from the matter's documents.

**Settings → Firm (Admin only):** "Require originating document" toggle
with a line explaining it applies to new matters only, and a count of
open matters with no signed agreement on file.

**Settings → Practice areas:** "Originating document" text field
(placeholder "Fee agreement").

## Testing

- `matter-drafts.test.ts`: save/create/resume; stale save refused;
  access (creator, lead, team, Admin, outsider, named-but-no
  `matters.create`); delete removes files after commit; file
  originating toggle keeps at most one.
- `matters.test.ts`: Create from draft re-homes files into an
  Engagement folder, writes the agreement, deletes the draft; double
  Create refused; gate refusals (no file, not signed, no date, future
  date, file from another draft, no draft) with the switch on; switch
  off succeeds with and without a file; gate runs before the conflict
  gate.
- `leads.test.ts`: conversion gate on/off; picked document must belong
  to the lead; agreement row written.
- `matter-agreement.test.ts`: edit gated; switch on can't clear signed
  or document; relink only to a matter document.
- Upload route tests (both): `draftId` access, exclusivity, size and
  count limits, draft deleted mid-upload cleans up.
- Cron route test: auth fails closed; deletes only drafts older than 90
  days and their files.
- Form tests: Save draft creates and updates URL; auto-save status;
  stale message; Drafts list; Engagement section required markers with
  the switch on.
- `npm run check:migrations`.

## Docs (same commit as the feature lands)

- New ADR-056: drafts hold intake files until Create (files are not
  Documents until then); the firm can require a signed originating
  document, enforced on create and conversion, Admin-only switch.
- `docs/features/matters.md`, `docs/features/intake.md`,
  `docs/features/settings-admin.md`, ROADMAP line.
- `docs/DEPLOY_BACKFILLS.md`: the migration and the new cron
  (`CRON_SECRET` already required).
- `docs/SCHEMA_NOTES.md`: draft files are not Documents;
  one originating file per draft is app-enforced.
- Delete this spec and its plan when done.
