# Schema & Data Model Notes

This file tracks decisions, trade-offs, and evolution of the Prisma schema as we build features. The schema is a living document — we'll refactor models as real requirements emerge during implementation.

---

## Model Inventory

50 models as of 2026-07-07: the initial 2026-04-24 snapshot plus everything added since (second table). When you add a model, add a row to the second table AND a changelog entry.

### Initial snapshot (2026-04-24)

| Model | Status | Notes |
|---|---|---|
| User | Draft | Minimal — needs auth fields when we add login |
| Matter | Draft | Core entity, most relationships stem from here |
| MatterTeamMember | Draft | Join table for users → matters with role |
| Contact | Draft | Polymorphic type field — may split later if types diverge significantly |
| MatterContact | Draft | Join table with role per matter |
| Lead | Draft | Separate from Contact — converts to Matter + Contact on intake |
| Document | Draft | Generic file reference — may need versioning later |
| Evidence | Draft | Specialized for civil rights multimedia — may be overkill for simple cases |
| FlaggedMoment | Active | Review flags on any viewable Document — time / page / quote / anchorless anchors (see 2026-07-07 changelog rows) |
| EvidenceSync | Draft | Multi-track sync links — very specialized, may defer |
| Deadline | Draft | Auto-rule vs manual distinction is important for this firm |
| CalendarEvent | Draft | Basic — needs Google Calendar sync fields later |
| CalendarAttendee | Draft | Simple for now — may need response tracking |
| TimeEntry | Draft | Core billing unit — UTBMS codes may need their own reference table |
| Invoice | Draft | Needs line items beyond just time entries (expenses, flat fees) |
| TrustTransaction | Draft | Simple ledger — real IOLTA compliance may need more fields |
| Settlement | Draft | Specialized for contingency fee cases |
| SettlementLien | Draft | Negotiation workflow fields |
| SettlementApproval | Draft | 4-step approval chain |
| EmailAccount | Draft | OAuth tokens should be encrypted — placeholder for now |
| EmailThread | Draft | Gmail thread model — will need adjustment when we integrate |
| EmailMessage | Draft | Recipients stored as JSON string — consider normalizing if we need to query by recipient |
| EmailAttachment | Draft | Basic file reference |
| EmailLabel | Draft | Thread-level labels |
| Task | Draft | Simple to-do — may need subtasks, comments, or checklist items |
| Note | Draft | Rich text — storage format (HTML vs Markdown) TBD |
| ActivityLog | Draft | Append-only audit trail |
| Automation | Draft | Steps stored as JSON — will need proper step model if we build an automation engine |

### Added since the initial snapshot

