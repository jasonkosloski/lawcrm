# Schema & Data Model Notes

This file tracks decisions, trade-offs, and evolution of the Prisma schema as we build features. The schema is a living document — we'll refactor models as real requirements emerge during implementation.

---

## Current State (2026-04-24)

Initial schema with 25 models covering the full domain from the design handoff. This is a starting point, not final.

### Models

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
| FlaggedMoment | Draft | Evidence-specific — only needed for video/audio evidence review |
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

---

## Rejected / Evaluated Changes

Keep a record of schema changes we considered and explicitly passed on, so we don't keep re-litigating them.

- **`Matter.slug` unique field** — Evaluated for prettier URLs (`/matters/alvarez`). Rejected: names collide, auto-suffixing (`alvarez-2`) is fragile. Stick with cuid (ADR-006). Could add a short_id (6-char nanoid) later if URL length becomes a real pain point — would not require changing the primary key.

---

## Open Questions

Schema decisions deferred until the feature that forces them lands.

- **Email vs. Communication model shape** — The /communication page will unify email + SMS (+ voicemail later). Current schema has `EmailAccount`, `EmailThread`, `EmailMessage`, `EmailLabel`, `EmailAttachment`. Two plausible paths when SMS lands: (a) add sibling `SmsThread` / `SmsMessage` models (FK integrity, clean per-channel querying, but more join work for unified inbox); (b) generalize to `Communication*` with a channel enum + channel-specific sub-fields (single-table simplicity, but JSON-ish shape for channel-specific metadata). Pick once we have real SMS requirements — likely when we integrate Twilio.

- **`TimeEntry.leadId`** — Intake work (evaluation calls, conflict checks, initial meetings) is valuable time-tracking data but `TimeEntry.matterId` is currently non-nullable. Add a nullable `leadId` so time can attach to a Lead before a Matter exists, plus a carry-forward step on lead conversion that re-homes those entries under the new matter. Drives the intake Time & Expenses tab from placeholder to real list.

- **`Expense` model** — No expense tracking today. Matter-level expenses (filing fees, expert costs, travel, deposition transcripts) need their own table: `Expense { id, matterId, leadId?, date, description, category, amount, billable, clientAdvanced, receiptUrl?, invoiceId? }`. Drives the Expenses section on the Time & Expenses tab for both matters and leads. For contingent matters, track client-advanced vs firm-absorbed separately so settlement distribution can repay the firm from the gross.
