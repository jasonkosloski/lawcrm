# Schema & Data Model Notes

Rationale, invariants, and conventions for the Prisma schema. The models, columns, and relations themselves live in `prisma/schema.prisma`; migration history lives in `prisma/migrations/` and git. This file holds only what neither can say. Update it in the same change that makes it stale; architectural choices get an ADR (`decisions/`).

---

## Design Principles

1. **Start simple, refactor when we hit a wall.** Don't build a model for a hypothetical need (ADR-005). Migrations are cheap.
2. **JSON columns are fine for semi-structured data** (email recipients, automation steps) but normalize if we ever need to query/filter on them.
3. **No soft-delete pattern by default.** Where history matters, the model opts in (`MatterTeamMember.removedAt`, `Contact.mergedIntoId`/`isActive`, `DocumentTemplate.isActive`). If compliance requires more, add `deletedAt` per model.
4. **Timestamps:** every model has `createdAt`; most have `updatedAt`. `ActivityLog` is append-only (no `updatedAt`).
5. **Free-string enums** (`category`, `source`, `type`, `kind`, invoice `status`) are deliberate: adding a value is data/config, not a migration. True Postgres enums are used only where the set is closed (`SolPeriodUnit`, `MatterVisibility`, `RecordsPeriodUnit`).
6. **Keep catalogs in code, not data**: permission keys (`src/lib/permissions.ts`), merge fields (`src/lib/template-merge.ts`), flag categories (`src/lib/constants/flag-category.ts`). Adding one is a code change.
7. **App-enforced invariants are deliberate** where a DB constraint can't express them (see below). Enforce them in the action layer and pure helpers, and add a test.

---

## Cross-cutting conventions