| Model | Added | Notes |
|---|---|---|
| UserMatterPin | 2026-04-24 | Per-user matter pins (replaced `Matter.isPinned`) — see ADR-010 |
| PracticeArea | 2026-04-24 | Firm-configurable practice areas: color/order, SOL config (`statutePeriodDays`), `defaultBillingMode` |
| MatterStage | 2026-04-24 | Per-practice-area lifecycle stages (name, order, `isTerminal`); unique on (practiceAreaId, name) |
| ContactPhone | 2026-04-24 | Multi-phone per contact with free-text label, `isPrimary`, and ordering |
| NoteRead | 2026-04-24 | Per-user read tracking on notes — drives default collapse state; composite PK (userId, noteId) |
| NoteReaction | 2026-04-24 | Emoji reactions on notes; composite PK (userId, noteId, emoji) |
| MessengerAccount | 2026-04-24 | Quo (OpenPhone) line — provider ids, E.164 number, OAuth tokens (encrypted at rest since 2026-06-10) |
| MessengerThread | 2026-04-24 | One per (account, external number); resolved `contactId`, `defaultMatterId` routing, denormalized unread/lastItemAt |
| MessengerItem | 2026-04-24 | SMS / call / voicemail item; idempotent on `providerEventId`; per-item `matterId` filing override |
| Account | 2026-04-25 | Auth.js OAuth account table — empty until Google OAuth lands (see AUTH_PLAN.md) |
| VerificationToken | 2026-04-25 | Auth.js token table — reserved for password-reset / email-verify flows |
| Firm | 2026-04-25 | Firm profile; single-tenant today, `firmId` is the future multi-tenant scoping handle |
| Role / UserRole | 2026-04-25 | First-class roles; Admin/default seeded as locked system roles |
| InvoicePayment | 2026-04-25 | Per-invoice payment record across all channels; trust payments double-write to TrustTransaction |
| Expense | 2026-04-27 | Out-of-pocket costs, distinct from TimeEntry; `billable` + `clientAdvanced` flags |
| RolePermission | 2026-04-27 | (roleId, permission key) grants; key catalog lives in `src/lib/permissions.ts` |
| Notification | 2026-04-27 | Per-recipient notification rows behind the bell; typed (`task_assigned`, `deadline_approaching`, …), `readAt` tracking |
| TimerSession | 2026-07-07 | One running timer per user (`userId` unique); elapsed computed from `startedAt`; stop converts to a `TimeEntry` (source=timer) and deletes the row |
| DocumentTemplate | 2026-07-07 | Firm template library (demand letters, retainers, …); plain-text/Markdown body with `{{merge.fields}}`, catalog + engine in `src/lib/template-merge.ts` |
| SavedSearch | 2026-07-07 | Per-user saved searches on /search — `name` + `q` + optional `type` scope (a `SearchHitType` string, null = all types); cascade on user delete; ~50-row cap enforced in the create action |
| DocumentFolder | 2026-07-07 | Per-matter folder tree for the document file system; `parentId` self-relation (null = matter root), sibling-name uniqueness + 8-level depth cap app-enforced; delete re-parents contents (see changelog) |

---

## Design Principles

1. **Start simple, refactor when we hit a wall.** Don't build a model for a hypothetical need.
2. **Prisma migrations are cheap.** Adding a field or a table is a one-line migration. Don't fear schema changes.
3. **JSON columns are fine for semi-structured data** (email recipients, automation steps) but should be normalized if we ever need to query/filter on them.
4. **Soft deletes vs hard deletes:** Currently no soft delete pattern. If legal compliance requires audit trails, we'll add `deletedAt` fields per model.
5. **Timestamps:** All models have `createdAt`. Most have `updatedAt`. ActivityLog is append-only (no `updatedAt`).

---

## Known Evolution Points

These are places where the schema will likely change as we build:

