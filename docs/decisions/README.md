# Architectural Decision Records

One file per decision: `NNN-short-slug.md`. Read the index, open only the
ADRs your change touches.

**When to write one:** a choice a future session could reasonably undo
without knowing why: data-model shape, security/permission model, money
rules, concurrency strategy, a library or pattern picked over an
alternative. Not for feature behaviour (that's `docs/features/`) or
anything the code makes obvious.

**Format:** copy the newest ADR. Header `# ADR-NNN: <decision as a
sentence>`, then `**Date:**`, `**Status:**`, then Context / Decision /
Trade-offs. Keep it under ~60 lines. Add the row below in the same commit.

**Changing one:** the decision is immutable. Reverse it with a new ADR that
supersedes it, and update the old one's Status line. Addenda that keep an
ADR true to the code are appended in place and dated.

| ADR | Decision | Note |
|---|---|---|
| [001](001-sqlite-for-development-postgresql-for-production.md) | SQLite for development, PostgreSQL for production |  |
| [002](002-app-router-route-groups-for-layout-isolation.md) | App Router route groups for layout isolation |  |
| [003](003-design-tokens-as-css-custom-properties-not.md) | Design tokens as CSS custom properties, not Tailwind config |  |
| [004](004-fraunces-for-display-only-inter-for-all.md) | Fraunces for display only, Inter for all UI chrome | Refined by ADR-057 |
| [005](005-schema-is-iterative-not-upfront.md) | Schema is iterative, not upfront |  |
| [006](006-matter-urls-use-cuid-not-slug.md) | Matter URLs use cuid, not slug |  |
| [007](007-url-query-params-as-single-source-of.md) | URL query params as single source of truth for list filters |  |
| [008](008-prisma-7-sqlite-driver-adapter.md) | Prisma 7 SQLite driver adapter |  |
| [009](009-sortable-column-headers-use-asc-desc-clear.md) | Sortable column headers use asc → desc → clear cycle |  |
| [010](010-per-user-matter-pins-usermatterpin-join-table.md) | Per-user matter pins (UserMatterPin join table, not Matter.isPinned) | Supersedes the initial `matter.ispinned` boolean |
| [011](011-oauth-tokens-encrypt-at-rest-via-a.md) | OAuth tokens encrypt at rest via a Prisma query extension |  |
| [012](012-date-only-values-are-utc-midnight-calendar.md) | Date-only values are UTC-midnight calendar dates; instants display in the user's profile zone |  |
| [013](013-timer-sessions-are-pre-entries-ungated-to.md) | Timer sessions are pre-entries — ungated to run, gated to log |  |
| [014](014-global-search-is-ilike-v1-inheriting-each.md) | Global search is ILIKE v1, inheriting each entity's read model — Postgres FTS is the upgrade path |  |
| [015](015-driver-based-document-storage-local-disk-in.md) | Driver-based document storage — local disk in dev, Vercel Blob (client-direct + 302 serving) in prod | Public-access parts superseded by ADR-018 |
| [016](016-postgres-migration-baseline-prisma-migrate-replaces-db.md) | Postgres migration baseline — `prisma migrate` replaces `db push` for schema changes |  |
| [017](017-password-fingerprint-in-the-jwt-revoke-sessions.md) | Password fingerprint in the JWT — revoke sessions on password change without a Session table | Superseded by 053 |
| [018](018-private-blob-store-presigned-urls-for-documents.md) | Private Blob store + presigned URLs for documents | Public-access parts superseded by ADR-018 |
| [019](019-deadline-rules-task-lists-as-firm-libraries.md) | Deadline rules + task lists as firm libraries, applied on demand or by AutoApply defaults |  |
| [020](020-sign-in-lockout-is-a-reserve-settle.md) | Sign-in lockout is a reserve/settle under a per-email advisory lock; per-account (not per-IP) lock is an accepted DoS risk | Superseded by 053 |
| [021](021-matter-tabs-honour-calendar-visibility-and-money.md) | Matter tabs honour calendar visibility and money-view permissions |  |
| [022](022-security-header-baseline-no-csp-yet-and.md) | Security-header baseline, no CSP yet, and "no class on user HTML" |  |
| [023](023-google-sync-skips-only-deterministic-failures-catch.md) | Google sync skips only deterministic failures; catch-up never advances past an open gap; Google cancel is unlink-only |  |
| [024](024-invoice-line-items-are-draft-only-money.md) | Invoice line items are draft-only; money is rounded per line (HALF_UP, cents) |  |
| [025](025-captures-do-not-inherit-the-primary-s.md) | Captures do not inherit the primary's permission gate - every record kind clears its own create key |  |
| [026](026-conflict-matcher-scope-own-contact-exclusion-inactive.md) | Conflict matcher scope — own-contact exclusion, inactive parties stay hard |  |
| [027](027-the-matter-owns-the-statute-of-limitations.md) | The Matter owns the statute of limitations; the SOL Deadline row is a mirror |  |
| [028](028-layouts-are-not-auth-gates-every-page.md) | Layouts are not auth gates; every page authenticates itself |  |
| [029](029-matter-visibility-today-is-firm-wide-matter.md) | Matter visibility today is firm-wide; matter-team access is planned, not built | Superseded by ADR-039 |
| [030](030-settlement-status-follows-the-approval-chain-amounts.md) | Settlement status follows the approval chain; amounts and steps serialize under a per-matter lock |  |
| [031](031-google-sync-coordination-claim-cas-deterministic-event.md) | Google sync coordination — claim CAS, deterministic event ids, frontier skip | Complements adr-023 |
| [032](032-database-pool-sizing.md) | Database pool sizing |  |
| [033](033-error-boundaries-use-retry-the-notification-bell.md) | Error boundaries use retry(); the notification bell reads over GET |  |
| [034](034-document-bytes-never-travel-through-server-actions.md) | Document bytes never travel through server actions |  |
| [035](035-statute-periods-are-calendar-amount-unit-computed.md) | Statute periods are calendar amount + unit, computed with calendar arithmetic | Supersedes the 365/30 convention in adr-027 and adr-019 |
| [036](036-money-is-decimal-14-2-one-settlement.md) | Money is DECIMAL(14,2); one settlement per matter; hot-path indexes | Completes adr-024 |
| [037](037-private-calendar-events-show-to-their-creator.md) | Private calendar events show to their creator only | Completes adr-021's calendar model |
| [038](038-billing-view-gates-the-billing-read-surface.md) | `billing.view` gates the billing read surface |  |
| [039](039-matter-team-access-ethical-walls.md) | Matter-team access (ethical walls) | Amended by ADR-049 (restricted matters) |
| [040](040-dependent-deadlines-are-recalculated-only-after-explicit.md) | Dependent deadlines are recalculated only after explicit confirmation |  |
| [041](041-pdfs-render-in-the-page-with-pdf.md) | PDFs render in the page with pdf.js; PDF flags anchor to page + quote |  |
| [042](042-excel-and-email-convert-on-the-server.md) | Excel and email convert on the server; TIFF and HEIC decode in the browser |  |
| [043](043-email-attachments-become-documents-copy-to-makes.md) | Email attachments become documents; "Copy to…" makes independent copies without re-uploading |  |
| [044](044-intake-notes-share-the-note-table-scoped.md) | Intake notes share the Note table, scoped to a lead until conversion |  |
| [045](045-intake-tasks-and-events-reuse-task-and.md) | Intake tasks and events reuse Task and CalendarEvent, scoped to a lead until conversion |  |
| [046](046-intake-documents-share-document-and-documentfolder-scoped.md) | Intake documents share Document and DocumentFolder, scoped to a lead until conversion |  |
| [047](047-records-requests-are-a-dedicated-model-with.md) | Records requests are a dedicated model with a rolling follow-up task |  |
| [048](048-generated-folders-carry-their-source-and-are-protected.md) | Generated folders carry their source and are protected |  |
| [049](049-restricted-intake-is-an-opt-in-wall-carried-to-the-matter.md) | Restricted intake is an opt-in wall with a lead team, carried to the matter |  |
| [050](050-lead-conversion-re-runs-the-conflict-check.md) | Lead conversion re-runs the conflict check and refuses a live conflict |  |
| [051](051-client-portal-identity-is-separate-from-staff-auth.md) | Client portal identity is separate from staff auth (magic link, database sessions, host-only cookie) |  |
| [052](052-portal-uploads-are-matter-documents.md) | Portal uploads are ordinary matter documents; three-state file share with folder inheritance |  |
| [053](053-clerk-proves-identity-the-user-table-grants-access.md) | Clerk proves staff identity; the User table grants access (DB-authoritative, one-time email link) |  |
| [054](054-new-matter-screens-both-directions-and-overrides-on-the-matter.md) | Matter writes are conflict-checked in both directions; the override is recorded on the matter |  |
| [055](055-venues-are-a-firm-list-required-fields-are-per-area.md) | Venues are a firm list; required matter fields are per practice area (enforced on create, can't-clear-but-don't-block on edit) |  |
| [057](057-ui-system-v2-legibility-floor-and-colour-on-meaning.md) | UI system v2: an 11px legibility floor, contrast-safe greys, colour spent only on meaning |  |