- **Money is `Decimal(14,2)`** (`Settlement.firmFeePercent` is `Decimal(7,4)`), never `Float` (Float drifts by $0.01; IOLTA regulators won't accept that). The query layer converts Decimal to number at the API boundary; the DB holds the canonical value. `TimeEntry.hours` and `EvidenceSync.timeOffset` stay Float (not money; hours are validated to 2 dp). ADR-036.
- **Date-only values are UTC-midnight** (ADR-012). Records-request dates and deadlines follow it.
- **Scope-of-record pattern (matter vs intake lead).** Several models carry nullable `matterId` + `leadId`. The invariant is app-enforced, and each uses a throwing helper that rejects a bad row:
  - EXACTLY ONE of (matterId, leadId): `TimeEntry` (`src/lib/time-entry-scope.ts`), `Note` (`noteScopeOf`, `src/lib/note-scope.ts`), `Document` and `DocumentFolder` (`scopeOf` in `src/lib/record-scope.ts`; a folder and its documents share a scope; helpers `scopeWhere` / `scopeBasePath`, `src/lib/scope-access.ts`: `assertScopeAccess`, `assertScopeWritable`, `revalidateDocumentScope`), `RecordsRequest`.
  - AT MOST ONE: `Task` and `CalendarEvent` (both already allowed null matter: firm-wide task, personal event; `optionalScopeOf` in `record-scope.ts`).
  - Lead FKs Cascade (a deleted lead takes its intake rows) except `CalendarEvent.leadId` (SetNull, like the matter side, so a lost lead leaves a personal event that may be synced to Google) and `TimeEntry` / `Document` (Restrict, below).
  - `convertLeadToMatter` re-homes every lead row (time, notes, tasks, events, documents, folders) onto the new matter inside its transaction (`updateMany`, leadId cleared) BEFORE the lead could ever be deleted, activity-logged "N intake X carried forward". That ordering is why Cascade is safe. Note replies, reads and reactions key off the note id, so threads arrive intact.
  - **Null-safety**: anything that assumed `matterId` non-null must tolerate lead rows (dashboard "Your tasks", search, calendar, `/time`). Lead rows render as "Intake · {lead name}" linking to the `/intake/[id]/...` tab. `EventNote.matterId` is typed nullable (event notes are always matter notes).
  - Lead notes carry no entity links (event/task/deadline/time/email/message), no attached tasks/deadlines/time; `createLeadNote` refuses them. Lead-scoped *expenses* are NOT supported: `Expense.matterId` stays required and there is no lead column (the unwired `Expense.leadId` was dropped, ADR-049).
- **Records outlive nothing by accident**: `TimeEntry`, `Expense`, `Invoice`, `TrustTransaction`, `Settlement` and `Document` are `onDelete: Restrict` from `Matter` (and `TimeEntry`/`Document` from `Lead`). Matters and leads are closed or archived, never deleted, so the restriction only bites a script or manual `DELETE`, which now fails instead of erasing a trust ledger. Purely derived child rows (team, pins, notes, tasks, activity) still cascade.
- **Nullable-FK backstops**: where an action does the real work (e.g. folder delete re-parents contents first), the FK's SetNull is only a backstop for paths that bypass the action.
- **Migrations**: `0_init` is the Postgres baseline (the old 30 SQLite-era migrations never ran on Postgres; every Postgres DB was built by `db push`). Existing DBs get `prisma migrate resolve --applied 0_init` after a drift check; schema changes ship as reviewed migrations (ADR-016). The production build applies pending migrations before `next build` (ADR-058), so a migration committed to main goes live with the next push. Write expand-only migrations (the previous deployment keeps serving during the build); one that drops, renames or retypes needs an `ALLOW_DESTRUCTIVE` file in its folder, added only once the live code no longer uses what it removes. Backfills and manual recovery: `DEPLOY_BACKFILLS.md`.
- **Admin has no `RolePermission` rows**: `hasPermission` treats the Admin role as all-granted by name. Unknown permission keys are tolerated on read so removing a key from the catalog doesn't break existing rows (see `PERMISSIONS.md`).

---

## Per-model notes

Only non-obvious facts; anything not listed is as `schema.prisma` reads.

**Matter drafts / agreement** (ADR-056)
- **MatterDraftFile**: not a `Document` until Create moves it into the matter; `isOriginating` true on at most one file per draft is app-enforced, not a constraint. `MatterDraft.values` is read only by the form and create, never queried; `leadUserId`/`teamUserIds` are copies for access checks.
- **MatterAgreement**: one per matter (`matterId` unique); `documentId` is unique and `SetNull` if the document goes. Dates are date-only UTC midnight (ADR-012).

**Identity / firm**
- **User**: `jobTitle` is the display title; admin power comes from membership in the `Admin` role (no `isAdmin` column). `dashboardPrefs` shape is `{ visible, order }`.
- **Firm**: single-tenant today (one row, every User belongs to it); `firmId` is the intended multi-tenant scoping handle (would attach at the `getStaffAuth()` seam, `src/lib/staff-auth.ts`), but `Contact.firmId` is nullable and not a scoping handle yet. `matterVisibility` (FIRM | TEAM, default FIRM) is the matter-access switch, enforced (ADR-039). `dailyHoursGoal` (6.0) / `monthlyBillableGoal` (200) are firm data edited under `firm.edit_info`.
- **Role / UserRole**: Admin and default are seeded locked system roles (no rename/delete). **RolePermission**: composite PK (roleId, permission).
- **ActivityLog.leadId** (ADR-049): set on intake-lead rows (`matterId` null) so the lead wall can filter the feeds; `optionalRecordAccessClause` treats it like the other lead-bearing models. The migration backfilled it from rows whose `detail` starts `lead <id>:`; older rows that only name the lead stay firm-wide.
- **Lead / Matter `restricted`** (ADR-049): opt-in walls. Lead visibility = `restricted = false` OR a `LeadTeamMember` row (OR `intake.view_restricted` / Admin); `LeadTeamMember` hard-deletes and reuses the matter-team role vocabulary so conversion copies it. `Matter.restricted` only matters in FIRM mode. Both where-fragments are a single top-level `NOT` so spreads don't clobber a caller's `OR`.
- **ActivityLog**: append-only audit trail; auth rows are identified by title (`AUTH_EVENT_TITLES`), the /settings/security history filter, so existing titles must NEVER be renamed. Pre-Clerk titles (failed sign-in, password change, unlock) remain as stored strings. Role create/rename/delete, permission grant/revoke, integration connect/disconnect and firm/team edits log as type `auth`; invoice/expense writers log as `filing`. Expense rows are identified by an `Expense ` title prefix (ADR-021).

**Matters / contacts / intake**
- **Venue** (ADR-055): `nameKey` is the lowercased, trimmed name and is unique across active AND archived rows, so a re-add of an archived venue is refused rather than duplicated. `Matter.venueId` is `Restrict`. `PracticeArea.requiredMatterFields` / `matterNameTemplate` (null = firm's `Firm.matterNameTemplate`) drive the new-matter form.
- **Matter**: URLs use the cuid, not a slug (ADR-006). `wipAmount` is never written or read (Overview WIP is aggregated live from unbilled time and billable expenses); drop candidate. The user-facing billing type is derived from `feeStructure` + `billingMode` (`billingTypeOf`, ADR-060); never add a column for it, and always write both fields via `billingTypeFields`. `PracticeArea.allowedBillingTypes`/`defaultBillingType` drive creation; `defaultBillingMode` is deprecated and unread (drop later). Non-`client` modes still route through the traditional UX with a "flow not implemented" banner. Invariant: `clientId` set implies a `MatterContact` with `category = client` (also in `convertLeadToMatter`, which claims the lead with a stage-predicate `updateMany` inside the transaction so a double submit converts once). `statuteOfLimitationsDate`: see SOL below.
- **UserMatterPin**: per-user pins (replaced the global `Matter.isPinned`), ADR-010.
- **MatterTeamMember**: soft-delete via `removedAt`/`removedBy` (null = active) to keep historical attribution. (matterId, userId) stays unique: re-adding upserts (clears `removedAt`, sets new role). Queries finding the lead scope to `removedAt: null`. UI labels "[role] (former)".
- **MatterContact**: role per matter. `representationContactId` points representing attorneys at first-class Contacts (so repeat counsel coalesces and deep-links to `/contacts/[id]`); the legacy free-text representation* columns are a fallback for un-backfilled rows.
- **Contact**: polymorphic `type` string (may split if types diverge). `Contact.phone` plus `ContactPhone` rows (label, `isPrimary`, order). Merge: the loser is soft-deleted (`isActive=false`, `mergedIntoId` -> survivor, SetNull) so old links and audit rows resolve and the loser's page redirects; `notes` and `conflictStatus` carry over. `conflictStatus` is a manual flag the intake matcher does not read (ADR-026, open decision). `firmId` is stamped only by `createContact`, `createMatter`'s inline client and calendar attendee creation; party creation in `parties.ts`, the legacy no-`contactId` branch of lead conversion and the seed leave it null.
- **Lead**: every lead attaches to a first-class Contact (`contactId`, same shape as `Matter.clientId`); conversion reuses it rather than creating a new contact. Legacy `name`/`email`/`phone` are a fallback for un-backfilled rows. `statuteWindow` is a days-remaining snapshot as of `createdAt` (UI derives live = snapshot minus days since intake); not an absolute date, does not follow practice-area changes.
- **PracticeArea**: firm-configurable at /settings/practice-areas. SOL config is `statutePeriodAmount` + `statutePeriodUnit` (DAYS|MONTHS|YEARS, calendar arithmetic, ADR-035) plus `statuteSourceCitation`; `statutePeriodDays` is deprecated and unread. **MatterStage**: per-area stages, unique (practiceAreaId, name), `isTerminal`.
- **SOL auto-vs-manual is inferred, not stored** (`src/lib/sol.ts`, ADR-027): on matter edit, a stored `statuteOfLimitationsDate` equal to `computeSolDate(stored incidentDate, stored area period)` (or null) is auto-derived and recomputed; anything else is a manual override and is kept. Caveats: a manual date that happens to equal the computed one follows later edits; changing an area's period makes legacy dates look manual (the safe direction).

**Documents / evidence**
- **Document**: `fileUrl` is storage-agnostic (ADR-015/018). Copies ("Copy to...") are independent rows sharing the stored `fileUrl`; `deleteDocument` removes bytes only when no other row references them. "Saved" for the delete-an-email prompt means another document outside the email shares the attachment's file (ADR-043). Email attachments: `parentDocumentId` (self relation, SetNull backstop) + `attachmentIndex` mark a file extracted from an uploaded .eml/.msg; it shares the email's `folderId` and moves with it; `attachmentsExtractedAt` is the email's extraction claim (atomic claim, released on failure; null = not yet, older emails extract on demand); `source` value `email_attachment`. Deleting an email: attachments with copies elsewhere survive, the rest are deleted or kept per the prompt (`deleteDocument(id, { attachments })`). `recordsRequestId` + `recordsRequestRole` link to records requests (SetNull).
- **DocumentFolder**: tree via `parentId` self-relation (null = root). Sibling-name uniqueness (case-insensitive; a DB unique wouldn't cover roots since Postgres treats NULL parentIds as distinct) and the 8-level depth cap are APP-enforced (`src/app/actions/document-folders.ts`, `src/lib/folder-tree.ts`). Folder delete RE-PARENTS contents (child folders + documents) to the parent in one transaction first, so files never vanish; name collisions get a " (2)" suffix.
- **FlaggedMoment**: attaches to a Document (`documentId`, Cascade); EXACTLY ONE of (documentId, evidenceId) (`evidenceId` is for a future ingestion pipeline). At most one anchor kind, matched to the renderer (`resolveDocumentRenderer`): media -> `timeSeconds` (+ optional `endSeconds`); pdf -> `pageNumber` 1-5000, optional `endPageNumber` (requires `pageNumber`; at most `MAX_PDF_PAGE_SPAN` = 25 pages in all), optionally with a `quote`; docx/text/csv -> `quote` 1-2,000 trimmed (`MAX_QUOTE_CHARS`, app-enforced; column is TEXT); image/doc_legacy/unsupported -> anchorless only. The kind is IMMUTABLE after create (a kind switch is a different fact: delete + re-flag) but a page flag may gain/change/drop its quote and change/drop its end page. A quote without a page is docx/text/CSV-only; time + quote is rejected. `description` 1-500; `category` catalog in `src/lib/constants/flag-category.ts`; `flaggedById` drives the own-flags ownership bypass. Logic: `src/app/actions/flagged-moments.ts`, `src/lib/flag-anchor.ts`. Reads (`src/lib/queries/evidence.ts`) show all kinds ordered time asc / page asc / anchorless last. Quote anchors relocate to the first occurrence (see candidates).
- **Evidence / EvidenceSync**: never shipped in the UI; reserved for a future multi-track pipeline (may be overkill).
- **DocumentTemplate**: plain-text/Markdown body with `{{merge.fields}}`; `isActive` soft-archive keeps generation history. Generation is ungated; saving output goes through `documents.upload`.

**Time / billing**
- **TimeEntry**: EXACTLY ONE of matterId/leadId (see scope pattern); `invoiceId` links to billing.
- **TimerSession**: one per user (`userId` unique; starting a new timer replaces the old); elapsed derives from `startedAt`. A timer is a pre-entry (ADR-013): stop feeds the time-entry composer (source=timer) and deletes the row. `matterId` nullable + SetNull; the composer requires a matter before writing the TimeEntry.
- **Expense**: distinct from TimeEntry (real money paid externally). Independent flags `billable` and `clientAdvanced` (false = firm advanced, expects reimbursement; drives the contingency waterfall). `invoiceId` and `receiptDocumentId` SetNull so the expense survives. Free-string `category`. `matterId` required.
- **Invoice**: `kind` `client` | `internal_record`. Internal records close out WIP on cases that resolve without a fee petition; they are excluded from Outstanding-AR, render with an "Internal Record" letterhead, and follow draft -> paid (= "Recorded") -> void (kind-aware labels/transitions in `src/lib/billing-form.ts`). Client flow: draft -> approved -> sent -> partial -> paid (void only when paidAmount = 0); every payment goes through `recordInvoicePayment` (writes an `InvoicePayment`, chooses paid vs partial). Legacy `sent` rows with paidAmount > 0 display "Sent · partial" via a UI drift chip and refuse void; their next payment flips them to `partial`. Links time entries (`lineItems`) and expenses (`expenseLineItems`); flat-fee/adjustment/tax lines still absent. Line items are draft-only (ADR-024).
- **InvoicePayment**: every channel (trust, check, ACH, cash, card, other) lands here; `source` is a free string. Trust payments double-write: `TrustTransaction` stays the trust ledger's source of truth and `InvoicePayment.trustTxnId` (unique, SetNull) links them. The matter Billing "Received payments" card is the matter-scoped slice of the future firm ledger (see Open).
- **TrustTransaction**: `invoiceId` FK (SetNull, so deleting an invoice doesn't lose the disbursement record); "Pay from trust" is an atomic three-leg op (ledger row + trust balance decrement + invoice paidAmount increment). Real IOLTA compliance may need more fields.
- **Settlement**: one per matter (`matterId` unique, ADR-036). `clientNet` is derived on read (`src/lib/settlement-waterfall.ts`, signed, never clamped) and never written; column remains with default 0 (drop candidate). `firmFee` is stored rounded half-up to cents; legacy rows may hold unrounded fees, reads recompute. Status follows the approval chain (ADR-030). **SettlementApproval**: 4-step chain.

**Deadlines / tasks / automation**
- **Deadline**: auto-rule vs manual distinction matters. `deadlineRuleId` is provenance (SetNull; ADR-019); `dueDateSetManually` is set when someone hand-edits a rule deadline's date, so a recalculation still lists it when its anchor moves but unticked and flagged and never silently overwritten; cleared when a recalculation moves it back onto its rule; always false for hand-entered deadlines (ADR-040).
- **DeadlineRule**: anchor (incident_date / matter_opened / prompt / rule) + signed `offsetDays` + `offsetUnit` (the unit it was entered in, for display). `anchorRuleId` is RESTRICT so a rule others count from can't vanish (the delete action names the dependents). Generated deadlines/tasks survive deleting their rule/list.
- **TaskList / TaskListItem**: items cascade; `Task.taskListId` provenance (SetNull). **AutoApply**: trigger (`matter_created`) x practice area (null = all) -> exactly one of rule / list (app-enforced; a DB unique can't cover the nullable practice area); dedupe app-enforced; cascades from all three parents.
- **Task**: on a matter, an intake lead, or neither; `recordsRequestId` (SetNull).
- **Automation**: steps as JSON; needs a real step model if an engine is built.

**Communications**
- **EmailAccount**: doubles as the Google account record. OAuth tokens encrypted at rest by a Prisma client extension (`src/lib/email-token-crypto.ts`, ADR-011; same for `MessengerAccount`), so plaintext never hits the DB. Access-token expiry has NO column: it rides inside the encrypted `accessToken` as a `{token, expiresAt}` JSON envelope (`src/lib/google/gmail-client.ts`). `historyId` = incremental-sync cursor (null = full sync pending; reset after Google's 404 expiry); `syncError` = last failure shown on /settings/integrations, cleared on next good sync. `grantedScopes` = Google's ACTUAL grant (written on connect AND reconnect); calendar sync gates on `hasCalendarScope`, and pre-calendar connections show "Reconnect to enable calendar sync". `calendarSyncToken` = events.list cursor (null = full windowed pull; a 410 GONE re-pulls and re-mints). `updatedAt` is the sync-claim heartbeat: the claim (ADR-031) is a compare-and-set on `syncStatus` with a 10-minute stale window judged by `updatedAt`, so any account update refreshes it. `@@unique([userId, emailAddress])`: the OAuth callback upserts on it, so reconnecting refreshes tokens in place.
- **EmailThread / EmailMessage**: uniques (accountId, externalId) and (threadId, externalId) make ingestion idempotent (upsert by external id). Recipients are a JSON string (normalize if we must query by recipient).
- **EmailThread filing**: at most one of `matterId` / `leadId` is set (neither = unfiled inbound only); lead conversion re-homes the thread to the new matter. `leadId` is `SetNull`, but a future lead-delete path must re-home or refuse threads with app-sent mail.
- **EmailMessage.sentFromApp**: written only by `persistSentMessage`; sync never writes it. Marks threads that must stay filed.
- **CalendarEvent**: `visibility` text includes `private` (shown to its creator, ADR-037); `canViewEventDetails` resolver enforces it (ADR-021). **CalendarEventSync**: maps one CRM event to its copy on one account's `primary` calendar; uniques (eventId, accountId) and (accountId, googleEventId) make pull idempotent; `googleUpdatedAt` (Google's `updated`) anchors last-write-wins and the pull engine skips rows whose stamp matches; cascades from both parents (bookkeeping never keeps a parent alive). Engines: pull `src/lib/google/google-calendar-sync.ts`, push `google-calendar-push.ts`, shared contract (echo marker in `extendedProperties.private`) `calendar-shared.ts`.
- **MessengerAccount / Thread / Item**: Quo (OpenPhone) SMS/call/voicemail as SIBLING models to Email*, not a generalized `Communication*` table (FK integrity and clean per-channel fields beat single-table simplicity; the unified inbox joins at read time). Item ingestion is idempotent on unique `providerEventId`; thread is one per (account, external number). `MessengerThread.defaultMatterId` is set only by seed/provider traffic, not manual call logging; a manually logged call carries the filing on `MessengerItem.matterId`, so "Unfiled" means no thread default AND no item-level matter.
- **Notification**: per-recipient rows behind the bell; fan-out is the writer's job (no broadcast rows); string `type` maps to icon/tone in the UI. `emailState` makes the table its own email outbox (new rows `pending`; rows from before email delivery were backfilled `skipped` so history is never mailed). Email preferences live in `NotificationPreference` (no row = instant) and `NotificationMatterMute`.
- **NoteRead / NoteReaction**: composite PKs; read tracking drives default collapse. **Note**: sanitized HTML; EXACTLY ONE of matterId/leadId.
- **SavedSearch**: per-user (cascade from User), `type` is a plain string matched against `SearchHitType` on read (a scope that stops existing degrades to "all types"). No permission key: identity-scoped; running it goes through `globalSearch`'s read-model guards. 50-row cap enforced in `createSavedSearch` (a UX bound, not integrity).

**Records requests** (feature notes in `features/`)
- **RecordsRequestType**: firm-configured; migration seeded four starter types (Medical (HIPAA) 30 calendar days, CORA 3 business days, Police report 3 business days, Employment 30 calendar days; follow-up every 7 days; editable/deletable, not legal advice). **RecordsRequest**: custodian FK Restrict; type, owner, expense and document/task links SetNull; matter/lead Cascade; fee columns `Decimal(14,2)`; dates date-only UTC midnight. **RecordsRequestFollowUp**: Cascade history log.
- **DocumentFolder.systemKind / recordsRequestId** (migration `20261018200000_generated_folders`): `systemKind` is a free string (`records_root`, `records_request`, `records_request_docs`, `records_responsive_docs`, `invoices`; constants in `src/lib/records-requests/folder-kinds.ts`); null = ordinary folder, non-null = protected (no rename/move/delete). `recordsRequestId` (SetNull, indexed) is set on the three request-level kinds. Investigation never gets a kind. The migration backfills legacy folders: only folders holding tagged documents are marked (most tagged documents wins, ties to the earliest request); untagged folders are left alone.

**Batch 4 data fixes worth knowing** (migration `20261017120000_quality_sweep`): `UNIQUE settlements(matterId)` was added behind a guard that aborts the deploy, deleting nothing, if any matter had 2+ settlements; `billing.view` was granted to every role holding any `billing.*` or `trust.*` key (ADR-038).

---

## Pending migration candidates (NOT applied)

Each ships as a reviewed migration run by the user; ask before pushing any.

| Candidate | Why | Pre-work |
|---|---|---|
| Unique `Document.fileUrl` (nullable) | Makes the Blob completion callback idempotent in the DB (ADR-018) | Check for duplicate URLs |
| `FlaggedMoment.quoteOccurrence Int?` | Quote anchors relocate to the first occurrence today; optionally `updatedById`/`updatedAt` for flag edits | None |
| `Document @@index([matterId, folderId, name])` | Large folders | Only if a big production folder appears |
| Drop `PracticeArea.statutePeriodDays` | Deprecated by ADR-035; nothing reads or writes it | One release after areas are verified |
| Replace `Lead.statuteWindow` with an absolute SOL date | Snapshot is days-remaining as of `createdAt` | Product decision |
| Drop `Matter.wipAmount`, `Settlement.clientNet` | Dead columns | Confirm no consumer |
| `CalendarEvent.origin`, `EmailAccount.backfillBefore` | Google-born cleanup and explicit backfill anchor (ADR-023, ADR-031) | Deferred |
| Dedicated ActivityLog type for expense rows | Replaces the `Expense ` title-prefix convention (ADR-021) | Backfill |
| `TimeEntry.hours` Float -> `Decimal(6,2)` | Validated to 2 dp but stored as double | Wide code change; no correctness gain today |

### Stale schema comments (comment-only edit for the schema owner)

- `User.createdCalendarEvents` and the `CalendarEvent` header say visibility is permissive/unbuilt; the resolver and per-event `visibility` exist and are enforced (ADR-021).
- `User.dashboardPrefs`: shape is `{ visible, order }`.
- `Lead.statuteWindow`, `Matter.wipAmount`, `Settlement.clientNet`: should state the semantics above.
- `Matter.statuteOfLimitationsDate` / `incidentDate`: "the user can always override" is wrong; describe the inferred auto-vs-manual rule (ADR-027).
- `MessengerThread.defaultMatterId` and `MessengerItem.matterId` ("Falls back to thread.defaultMatterId"): manual call logging no longer sets the thread default.
- `Firm.contacts`: mention which create paths stamp `Contact.firmId`.

---

## Rejected / Evaluated Changes

- **`Matter.slug`** — rejected for prettier URLs: names collide and auto-suffixing (`alvarez-2`) is fragile. Stick with cuid (ADR-006). A short_id (6-char nanoid) could be added later without changing the primary key.

---

## Open Questions / Evolution Points

- **Contact type polymorphism:** if client contacts need very different fields from opposing counsel, split models or use a discriminated union.
- **Email integration:** may need `labelIds[]`, `internalDate`, etc. to align with Google's API shapes.
- **Invoice line items:** flat fees, adjustments and tax need a proper `InvoiceLineItem` model.
- **Multi-tenancy:** if ever needed, every model needs `firmId` and every query scopes by it. YAGNI now.
- **Lead-scoped expenses** remain open (see scope pattern).
- **Firm-wide trust + operating ledger (`FirmAccount` + generalized ledger)** — today there is one implicit trust account (per-matter `Matter.trustBalance`, ledger via `TrustTransaction`) and no operating account. Direction: `FirmAccount { id, firmId, type ("trust" | "operating"), name, accountNumber?, routingNumber?, isPrimary }` allowing multiple accounts of each kind, unified in a `LedgerEntry` table (`firmAccountId`, `matterId?`, `invoiceId?`, signed amount) as source of truth for balance + audit. `TrustTransaction` becomes a view of `LedgerEntry where account.type="trust"`; `InvoicePayment` becomes the inbound side producing a `LedgerEntry` on the destination account. The matter Billing "Received payments" card builds the UX now without the schema generalization.