- **Contact type polymorphism:** The `type` string field on Contact works for now but if client contacts need very different fields from opposing counsel contacts, we may split into separate models or use a discriminated union pattern.
- **Email integration:** When we wire up Gmail OAuth, the EmailThread/EmailMessage models will need to align with Google's API response shapes. May need `historyId`, `labelIds[]`, `internalDate`, etc.
- **Invoice line items:** Currently invoices only link to time entries. Real invoices need expense line items, flat fee items, adjustments, and tax calculations. This will need a proper `InvoiceLineItem` model.
- **Multi-tenancy:** Currently single-firm. If this ever needs to support multiple firms, every model needs a `firmId` field. Not doing this now — YAGNI.
- **File storage:** Documents and evidence reference `fileUrl` but we haven't decided on storage (S3, local, Vercel Blob, etc.). The URL field is storage-agnostic by design.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-24 | Initial 25-model schema | Project scaffold — covers full domain from design handoff |
| 2026-04-24 | Considered + rejected `Matter.slug` field | Matter names aren't unique (two "Alvarez" cases can coexist). Use `id` (cuid) in URLs instead. See ADR-006. |
| 2026-04-24 | Removed `Matter.isPinned`, added `UserMatterPin` join table | Pinning should be per-user, not global — an attorney's pins shouldn't appear in everyone's sidebar. See ADR-010. |
| 2026-04-25 | Added `MatterContact.representationContactId` FK + `representationContact` relation (with reverse `Contact.representationOf`) | Representing attorneys are now first-class Contacts so cross-matter repeat counsel coalesces into one record (and the rep cell can deep-link to `/contacts/[id]`). Legacy free-text representation* columns retained as a fallback for un-backfilled rows. |
| 2026-04-25 | Added `Lead.contactId` FK + `Lead.contact` relation (with reverse `Contact.leads`) | Every intake/lead is now attached to a first-class Contact — same shape as `Matter.clientId` — so a person who contacts the firm twice (or whose lead converts to a matter) surfaces as one record across the system. Conversion reuses `Lead.contactId` instead of creating a fresh contact each time. Legacy `Lead.name`/`.email`/`.phone` columns kept as a fallback for un-backfilled rows. |
| 2026-04-25 | Added `User.passwordHash`/`emailVerified`/`image`, `Account` table, `VerificationToken` table | Auth.js v5 phase 1 — email + password sign-in with the Credentials provider, JWT sessions. `Account` and `VerificationToken` are empty today but get created upfront so adding Google OAuth or password-reset flows later is config-only (no migration). See `docs/AUTH_PLAN.md`. |
| 2026-04-25 | Added `Firm` model + `User.firmId` FK + `User.isAdmin` boolean | First-class firm profile with name / contact / address / EIN / website / established date. Single-tenant today (one Firm row, every User belongs to it). `User.isAdmin` is orthogonal to `User.role` (display title) — admins can edit the firm profile and will manage Team. Multi-tenant later: scope every query by `firmId` and put it on the JWT in the session callback; the `firmId` column is the canonical scoping handle. |
| 2026-04-25 | Added `Role` + `UserRole` (many-to-many) · renamed `User.role` → `User.jobTitle` · dropped `User.isAdmin` | First-class role system: every firm seeds with `Admin` + `default` system roles (locked from rename/delete). Membership in `Admin` is what grants admin powers — `User.isAdmin` is gone, `requireAdmin()` checks role membership. The old `User.role` display string was renamed to `User.jobTitle` so the two concepts don't collide in code or UI. Custom roles are named buckets ready for granular permissions when those land. |
| 2026-04-25 | Migrated all financial `Float` fields to `Decimal` | `Matter.trustBalance/wipAmount`, `TimeEntry.rate/amount`, `Invoice.subtotal/taxAmount/totalAmount/paidAmount`, `TrustTransaction.amount`, `Settlement.grossAmount/firmFee/firmFeePercent/advancedCosts/clientNet`, `SettlementLien.originalAmount/negotiatedAmount` are all Decimal now. Float introduces $0.01 drift on real money — IOLTA regulators won't accept that. Query layer converts Decimal → number at the API boundary so consumers stay primitive-typed; the canonical money lives in the DB. `TimeEntry.hours` and `EvidenceSync.timeOffset` stay Float (not money). |
| 2026-04-25 | Added `Matter.billingMode` + `PracticeArea.defaultBillingMode` (both `String @default("client")`) | First step toward per-practice-area billing flows: traditional client invoicing today; court-appointed voucher submissions, fee-petition court exhibits, and "no billing" deferred. Schema only — every value still routes through the traditional UX with a "flow not implemented yet" banner for non-`client` modes. Practice area sets the default; matter overrides per-case. The matter-create + lead-conversion paths both snapshot the area's default onto the new `Matter.billingMode`. |
| 2026-04-25 | Added `Invoice.kind` (`"client"` \| `"internal_record"`) | Differentiates real client invoices from internal record-of-work bundles used to close out WIP on contingency / pro-bono cases that resolve without a fee petition (settled, abandoned, fee already collected via a separate channel). Internal records are excluded from Outstanding-AR aggregates, render with a flipped letterhead ("Internal Record" / "For matter file"), and follow a smaller state machine (draft → paid (= "Recorded") → void). The kind-aware status label + transition helpers live in `src/lib/billing-form.ts` (`invoiceStatusLabel`, `invoiceStatusTransitions`). |
| 2026-04-25 | Added `TrustTransaction.invoiceId` FK + `Invoice.trustPayments` reverse relation | Lets the "Pay from trust" flow record an atomic three-leg op (ledger row + trust balance decrement + invoice paidAmount increment) and surface the cross-link in both directions: trust ledger rows show "Payment to invoice X" as a deep-link, and the invoice preview can later list "paid via trust on date Y". SetNull on the FK so deleting an invoice doesn't lose the trust record — the disbursement actually happened, regardless of whether the doc lives on. |
| 2026-04-25 | Added `InvoicePayment` model (+ `Invoice.payments` and `TrustTransaction.invoicePayment` relations) | First-class per-invoice payment record. Every channel — trust, check, ACH, cash, card, other — lands here, so the invoice preview reads from one source. Trust payments double-write: `TrustTransaction` is still the trust ledger's source of truth, and `InvoicePayment.trustTxnId` (unique FK, SetNull) links them. Source kept as a free string so adding new channels (Stripe webhook, lockbox import) is config-only, not a migration. **Long-term direction:** this becomes the inbound side of a firm-wide operating-account ledger; pairing it with a future `FirmAccount` model (multiple trust + operating accounts per firm) lets every payment row know which account it landed in. The matter Billing tab's "Received payments" card is the matter-scoped slice of that future ledger. |
| 2026-04-27 | Added `Matter.incidentDate` + `PracticeArea.statutePeriodDays` + `statuteSourceCitation` (SOL automation) | Per-area statute period config drives auto-compute of `Matter.statuteOfLimitationsDate` on create/update. Stored as a single `Int` of total days (years × 365 + months × 30 + days) — legal SOL periods are virtually always defined in calendar days under that convention, and the runtime auto-compute becomes one Date arithmetic op. Practice-area edit form round-trips through `unpackStatuteDays` so the y/m/d shape the lawyer typed is preserved. Explicit SOL date on the matter form always wins, so manual override stays the primary control; auto-compute is a "didn't bother to enter the SOL date but did enter incident + the area is configured" convenience. |
| 2026-04-27 | Added `Expense` model + reverse relations on `Matter`, `Invoice`, `Document` | First-class out-of-pocket cost tracking. Distinct from `TimeEntry` (firm labor) — Expense is real money paid externally. Two independent flags: `billable` (passes through to a client invoice) and `clientAdvanced` (client paid up-front; when false the firm advanced and expects reimbursement, drives the contingency settlement waterfall). `invoiceId` SetNull so the expense survives invoice purges; `receiptDocumentId` SetNull so deleting the receipt doesn't lose the expense. Free-string `category` (filing_fee / expert / travel / deposition / medical_record / postage / records / research / other) so adding categories is data, not a migration. Permission catalog gets four new keys: `matters.expense.view` / `.create` / `.edit` / `.delete`. |
| 2026-04-27 | Added `RolePermission` model | First-class join table for "this role grants this permission key." The catalog of permission keys lives in `src/lib/permissions.ts` (app-defined, not data the firm owns) — adding a new permission is a code change, not a migration. Composite PK on (roleId, permission); unknown keys are tolerated on read so removing a permission from the catalog doesn't break existing rows. Admin role intentionally has no rows materialized — runtime check (`hasPermission`) treats Admin as "all granted" by name. The /settings/roles matrix UI drives this table; the runtime checks themselves still go through `requireAdmin()` for now and will swap to `hasPermission(...)` as features mature. |
| 2026-04-27 | Added `MatterTeamMember.removedAt` + `removedBy` (soft-delete) | Removing someone from a matter team needs to preserve historical attribution — "who was on the case when the deposition happened?" only stays answerable if the row sticks around. Soft-delete via `removedAt` + `removedBy`; null = active. The (matterId, userId) unique stays in place: re-adding a former member upserts the row (clears removedAt + sets new role) rather than creating a duplicate. Index on (matterId, removedAt) so the active-roster query stays cheap. UI labels former members "[role] (former)" and dims them; queries that find the lead now scope to `removedAt: null` so a removed lead doesn't confuse attribution. |
| 2026-04-24 | Added `PracticeArea` + `MatterStage` | Practice areas become firm data, not hardcoded strings — configurable at /settings/practice-areas with per-area lifecycle stages. Later grew SOL config (2026-04-27) and `defaultBillingMode` (2026-04-25). *(Backfilled 2026-07-06 — landed undocumented.)* |
| 2026-04-24 | Added `ContactPhone` | Contacts hold multiple phone numbers with labels + a primary — one `Contact.phone` string wasn't enough once intake started capturing mobile + office + fax. *(Backfilled 2026-07-06.)* |
| 2026-04-24 | Added `NoteRead` + `NoteReaction` | Per-user unread tracking (drives whether a note renders expanded) and emoji quick-reactions. Both composite-PK join tables cascading from User/Note. *(Backfilled 2026-07-06.)* |
| 2026-04-24 | Added `MessengerAccount` / `MessengerThread` / `MessengerItem` | SMS + call + voicemail as **sibling models to Email\***, not a generalized `Communication*` table — resolves the open question below in favor of option (a): FK integrity and clean per-channel fields beat single-table simplicity; the unified inbox joins at read time. Provider is Quo (OpenPhone), idempotent webhook ingestion via unique `providerEventId`. *(Backfilled 2026-07-06.)* |
| 2026-04-27 | Added `Expense.leadId` (nullable, placeholder FK) | Part of the Expense model commit. NOTE: a changelog entry previously claimed `TimeEntry.leadId` shipped here — that was wrong (verified 2026-07-07 against schema, generated client, migrations, and the live DB: TimeEntry has no leadId and `matterId` is still required). Lead-scoped time tracking remains an open question below. |
| 2026-04-27 | Added `Notification` | Per-recipient notification rows behind the topbar bell. Fan-out is the writer's job (no broadcast rows); typed via string `type` mapped to icon/tone in the UI. *(Backfilled 2026-07-06.)* |
| 2026-06-10 | OAuth tokens on `EmailAccount` + `MessengerAccount` encrypted at rest | No column changes — a Prisma client extension (`src/lib/email-token-crypto.ts`) transparently encrypts on write / decrypts on read, so plaintext tokens never hit the DB. See ADR-011. |
| 2026-07-07 | Added `TimerSession` | Server-side running timer, one per user (`userId @unique` — starting a new timer replaces the old). Persisted so it survives reloads/devices; elapsed derives from `startedAt` at read time. A timer is a pre-entry: stop feeds the time-entry composer (source="timer") and deletes the row. `matterId` nullable + SetNull — work can start before you know the matter; the composer requires one before writing the TimeEntry. |
| 2026-07-07 | Added `DocumentTemplate` | Firm template library. Body is plain text/Markdown with `{{merge.fields}}`; the field catalog lives in code (`src/lib/template-merge.ts`) so adding fields is a code change, not data. Free-string `category` so new categories are data. `isActive` soft-archive keeps generation history intact. Permission keys: `documents.template.{create,edit,delete}` (generation itself is ungated; saving output goes through `documents.upload`). |
| 2026-07-07 | Added `Contact.mergedIntoId` (+ `ContactMerge` self-relation) | Contact merge support: the losing record is soft-deleted (`isActive=false`) and points at the survivor so old links/audit rows still resolve and the loser's detail page can redirect. SetNull so deleting a survivor doesn't cascade. |
| 2026-07-07 | Added `Firm.dailyHoursGoal` (6.0) + `Firm.monthlyBillableGoal` (200) | The dashboard/time-view goal numbers stop being hardcoded constants in `queries/dashboard.ts` and become firm data, editable on the Firm-info settings form (`firm.edit_info`). Defaults match the old constants so existing behavior is unchanged until edited. |
| 2026-07-07 | Added `SavedSearch` | Per-user saved searches for /search: `name` (display label, defaults to the query text client-side), `q`, and an optional `type` scope stored as a plain string matched against `SearchHitType` on read (a scope that stops existing degrades to "all types" instead of a dead link). Cascade from User — bookmarks die with the account. No permission key: rows are identity-scoped (notifications precedent); a saved search grants nothing, since running it goes through `globalSearch`'s read-model guards. Per-user cap (50) enforced in `createSavedSearch`, not the schema — it's a UX bound, not an integrity constraint. |
| 2026-07-07 | Added `TimeEntry.leadId` (nullable, Cascade) + relaxed `TimeEntry.matterId` to nullable | Lead-scoped intake time — the open question below is now resolved, built exactly along its documented path. App-enforced invariant: EXACTLY ONE of (matterId, leadId) set, never both/neither (assertion helper in `src/lib/time-entry-scope.ts`; every matter-scoped create path already satisfies it structurally by resolving a required matter before writing). Cascade from Lead mirrors the matter side, and is safe because `convertLeadToMatter` re-homes every lead entry onto the new matter (matterId set, leadId cleared, one `updateMany` inside the conversion transaction, activity-logged as "N intake time entries carried forward") BEFORE the lead could ever be deleted. The budgeted null-safety sweep landed with it: `/time` week+day queries and search surface lead entries as "Intake · {lead name}" context linking to `/intake/[id]/time`; matter-scoped queries filtering `where: { matterId }` were untouched. `Expense.matterId` stays required — lead expenses remain impossible (the placeholder `Expense.leadId` is still unwired). |
| 2026-07-07 | Reshaped `FlaggedMoment` for evidence review v2 | Now attaches to a **Document** via nullable `documentId` (Cascade) — flags live on the real uploaded file, not the never-shipped `Evidence` model. `evidenceId` kept nullable for a future ingestion pipeline; EXACTLY ONE of (documentId, evidenceId) is the app-enforced invariant (mirrors `TimeEntry`'s matter/lead scope pattern). Anchor fields are all nullable with AT MOST ONE kind, matched to the document type: `timeSeconds Float` (+ optional `endSeconds` span) for audio/video — the only anchor with UI today (`src/app/actions/flagged-moments.ts` + the viewer's MediaReview wrapper); `pageNumber Int?` (PDF) and `quote String?` (rendered docx/text selection) are schema-ready follow-ups. Plus `description` (1–500, app-enforced), free-string `category` (catalog in `src/lib/constants/flag-category.ts`), `flaggedById` (creator — drives the own-flags ownership bypass). Zero rows existed pre-reshape (the original evidence UI never shipped), so no backfill. `Evidence` + `EvidenceSync` remain untouched for the future multi-track pipeline. |
| 2026-07-07 | Added `DocumentFolder` + `Document.folderId` (nullable, SetNull) | Per-matter folder tree for the document file system (discovery productions arrive as deep folder structures). Nesting via `parentId` self-relation (`FolderTree`, Cascade); null parent = matter root. Two invariants are deliberately APP-enforced (action layer `src/app/actions/document-folders.ts` + pure helpers `src/lib/folder-tree.ts`), not schema: (1) sibling-name uniqueness is case-insensitive and a DB unique on (matterId, parentId, name) wouldn't cover roots — Postgres treats NULL parentIds as distinct; (2) depth caps at 8 levels. Folder delete RE-PARENTS contents (child folders + documents) to the folder's parent in one transaction before the row delete — files never vanish with a folder; re-parented folders that collide on name get a " (2)"-style suffix. `Document.folderId` SetNull is only the backstop for paths that bypass the action. |
| 2026-07-07 | `FlaggedMoment` anchors generalized to every viewable type (no column changes) | The schema-ready `pageNumber` / `quote` anchor kinds — and anchorless whole-document flags — grew their action + UI layer, so `timeSeconds` is no longer the only kind written. App-enforced invariants live in `src/app/actions/flagged-moments.ts`: AT MOST ONE anchor kind per row, kind must fit the document's renderer (`resolveDocumentRenderer`: media→time, pdf→page 1–5000, docx/text/csv→quote 1–500 trimmed, image/doc_legacy/unsupported→anchorless only), and the kind is IMMUTABLE after create — updates move values within a kind, never across (a kind switch is a different fact: delete + re-flag). Kind resolution + labels are pure helpers in `src/lib/flag-anchor.ts`. Read side dropped the `timeSeconds != null` scoping (`src/lib/queries/evidence.ts`) — all kinds surface, ordered time asc / page asc / nulls (anchorless) last. |
| 2026-07-07 | Gmail-sync plumbing on the email models: `EmailAccount.historyId` + `EmailAccount.syncError`, plus uniques `EmailAccount @@unique([userId, emailAddress])`, `EmailThread @@unique([accountId, externalId])`, `EmailMessage @@unique([threadId, externalId])` | Prep for the Gmail integration (phase 1 = the OAuth connect flow, shipped alongside). `historyId` is the incremental-sync cursor (`users.history.list`; null = full sync pending, reset to null after Google's 404 historyId-expired); `syncError` is the last sync failure surfaced on /settings/integrations, cleared on the next good sync. The thread/message uniques make ingestion idempotent (upsert-by-external-id — the `MessengerItem.providerEventId` lesson) and the account unique pins one row per (user, address): the OAuth callback upserts on `userId_emailAddress`, so reconnecting refreshes tokens in place instead of duplicating. NOTE: access-token EXPIRY deliberately did NOT get a column — it rides inside the encrypted `accessToken` value as a `{token, expiresAt}` JSON envelope (`src/lib/google/gmail-client.ts`), invisible at rest under ADR-011. |
| 2026-04-25 | Refactored `Invoice.status` state machine: added `approved` + `partial` | New client-invoice flow is draft → approved → sent → partial → paid (void only when paidAmount=0). Previously the bare "Mark sent" / "Mark paid" buttons skipped any approval gate and silently flipped paidAmount; the new flow forces explicit Approve + Send dialogs and routes every payment through `recordInvoicePayment` (which writes an `InvoicePayment` row and chooses paid vs. partial based on coverage). Internal records keep their simpler draft → paid (= "Recorded") → void machine. Backfill: existing `sent` rows with paidAmount > 0 will display as "Sent · partial" via a UI drift chip and refuse void; the next payment recorded against them flips them to `partial` cleanly. No DB migration required — `status` is a string column. |

---

## Rejected / Evaluated Changes

Keep a record of schema changes we considered and explicitly passed on, so we don't keep re-litigating them.

- **`Matter.slug` unique field** — Evaluated for prettier URLs (`/matters/alvarez`). Rejected: names collide, auto-suffixing (`alvarez-2`) is fragile. Stick with cuid (ADR-006). Could add a short_id (6-char nanoid) later if URL length becomes a real pain point — would not require changing the primary key.

---

## Open Questions

Schema decisions deferred until the feature that forces them lands.

### Resolved

- **Email vs. Communication model shape** — Resolved (2026-04-24): sibling `Messenger*` models, not a generalized `Communication*` table. See changelog entry. Provider ended up Quo/OpenPhone, not Twilio.
- **`Expense` model** — Shipped 2026-04-27; see changelog entry.
- **`TimeEntry.leadId`** — Resolved (2026-07-07), built along the documented path verbatim: nullable `TimeEntry.leadId` + relaxed `matterId`, app-enforced exactly-one-of invariant (`src/lib/time-entry-scope.ts`), conversion roll-forward inside the `convertLeadToMatter` transaction, matter-Time-tab mirror on `/intake/[id]/time`, and the null-safety sweep over the queries that assumed `matterId` non-null (time / search / calendar / matter-detail — lead entries render as "Intake · {lead name}" context). See changelog entry. Lead-scoped *expenses* remain open: `Expense.matterId` is still required and `Expense.leadId` is still an unwired placeholder.

### Open

- **Firm-wide trust + operating ledger (`FirmAccount` + generalized ledger)** — Today the firm has one implicit trust account (per-matter `Matter.trustBalance`, ledger via `TrustTransaction`) and no operating account at all. Long-term direction: a `FirmAccount { id, firmId, type ("trust" | "operating"), name, accountNumber?, routingNumber?, isPrimary }` so a firm can hold multiple accounts of each kind (general trust + per-major-client trust, operating + payroll, etc.). Unifies into a single `LedgerEntry` table with `firmAccountId`, `matterId?`, `invoiceId?`, signed amount, source-of-truth for both balance + audit. `TrustTransaction` becomes a view of `LedgerEntry where account.type="trust"`; `InvoicePayment` becomes the inbound side that produces a corresponding `LedgerEntry` on the destination operating (or trust, for trust transfers) account. The matter Billing tab's "Received payments" card is the matter-scoped slice of that future ledger — building it now buys the UX without forcing the schema generalization yet.
