# Architectural Decision Records

Each decision is numbered and immutable once written. If we reverse a decision, we add a new ADR that supersedes it. (Immutable means the decision itself; addenda that keep an ADR true to the code are appended in place and dated.)

| ADR | Decision |
|---|---|
| 001-011 | Foundations: SQLite-to-Postgres, route groups, design tokens, fonts, schema iteration, matter URLs, URL filters, Prisma adapter, sort cycle, matter pins, token encryption |
| 012 | Date-only values are UTC-midnight calendar dates; instants display in the profile zone |
| 013 | Timer sessions are pre-entries |
| 014 | Global search is ILIKE v1 |
| 015 | Driver-based document storage (public-access parts superseded by 018) |
| 016 | Postgres migration baseline |
| 017 | Password fingerprint in the JWT |
| 018 | Private Blob store + presigned URLs |
| 019 | Deadline rules + task lists as firm libraries |
| 020 | Sign-in lockout (reserve/settle, per-account) |
| 021 | Matter tabs honour calendar visibility and money-view permissions |
| 022 | Security-header baseline, no CSP yet |
| 023 | Google sync failure isolation, catch-up, cancel = unlink |
| 024 | Invoice line items draft-only; money rounding |
| 025 | Captures clear every record kind's own create key |
| 026 | Conflict matcher scope |
| 027 | Matter owns the SOL; Deadline is a mirror |
| 028 | Layouts are not auth gates |
| 029 | Matter visibility before Phase 5: every signed-in user sees every matter (superseded by 039) |
| 030 | Settlement status follows the approval chain |
| 031 | Google sync coordination: claim CAS, deterministic event ids, junk mail |
| 032 | Database pool sizing |
| 033 | Error boundaries use retry(); the bell reads via GET |
| 034 | Document bytes never travel through server actions |
| 039 | Matter-team access (ethical walls) |
| - | Open product decisions (not ADRs) at the end of the file |

---

## ADR-001: SQLite for development, PostgreSQL for production

**Date:** 2026-04-24
**Status:** Accepted

**Context:** We need a database that's zero-config for local development but production-grade when deployed.

**Decision:** Use SQLite via Prisma for local dev. Swap the `datasource` to PostgreSQL when deploying. Prisma abstracts the differences for most queries.

**Trade-offs:**
- (+) No Docker/postgres setup needed to start developing
- (+) DB file is portable, easy to reset (`rm dev.db && prisma migrate dev`)
- (-) Some Prisma features differ between SQLite and Postgres (e.g., `@db.Text`, full-text search, JSON querying)
- (-) Need to test against Postgres before production deployment

**Mitigation:** We'll switch to Postgres before building features that need full-text search or complex JSON queries. SQLite is fine for the CRUD-heavy early phases.

---

## ADR-002: App Router route groups for layout isolation

**Date:** 2026-04-24
**Status:** Accepted

**Context:** All authenticated pages share the same app shell (sidebar + topbar), but we'll eventually have unauthenticated pages (login, public intake forms) that don't.

**Decision:** Use Next.js route groups: `(dashboard)` for authenticated pages inside the app shell, and future `(auth)` or `(public)` groups for pages without the shell.

**Trade-offs:**
- (+) Clean layout separation without URL nesting
- (+) Easy to add auth checks at the layout level later
- (-) Slightly deeper file nesting

---

## ADR-003: Design tokens as CSS custom properties, not Tailwind config

**Date:** 2026-04-24
**Status:** Accepted

**Context:** The design handoff specifies exact hex values for the brand palette, warm neutrals, and semantic colors. We need these accessible in both Tailwind classes and raw CSS.

**Decision:** Define all design tokens as CSS custom properties in `globals.css` and reference them through Tailwind's `@theme inline` directive. This gives us `bg-brand-500`, `text-ink-3`, etc. as utility classes while keeping the source of truth in CSS vars.

**Trade-offs:**
- (+) Single source of truth for colors
- (+) CSS vars work in inline styles, component libs, and Tailwind
- (+) Easy to theme or override per-section (e.g., email reader paper tone)
- (-) Slightly more verbose than pure Tailwind config

---

## ADR-004: Fraunces for display only, Inter for all UI chrome

**Date:** 2026-04-24
**Status:** Accepted

**Context:** The design uses three fonts. Fraunces is a personality font that should be used sparingly.

**Decision:** Fraunces is used exclusively for:
- Page titles (h1 in topbar)
- Email subjects
- Email body paragraphs
- KPI large numbers

Everything else — nav, buttons, labels, table cells, chips, inputs — uses Inter. JetBrains Mono for timestamps, metadata, and monospace elements.

**Rationale:** Over-using Fraunces would dilute the brand feel and make the UI feel like a blog rather than a professional tool.

---

## ADR-005: Schema is iterative, not upfront

**Date:** 2026-04-24
**Status:** Accepted

**Context:** The initial schema covers 25 models from the design handoff, but the design data model is WIP. Real requirements will emerge during implementation.

**Decision:** Treat the Prisma schema as a living document. Build each feature end-to-end and adjust the schema as needed. Don't over-engineer models for features we haven't started building.

**Rationale:** Prisma migrations are incremental and cheap. It's better to evolve the schema with real requirements than to guess upfront and end up with unused fields or wrong relationships.

---

## ADR-006: Matter URLs use cuid, not slug

**Date:** 2026-04-24
**Status:** Accepted

**Context:** Matter detail pages need a stable URL segment. The sidebar prototype used human-readable slugs (`/matters/alvarez`), and slugs were briefly added to the schema during the matters-route scaffold.

**Decision:** Use the matter's `id` (cuid) as the URL segment (e.g. `/matters/cmoclzbrf000mj1rpounyzp71`). Drop the slug idea entirely. Schema stays free of a `slug` column.

**Rationale:** Matter names aren't guaranteed unique — two "Alvarez" cases, or cases named by short last-name plus case type, will collide. Disambiguating slugs with numeric suffixes (`alvarez-2`) is fragile and surprises users. Cuid is ugly but correct and collision-free by construction.

**Trade-offs:**
- (+) No collision risk, no disambiguation code to maintain
- (+) No extra schema field, no migration
- (-) URLs are long and not memorable — share/copy UX suffers slightly
- (-) Hardcoded sidebar pinned-matter links (using slugs) 404; must be made data-driven

**Revisit if:** we add a command palette that makes direct URL typing unnecessary, or if URL length becomes a real UX pain point. Could always add a `short_id` field later (6-char nanoid) without breaking existing cuid URLs.

---

## ADR-007: URL query params as single source of truth for list filters

**Date:** 2026-04-24
**Status:** Accepted

**Context:** The matters list supports deep filter+sort combinations (search, area, stage, lead, fee, trust, deadline, status flags, sort field/direction). This state needs to be shareable, reachable via the back button, and render on the server for a fast first paint.

**Decision:** Encode all filter + sort state in the URL as query params. Server components read them via `searchParams` and run the filtered Prisma query; client toolbar components update the URL via `router.replace(..., { scroll: false })` on change. No client-side filter state, no prop drilling, no context.

**Trade-offs:**
- (+) Every filtered view is a shareable URL
- (+) Back/forward buttons just work
- (+) Server renders the correct filtered result on first paint
- (+) Deep-linking from dashboards/reports/etc. is trivial (build a URL)
- (-) URL can get verbose with many filters selected
- (-) Every filter change is a server round-trip (for ~100s of rows this is fast; for larger datasets we may need server streaming + partial updates)

**Convention:** single-value params use `?key=value`; multi-selects use repeated keys (`?area=§1983&area=Housing/FHA`). Defaults are omitted from the URL to keep it short. See `src/lib/matters-filters.ts` for the canonical parser/serializer.

---

## ADR-008: Prisma 7 SQLite driver adapter

**Date:** 2026-04-24
**Status:** Accepted

**Context:** Prisma 7 removed built-in query engines — every client must be constructed with an explicit driver adapter. The initial scaffold's `new PrismaClient()` (no options) would have crashed on first query at runtime.

**Decision:** Use `@prisma/adapter-better-sqlite3` for local dev. Construct the adapter with the `DATABASE_URL` from env and pass it to the client in both `src/lib/prisma.ts` (singleton used by Next.js) and `prisma/seed.ts` (seed script).

**Rationale:** `better-sqlite3` is synchronous, fast, and what Prisma recommends for dev. For production we'll swap to `@prisma/adapter-pg` with a Postgres connection string (see ADR-001).

**Trade-offs:**
- (+) Matches Prisma 7's required pattern — avoids a runtime crash that's easy to miss in dev
- (+) Adapter pattern makes prod swap mechanical
- (-) Adds two dependencies (`@prisma/adapter-better-sqlite3`, `better-sqlite3`) with native compile step

---

## ADR-009: Sortable column headers use asc → desc → clear cycle

**Date:** 2026-04-24
**Status:** Accepted

**Context:** Matters list column headers are clickable sort toggles. Users expect a consistent interaction model across columns.

**Decision:** Three-state cycle per column:
1. First click — sort ascending (smallest-first / A-Z)
2. Second click — sort descending
3. Third click — clear sort (default ordering applies)

Clicking a different column resets to that column's first-click (ascending).

**Rationale:** Consistent first-click direction is simpler to reason about than per-column defaults (numeric columns defaulting to desc, text to asc, etc.). The user requested this pattern explicitly — asc as "top-down", desc as "bottom-up", then clear.

**Implementation:** `SortableHeader` reads `sort` / `dir` from URL; toggles among `asc`, `desc`, and absent. Absent state falls back to `DEFAULT_SORT` (`created desc`) in the server query. See `src/components/matters/sortable-header.tsx`.

---

## ADR-010: Per-user matter pins (UserMatterPin join table, not Matter.isPinned)

**Date:** 2026-04-24
**Status:** Accepted (supersedes the initial `Matter.isPinned` boolean)

**Context:** The initial schema had a global `Matter.isPinned` boolean — pinning a matter made it appear in everyone's sidebar. That's wrong: different users (attorneys, paralegals, finance, intake) care about different matters, and an attorney's pins shouldn't clutter a paralegal's sidebar.

**Decision:** Pinning is per-user. A new `UserMatterPin` join table (`@@id([userId, matterId])`) stores pins. The global `Matter.isPinned` column has been dropped. A `toggleMatterPin` server action flips the current user's pin for a given matter and `revalidatePath('/', 'layout')` so the sidebar refreshes.

**Trade-offs:**
- (+) Matches real usage patterns — each user curates their own pin list
- (+) Foreshadows the Phase 8 "role-based customizable sidebar" work
- (+) FK integrity via relations to both `User` and `Matter`
- (-) One more query on each matter detail + list render to determine pin state (acceptable; it's an indexed lookup)
- (-) Can't represent "firmwide featured" matters with this model alone — would need a separate flag or list if that use case emerges

**Not generalized to polymorphic pins (yet):** We could have added a generic `UserPin { itemType, itemId }` to cover future "pin a report / lead / saved filter" use cases. Declined for now — we only have one pinnable type, and a polymorphic table loses FK integrity. Revisit when a second pinnable type actually needs to exist.

**Authorization placeholder:** Current user is resolved via `getCurrentUserId()` (`src/lib/current-user.ts`), which today hardcodes Jason. When auth lands, that helper becomes the session resolver and this ADR stays valid — no call-site changes needed.

---

## ADR-011: OAuth tokens encrypt at rest via a Prisma query extension

**Date:** 2026-06-10
**Status:** Accepted

**Context:** Gmail OAuth (the remaining P0) will store live `accessToken` / `refreshToken` values on `EmailAccount`. Plaintext columns mean a leaked backup, a compromised read replica, or an over-scoped DB user hands an attacker working Gmail credentials. FEATURES.md required deciding this **before** OAuth ships. Options considered: an external secrets store (Vault / KMS-wrapped rows), hand-rolled encrypt/decrypt helpers called at each site, or a Prisma client extension.

**Decision:** AES-256-GCM field encryption enforced by a Prisma **query extension** (`src/lib/email-token-encryption.ts`) applied to the singleton in `src/lib/prisma.ts`. Every top-level `prisma.emailAccount` write encrypts both token fields (plain strings and `{ set }` forms); every read decrypts. The key is `EMAIL_TOKEN_KEY` — 32 bytes base64 (`openssl rand -base64 32`), per-environment, never committed. The wire format is versioned (`v1:<iv>:<tag>:<ciphertext>`) so a future key/algorithm rotation can introduce `v2` and re-encrypt lazily. Crypto primitives live in `src/lib/email-token-crypto.ts`.

**Trade-offs:**
- (+) Feature code (the upcoming OAuth flow) can't forget to encrypt — the data layer does it
- (+) No new infrastructure; works the same on Vercel, local dev, and the test container
- (+) Authenticated encryption (GCM) — tampered ciphertext fails loudly instead of decrypting to garbage
- (-) Key management is on us: losing `EMAIL_TOKEN_KEY` orphans stored tokens (mitigation: users just reconnect their accounts; tokens are re-obtainable credentials, not data)
- (-) Token fields are not queryable by value (acceptable — nothing should ever `WHERE accessToken = ...`)
- (-) **Nested writes/reads through other models bypass the hook** (`prisma.user.update({ data: { emailAccounts: { create … } } })` would store plaintext; `include: { emailAccounts: true }` returns ciphertext). Convention: always touch tokens through `prisma.emailAccount.*`. Reads fail safe (ciphertext, not a leak).

**Ripple:** Extending the client changed the `$transaction` callback type, so helper params that used `Prisma.TransactionClient` now use the `Tx` type exported from `src/lib/prisma.ts`.

**Scope addendum (same day):** `MessengerAccount` carried the same time bomb (`accessToken` / `refreshToken` / `webhookSecret` for the Quo phone integration), so the extension covers both models — same key, same wire format, `webhookSecret` included.

---

## ADR-012: Date-only values are UTC-midnight calendar dates; instants display in the user's profile zone

**Date:** 2026-07-07 · **Revised:** 2026-10-16
**Status:** Accepted (revised)

**Context:** The P2 timezone sweep surfaced two recurring bug classes: (1) date-only inputs (`<input type="date">` → `"YYYY-MM-DD"`) fed to `new Date(value)` parse as UTC midnight while local getters read them back, so round-tripping forms drifted dates a day per save; (2) "today" boundaries computed with server-local `startOfToday()` misclassified items for users whose calendar day differs from the server's (always, on a UTC production box).

The original decision stored date-only values at **server-local** midnight and displayed them on the server's day grid. That frame only exists on the server: production runs in UTC, developers' laptops in Denver, and browsers wherever the user is. The 2026-10-16 review found it at the root of a whole class of production bugs — client components read the UTC-midnight values with browser-local getters (edit dialogs prefilled the day before, so every save moved deadlines, tasks, time entries and invoice lines a day earlier), calendar and dashboard views bucketed due dates as instants, "overdue" fired on the due date, and `datetime-local` values were parsed in the server's zone, storing events and calls 6–7 hours off. The suite passed in every zone because tests never separate the server's frame from the browser's.

**Decision:**
- **Date-only values** (Task/Deadline `dueDate`; TimeEntry / Expense / TrustTransaction / InvoicePayment `date`; Firm `establishedAt`; Matter `incidentDate` / `statuteOfLimitationsDate`; all-day event bounds; automation-generated `dueDate`s) are calendar dates, **stored at UTC midnight** and **always read in UTC**. No time zone — the viewer's, the browser's or the server's — is ever applied to them. Helpers in `src/lib/format-date.ts`:
  - write: `parseDateOnly("YYYY-MM-DD")` (null on malformed or impossible dates → field error, never an Invalid Date 500)
  - read: `dateOnlyKey(d)` → `"YYYY-MM-DD"`; display: `formatDateOnly(d, variant)` — identical on server and client; never the zone-less `formatDate`
  - "today"/overdue: `daysUntilDateOnly(d, tz)` against `todayKey(tz)`; never compare a date-only value to `new Date()`
  - queries: `{ dueDate: dateOnlyRange(firstKey, lastKey) }` (half-open UTC midnights)
  - **Client components never convert a date-only value to a `Date` in the browser.** Servers hand dialogs `dateOnlyKey` strings; date inputs are seeded from those keys and "today" from `todayKey(useUserTimeZone())`.
- **Instants** (event start/end, call `occurredAt`, timestamps) are real UTC moments, displayed in the user's **profile** zone: server code passes `getCurrentUserTimeZone()` to `formatDate(d, variant, tz)`; client components get the same zone from `useUserTimeZone()` (provided by the dashboard layout). Client components must NOT use browser-local getters (`getDate`, `getHours`, `toLocaleString` without a zone) for either kind: they server-render on the UTC host, so a browser-zone read disagrees with the server render and hydrates differently. (An earlier wording of this ADR allowed "browser-local after hydration"; that is withdrawn.)
- **Wall-clock input** (`<input type="datetime-local">`): parse on the server with `parseWallClock(value, await getCurrentUserTimeZone())`; prefill with `toWallClockInput(instant, tz)`. Never `new Date(naiveString)`. This covers calendar event forms, event captures from notes, and manual call logging (`parseCallOccurredAt`). Calendar clients take timed schedule values as the profile-zone wall clock and all-day values as date-only keys (`src/lib/event-schedule.ts`; grid math is zone-aware in `src/components/calendar/grid-time.ts`).
- **All-day events** are date-only (`parseDateOnly`, UTC midnight, including all-day events pulled from Google and pushed back with day-key math). Calendar queries match deadlines and all-day events by day keys and timed events by overlap; `eventDayKeys` buckets multi-day events.
- **Follow-ups** (`followUpAt` on email and messenger threads) are stored as day-end values and treated as calendar days: read with `dateOnlyKey` and compared as day keys, not instants. The inbox filter and the dashboard must agree on that rule.
- **Firm** `establishedAt` is date-only (`parseDateOnly` / `dateOnlyKey` / `formatDateOnly`).
- `parseLocalDate`, `parseLocalDateOrDateTime` and `parseLocalEstablishedAt` **have been removed**; no caller remains. Use the helpers above.

**Known unrepaired data:** rows saved before the fix — timed events and call times stored hours off for non-UTC users, all-day events stored at server-local midnight — are not auto-corrected. Call `occurredAt` rows logged before the change are stored shifted for non-UTC users.

**Compatibility:** No data migration. Production rows were written by `parseLocalDate` on a UTC host, i.e. already at UTC midnight. Rows written on a dev laptop sit at Denver midnight (06:00/07:00Z) — still inside the right UTC day, so UTC reads and half-open UTC day ranges place them correctly.

**Testing:** run date work in both zones — `npm test` (developer's zone) and `npm run test:utc` (production's). A client-component test that renders a UTC-midnight value catches browser-local reads when run west of UTC.

**Trade-offs:**
- (+) One frame per kind of value, identical on every machine; parse and display can no longer disagree
- (+) The Matter incident/SOL dates' UTC convention (previously an exception) is now the rule
- (-) Date-only values are still `DateTime` columns; a true `DATE` column would express intent better (revisit with a migration)
- (-) Client components that show instants need the zone threaded through context (`useUserTimeZone`)

---

## ADR-013: Timer sessions are pre-entries — ungated to run, gated to log

**Date:** 2026-07-07
**Status:** Accepted

**Context:** The floating timer widget (P1) needed server actions for start / update / discard / stop. Project convention says every gated capability gets a granular permission key — so the question was which of these are actually "capabilities."

**Decision:**
- A `TimerSession` is **private per-user scratch state**, not a billing record: it stores `startedAt` + optional matter/activity and nothing a client is ever billed for. `startTimer` / `updateTimer` / `discardTimer` therefore carry **no permission key** — gating them would only stop a user from watching their own clock.
- `stopTimer` — the one path that writes a `TimeEntry` (`source: "timer"`) — gates on the existing **`time_entries.create`**, same key as every other entry-creating action (`time-entries.ts`, `captures.ts`, `time-on-entity.ts`, `note-attachments.ts`). Denying that single key still closes ALL time-logging entry points, timer included.
- Stop is transactional: TimeEntry create + TimerSession delete in one `$transaction`, so a crash can't both log the time and leave the clock running (double billing on retry). A stop from a stale dialog (session already discarded/stopped in another tab) errors instead of silently double-logging.
- **Rounding convention:** timer-elapsed prefill rounds **UP** to `TIME_ENTRY_INCREMENT_HOURS = 0.25` (quarter-hour — the increment the schema already documents on `TimeEntry.hours`), minimum one increment. The value is a prefill, editable before save; the server re-validates only the normal 0–24h bounds.
- Elapsed is **never stored** — computed from `startedAt` at read time (widget ticks client-side; no polling).
- `startTimer` never silently replaces a running session: it returns `code: "already_running"` unless called with `replace: true`.

**Addendum (2026-10-17):** the "denying `time_entries.create` closes ALL time-logging entry points" claim is now true for the capture paths too. `captures.ts` and `createNote` compute the keys for every sibling kind with `requiredCapturePermissions` and enforce them with `requirePermissions` before any write (ADR-025). Error vs redirect: the primary composers and the bulk-attach action redirect to `/` on denial (`requirePermissions`, like `requirePermission`); the note surfaces pre-check with `missingPermissions` and return a form error so the typed note is kept, with `requirePermissions` as the enforcing backstop. `deleteNote` lets the author delete their own note, but the delete cascades to replies, so when anyone other than the actor replied (any depth) it needs `notes.delete_any` and returns a form error otherwise.

**Trade-offs:**
- (+) One permission key governs all time-entry creation; no new keys to administer
- (+) Timer state can't leak billing data to under-privileged users (there is none to leak)
- (-) A user without `time_entries.create` can run a timer they can never stop-and-log (only discard) — acceptable: the widget is still honest about elapsed time, and granting the key later converts the running session losslessly

## ADR-014: Global search is ILIKE v1, inheriting each entity's read model — Postgres FTS is the upgrade path

**Date:** 2026-07-07
**Status:** Accepted

**Context:** Global text search (P1) needed a query strategy and an authorization posture. Options: (a) Prisma `contains` / `mode: "insensitive"` (ILIKE), (b) Postgres full-text search (tsvector + GIN), (c) an external engine (Meilisearch/Typesense).

**Decision:**
- **ILIKE v1** — one parallel `Promise.all` batch in `src/lib/queries/search.ts`, per-type `take` + total counts. Zero infrastructure, correct semantics, fine at this firm's data scale. The `SearchHit` shape (type/id/title/snippet/href/context) is engine-agnostic so the FTS swap is invisible to the page.
- **Upgrade path when data outgrows it:** generated `tsvector` columns (or a materialized search view) + GIN indexes, `websearch_to_tsquery` + `ts_rank` ranking, `ts_headline` snippets. Not an external engine — one more moving part to host/sync for a single-firm app.
- **No new permission keys.** Search inherits each entity's existing read model: calendar events run through the same `canViewEventDetails` resolver as the calendar (scrubbed BEFORE snippets are built), merged/inactive contacts are excluded. A search surface must never widen visibility.
- **Email is mailbox-personal.** Threads and messages are visible only to the owner of the `EmailAccount` they were synced into; filing a thread to a matter does not widen that. `src/lib/email-visibility.ts` (`visibleEmailThreadWhere` / `visibleEmailMessageWhere`) is the single email read model for search, the sidebar unread badge and every email-derived action (file to matter, create task or note from an email, log time on an email); use it for any new email query.
- **LIKE metacharacters are escaped** (`escapeLike` in `src/lib/queries/search.ts`: `%`, `_`, `\`), so a query for `50%` or `a_b` matches literally.
- **`SearchHit.href` may be null** (firm-wide tasks with no matter render unlinked); consumers must handle it.
- **Documented approximations:** note and email totals are the SQL count minus the markup-only rows scanned, so they are upper bounds, not "exactly what the viewer can read"; event totals are lower bounds (visible rows inside a 200-row candidate window). The single-connection-era note about serialising the ~21 statements is obsolete since ADR-032.
- **Privileged time narratives (open, see Open decisions):** search hides a `privileged` time entry's narrative from everyone but its author, but the matter and `/time` Time tabs show narratives to every viewer. The claim "search inherits each entity's read model" is therefore inaccurate for this one field until the policy is decided; the stricter behavior is only in search.

**Trade-offs:**
- (+) Shipped with zero infra; authz posture is provably no-wider-than-existing surfaces
- (+) Swap to FTS is contained in one file
- (-) Leading-wildcard ILIKE can't use btree indexes — full scans on big tables (acceptable now, the trigger to revisit)
- (-) No relevance ranking; results are grouped by type, recency-ordered within type

## ADR-015: Driver-based document storage — local disk in dev, Vercel Blob (client-direct + 302 serving) in prod

**Date:** 2026-07-07
**Status:** Accepted — the *public-access* parts (bearer URLs, redirect to the bare blob URL) are superseded by ADR-018 (private store + presigned URLs). Driver selection, key scheme, client-direct uploads and 302 serving still stand.

**Context:** `src/lib/file-storage.ts` wrote to `./uploads/` — ephemeral on Vercel's serverless filesystem, so every uploaded document would vanish between deploys/invocations. Worse, Vercel caps serverless request bodies at ~4.5MB, so the streaming busboy upload route (`/api/documents/upload`) physically cannot receive GB-scale discovery media in production, no matter where it writes.

**Decision:**
- **`file-storage.ts` is now a facade over two drivers** (`src/lib/storage/`): `local` (unchanged semantics — dev default, what the test suite runs) and `vercel-blob` (`@vercel/blob`: `put`/`del`/`head`). Selection: explicit `STORAGE_DRIVER` env wins; otherwise the presence of `BLOB_READ_WRITE_TOKEN` selects `vercel-blob`; a bad `STORAGE_DRIVER` value or a blob driver without a token **throws** — misconfiguration must never silently write prod uploads to an ephemeral disk.
- **Key↔URL mapping:** one key scheme everywhere, `{rand16}__{sanitized-name}` (`src/lib/storage/storage-key.ts`, client-safe/isomorphic). Local: `Document.fileUrl` holds the bare key, bytes at `./uploads/{key}`. Blob: the key is the blob *pathname*; `Document.fileUrl` holds the **full blob URL** (`https://<store>.public.blob.vercel-storage.com/{key}`) — it's what `del`/`head` accept and what serving redirects to. **Writes dispatch on the active driver; reads/deletes dispatch on key shape** (`isBlobKey` = starts with `https://`), so switching drivers never strands rows written under the old one.
- **Prod uploads go client-direct** (`/api/documents/upload/blob`, `handleUpload` from `@vercel/blob/client`): browser asks for a scoped one-time token (`onBeforeGenerateToken` = session + `documents.upload` + matter/folder validation + `allowedContentTypes`/`maximumSizeInBytes` derived from the shared extension map — the same server-derived-MIME rule as the streaming route), PUTs bytes straight to Blob (multipart), then Vercel's signed callback (`onUploadCompleted`) creates the Document row + audit entry from the `tokenPayload` *we* signed. The busboy streaming route **stays**: the completion callback can't reach localhost, so local dev keeps the local driver + streaming route (it 501s under the blob driver). The uploader component picks its transport from a `storageDriver` prop supplied by the server component via `activeStorageDriver()`.
- **Serving under the blob driver is a 302** to the blob URL from `/api/documents/[id]/download` after the same session gate + document lookup + existence probe. Vercel's CDN handles Range/seeking. Disposition forcing: `@vercel/blob` (v2.6.0) does **not** allow a custom Content-Disposition at upload — the CDN serves inline (filename from the pathname) and the only lever is the `?download=1` query param. So the route redirects inline-allowlisted types to the bare URL and everything else to the `?download=1` variant, mirroring the local path's UX.
- **Per-file activity rows on the blob path** (vs one-per-batch on the streaming route): each client upload completes via its own independent callback; there is no server-side batch to group. Likewise blob batches are not all-or-nothing — files completed before a mid-batch failure stay uploaded.

**Trade-offs (the honest part):**
- (-) **Blob URLs are unguessable-but-public bearer URLs.** `access: "public"` means anyone holding the URL can fetch the bytes — the download route gates who is *handed* a URL, but a leaked URL grants access until the file is deleted (re-uploading generates a fresh random key, rotating the URL). We also set `cacheControlMaxAge` to 1 hour (SDK default: 1 month) because deletion does not purge already-cached CDN copies — the post-delete exposure window is bounded by that TTL. Upgrade path if this becomes unacceptable: `@vercel/blob` v2.6+ supports `access: "private"` + presigned GET URLs; the 302 branch would redirect to a short-lived presigned URL instead.
- (+) In exchange, user content is served from **blob.vercel-storage.com — an isolated origin**. Attacker-uploaded HTML/SVG rendered there has no access to our cookies/session, which makes the download route's inline-XSS allowlist moot *for that path*. The allowlist **stays** for the local driver, where bytes stream from OUR origin and inline `text/html` would be stored XSS riding a colleague's session; on the blob path the same set is reused only as a UX signal (inline preview vs forced download).
- (+) GB media uploads/downloads never transit our serverless functions (body caps, execution-time billing, memory).
- (-) `onUploadCompleted` is untestable locally (public-internet callback) and eventually-consistent: a just-uploaded file can miss the first `router.refresh()`; the uploader refreshes a second time ~2s later. Row-creation logic is unit-tested with prisma mocked (argument contract, not DB behavior).
- (-) Server-side `put` (composer form, generated templates) still rides a serverless request, so it stays small-file-only (~4.5MB platform cap) — acceptable: those paths are for typed documents, not media.

## ADR-016: Postgres migration baseline — `prisma migrate` replaces `db push` for schema changes

**Date:** 2026-10-16
**Status:** Accepted

**Context:** `prisma/migrations/` held 30 migrations generated while the app ran on SQLite (`migration_lock.toml` said `provider = "sqlite"`; the SQL used `PRAGMA` / `DATETIME` / table-rebuild idioms). They could never run against Postgres, so after the Postgres switch every database — dev, test, and production — was shaped by `prisma db push`, and nothing recorded the schema changes made after 2026-04-28 (document folders, calendar sync, saved searches, timers, notifications, firm goals, …).

**Decision:**
- The SQLite migrations are retired (still in git history) and replaced by a single Postgres baseline, `prisma/migrations/0_init`, generated with `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`. Verified by applying it to an empty Postgres and diffing back against the schema: no difference.
- From here on, schema changes ship as migrations (`prisma migrate dev --name <change>`), committed with the change and listed in `SCHEMA_NOTES.md`.
- **Existing databases are baselined, not re-created.** For a database that was built by `db push` (including production), first confirm it matches the schema, then mark the baseline as applied:
  1. `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` → must report "No difference detected." (If it doesn't, reconcile with `db push` against that DB first, reviewing the diff.)
  2. `prisma migrate resolve --applied 0_init`
  3. Later migrations then apply with `prisma migrate deploy`.
- The test harness keeps using `db push --accept-data-loss` against the throwaway tmpfs container — speed over history is right there.
- **Drift is enforced.** `npm run check:migrations` (`scripts/check-migrations.mjs`) fails when the migration history does not reproduce `schema.prisma`; the pre-commit hook runs it whenever `prisma/` is staged. A schema edit without its migration cannot be committed.
- **`npm run db:reset` is guarded.** `prisma.config.ts` runs the seed guard (`src/lib/seed-guard.ts`) before `migrate reset`, `db seed` and `--force-reset`: localhost / 127.0.0.1 / ::1 only, `ALLOW_SEED=1` required for the hosted dev database, refused under a production environment. A mistyped `DATABASE_URL` can no longer wipe a hosted database before the seed's own guard runs.

**Trade-offs:**
- (+) Schema history is real again; production changes become reviewable, repeatable SQL instead of whatever `db push` decides on the day
- (+) Fresh environments come up with `prisma migrate deploy` instead of a drift-prone push
- (-) One-time manual baseline step per existing database (above)
- (-) The build does not run `migrate deploy` yet — preview deployments share env vars with production on many setups, and an automatic migration from a preview build is how a prod DB gets changed by an unmerged branch. Wiring it into the deploy pipeline is a separate decision.

## ADR-017: Password fingerprint in the JWT — revoke sessions on password change without a Session table

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Sessions are stateless JWTs (`docs/AUTH_PLAN.md`). With no session row to delete, changing or resetting a password left every existing session — including a stolen one — valid until expiry. Switching to database sessions is the textbook fix but is a schema change plus a session-strategy change, and the credentials provider has caveats with DB sessions.

**Decision:**
- The JWT carries `pwv`, a 16-hex-char SHA-256 digest of the user's argon2 hash (`src/lib/session-fingerprint.ts`). It's stamped at sign-in.
- The `jwt` callback (`validateSessionToken`, `src/lib/session-token.ts`) already reads the user row on every request to reject deleted/deactivated users; it now also compares the fingerprint and strips the session on mismatch. No extra query.
- `changePasswordAction` calls `unstable_update({ pwv: passwordFingerprint(newHash) })` after writing the new hash. The callback runs with `trigger: "update"` and re-stamps the current session **only when the update payload's `pwv` equals the fingerprint freshly computed from the DB row**; otherwise it falls through to the normal mismatch check and the stale token is stripped. The payload check matters because `POST /api/auth/session` also reaches the callback with `trigger: "update"` for anyone holding a cookie plus a CSRF token (both obtainable by a cookie thief): a bare `unstable_update()` that re-stamped unconditionally would let a stolen, already-revoked cookie revive itself. Forging the payload needs the argon2 hash, which never leaves the server, and the `session` callback exposes only `user.id` — the fingerprint is never in the session object sent to the client. Pinned by `src/lib/session-token.test.ts` and `src/auth.test.ts`. An admin reset (`resetFirmMemberPassword`) signs the target out everywhere, as it should.
- Tokens minted before this shipped have no `pwv` and are dropped: one forced re-login per user at deploy.
- `getSession()` (`src/lib/session.ts`, a React-`cache()`d `auth()`) is the single per-request session read, so the `jwt` callback's user lookup runs once per request however many guards call it.

**Trade-offs:**
- (+) Real "sign out everywhere" on password change/reset with zero schema change
- (+) The cookie never contains the hash itself — only a digest of it
- (-) Revocation is all-or-nothing: no "sign out just that one device" — that still needs DB sessions (per-device session list stays deferred)
- (-) Relies on the per-request user lookup in the `jwt` callback; if that query is ever removed for performance, this check goes with it

## ADR-018: Private Blob store + presigned URLs for documents

**Date:** 2026-10-16
**Status:** Accepted (supersedes ADR-015's public-access trade-off)

**Context:** ADR-015 put documents in a *public* Blob store: anyone holding a file's URL could fetch it, with the download route only controlling who was handed the URL. That was a stated trade-off while no real data existed. With the store going live for privileged client files (discovery, medical records, bodycam), a leaked link (forwarded email, browser history, a log line) granting access until deletion isn't acceptable. Vercel Blob's private access is generally available, and the store was still empty — the cheapest moment to switch.

**Decision:**
- One **private** store. Every write (`put`, client-direct `upload`) uses `access: "private"`; the stored key is still the full blob URL (`*.private.blob.vercel-storage.com/{key}`), so key-shape dispatch is unchanged.
- **Serving:** `/api/documents/[id]/download` and `/api/email-attachments/[id]/download` keep their session/scope checks, then 302 to a presigned GET URL from `signedBlobUrl` (`issueSignedToken` scoped to the one pathname, `get` only, then `presignUrl`). Lifetime: 15 minutes, or 6 hours for audio/video — a media element re-uses the redirect target for every Range request while seeking, so a short URL would break playback partway through a long recording. `download=1` (attachment disposition) is appended outside the signed payload. The redirect itself is `no-store`.
- **Server reads:** `readStoredFile` → `readBlobBytes`, an authenticated `get()` with a Range header for capped reads.
- **Rebuilt URL (addendum).** `signedBlobUrl` signs over the *decoded* pathname but returns a URL rebuilt from the stored origin with every path segment encoded, carrying across only the SDK's `vercel-blob-*` params. The SDK concatenates the pathname without encoding, so a `#`, `?` or `%` in a file name truncated or corrupted the URL.
- **Callback idempotency (addendum).** Vercel retries `onUploadCompleted` on non-2xx, so the handler (`src/app/api/documents/upload/blob/blob-upload.ts`) looks the Document up by `fileUrl` before creating it. There is no unique index on `Document.fileUrl` yet (Batch 4 candidate in `SCHEMA_NOTES.md`), so a true race can still double-insert.
- **Media lifetime.** The code's 6-hour media TTL (`SIGNED_MEDIA_URL_TTL_MS`) is the source of truth; any note quoting 12 hours is wrong.
- **Non-ASCII names (2026-10-18).** @vercel/blob 2.8.2 decodes the delegation token with Latin-1 `atob`, so its own scope check rejected any pathname with a non-ASCII character (accents, emoji, the U+202F in macOS screenshot names) and those files couldn't be viewed or downloaded. `presignUrlUtf8` in `src/lib/storage/blob-driver.ts` swaps in a UTF-8 `atob` for the synchronous part of the call only; token scope and signature are unchanged. Remove it once the SDK decodes UTF-8.
- Verified live against a private store before shipping: bare URL → 403; signed → 200; `download=1` → attachment with the signature intact; Range → 206; CORS allows the client-side docx renderer's fetch; a signature replayed against another pathname → 403.

**Trade-offs:**
- (+) A stored URL is no longer a credential; exposure from a leaked link is bounded to one file for minutes (hours for media)
- (+) Fixed server-side docx/text/CSV previews on the blob driver, which had been calling the local-only stream reader
- (-) One extra control-plane call (`issueSignedToken`) per download redirect
- (-) A signed media URL stays valid for up to 6 hours if leaked — scoped to that single file
- (-) Signed URLs can't be revoked early; deleting the file is the kill switch (bounded further by the 1-hour CDN cache TTL)

## ADR-019: Deadline rules + task lists as firm libraries, applied on demand or by AutoApply defaults

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Lead conversion (and the New-matter form) created only the SOL deadline; every other recurring deadline (government-notice periods, response windows, pretrial dates) and every recurring checklist was entered by hand. The roadmap item framed this as per-practice-area conversion logic, but the firm needs the same rules and checklists at other times too — after service, at a stage change, whenever.

**Decision:**
- **Two firm libraries**, decoupled from any trigger: `DeadlineRule` (title, kind, anchor, signed `offsetDays` + the `offsetUnit` it was entered in, citation, notes) and `TaskList` + ordered `TaskListItem`s (priority, assign to lead/unassigned, optional due offset from the apply date). Managed on Settings → Automations under granular `automations.*` keys.
- **Anchors**: `incident_date`, `matter_opened`, `prompt` (asked at apply time), `rule` (another rule's deadline on the same matter). Rule-to-rule links are refused if they'd loop; `anchorRuleId` is ON DELETE RESTRICT, and the delete action explains which rules depend on it.
- **Date math in calendar-day keys** (`src/lib/automations/deadline-plan.ts`, pure): every anchor is a day key — incident dates and deadline dates are UTC-midnight date-only values read with `dateOnlyKey` (ADR-012), "matter opened" is the day in the actor's profile zone — the offset is added in UTC day arithmetic, and the result is written with `parseDateOnly` like every other date-only deadline or task `dueDate`. Due dates are plain calendar days: **no weekend, holiday or court-day adjustment**. Months/years are stored as a signed 365/30 day total (`UNIT_DAYS`, only to keep one integer column) but **applied as calendar months** (`applyOffsetToKey`, ADR-035): "2 years after" is the same calendar date two years on, clamped at month end. The UI shows the amount in the unit it was entered. Offsets are capped at `MAX_OFFSET_DAYS` = 36,500; an overflowing stored offset is reported as unplanned with reason `out_of_range`. (An earlier version of this ADR described server-local midnight dates; that is superseded.)
- **`incident_date` rules resolve only on matters whose practice area tracks a statute of limitations**, because `Matter.incidentDate` is only persisted then. Otherwise a manual apply asks for a date and an automatic apply creates a "Set date: ..." task for the lead.
- **Locking and numbering:** a manual apply takes a per-matter advisory lock (`automation-apply:<matterId>`), and applied task-list items are numbered after the matter's existing tasks.
- **Applying is a separate concern** (`src/lib/automations/apply.ts`, takes a transaction client): manual applies report duplicates (confirm to re-apply) and unresolvable anchors (ask for a date); automatic applies skip duplicates and turn an undatable rule into a "Set date: …" task for the lead — never silently dropped. Generated rows carry provenance (`Deadline.deadlineRuleId`, `Task.taskListId`, both SetNull). Manual apply is gated on the capability exercised (`deadlines.create` / `tasks.create`), not the library keys.
- **Wiring layer**: `AutoApply` rows (`trigger`, nullable `practiceAreaId` = all areas, exactly one of rule/list). The only trigger today is `matter_created`, fired from both creation paths through one `applyAutoDefaults` call inside the creating transaction. New triggers add a value, not a table.
- The pre-existing `Automation` model (JSON steps, never used) is left untouched and unrelated.

**Trade-offs:**
- (+) One library serves conversion, new matters, and any later moment; firms edit rules without a deploy
- (+) Dates can't drift by a day regardless of server/user TZ (pinned by tests in Denver)
- (-) Dates are snapshotted at apply time — moving the trial date doesn't move "30 days before trial" (recalculate-dependents is a follow-up)
- (-) The firm owns the legal periods; the app ships none, so correctness of each rule is a firm configuration responsibility

## ADR-020: Sign-in lockout is a reserve/settle under a per-email advisory lock; per-account (not per-IP) lock is an accepted DoS risk

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The lockout (5 failures / 15 min, counted from `ActivityLog` auth rows) was check-then-act: N parallel guesses could all pass the count before any failure row existed, so the threshold did not bound guessing. Separately, a lock keyed on the account lets anyone who knows an email lock that account on purpose.

**Decision:**
- `reserveAttempt` (`src/lib/credentials-authorize.ts`) opens a short transaction, takes `pg_advisory_xact_lock(hashtext(<key>))` (key = normalised email for sign-in, user id for password change), counts failures including in-flight ones, and inserts the failure row **before** the password is verified. `settleAttempt` deletes the row on success or annotates it with the reason on failure. The lock is released before argon2 runs. A crash mid-verify leaves a counted failure (fail closed).
- `changePasswordAction` reuses the same mechanism (`password_change_failed` rows) so a hijacked session can't brute-force the current password.
- `AUTH_EVENT_TITLES` values are query keys; never rename them.
- Unknown / inactive / passwordless / locked accounts burn one dummy argon2 verify so timing doesn't reveal account existence. Cost: those attempts now cost about a real attempt of CPU and ~64 MiB each — login spam is a resource amplifier, so edge rate limiting matters.
- **Accepted risk (F129):** the lock is per account. Anyone who knows staff emails can hold every account — admins included — locked (5 failures per 15 minutes; the lock lifts on its own, blocked attempts do not extend it, and blocked-attempt audit rows are throttled to one per account per minute). An IP factor is spoofable/shared and no lock exposes the password, so we keep it. Mitigations: `unlockFirmMemberSignIn` and `resetFirmMemberPassword` write a `sign_in_unlocked` event (counts like a successful sign-in; written with a throwing write so a failure is reported, not swallowed); Admin-class targets can only be unlocked/reset by an Admin. **Both need a signed-in directory manager, so a firm with every admin locked has no in-app recovery.** Break-glass: wait out the window, or insert a `sign_in_unlocked` row by SQL (header of `src/lib/credentials-authorize.ts`). Recommended real fix: a per-IP rate-limit rule on the sign-in route at the edge (Vercel Firewall).
- The unlock action exists server-side only; there is no button on the team page yet (follow-up: wire it in `member-row.tsx`).

**Trade-offs:**
- (+) The threshold actually bounds parallel guessing
- (+) No schema change; same audit rows drive the lock and the history
- (-) A deliberate lockout DoS against any known email remains possible until edge rate limiting is configured
- (-) Each login attempt takes a short DB transaction (pool size per ADR-032; the advisory lock is held only for the count + insert, never across argon2)


## ADR-021: Matter tabs honour calendar visibility and money-view permissions

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The calendar scrubs events a viewer may not see to "Busy" (`canViewEventDetails`), but the matter Events tab shipped raw titles, notes, locations and time entries to every user, and the Timeline showed settlement and expense amounts to users lacking `matters.settlement.view` / `matters.expense.view`.

**Decision:**
- **Events tab** (`getMatterEvents`): same resolver as the calendar. Rows the viewer can't see become a Busy shell (id + times only; no title, location, zoom link, attendee count, notes or time entries) built server-side, so nothing reaches the RSC payload.
- **Event labels on other tabs**: "From event" chips on Deadlines/Tasks and the event link on Notes go through `eventLabelForViewer`, which returns "Busy" when the resolver says no.
- **Timeline money rows are omitted, not redacted** (`activityMoneyFilters`, now in `src/lib/activity-money-filters.ts` — one rule shared by the Timeline, the dashboard feed and, since 2026-10-17, Settings → Activity, which previously listed settlement/trust/expense amounts to anyone holding `firm.view_activity`): settlement rows (`type = "settlement"`) need `matters.settlement.view`; expense rows (type `filing`, title prefix from `src/lib/expense-activity.ts`, shared with the writer in `expenses.ts`) need `matters.expense.view`. Omitting is simpler than parsing amounts out of free-text titles, and the type counts on the filter pills are filtered identically. Callers that don't pass the flags fail closed.
- **Timeline page** resolves the session itself (`getCurrentUserId`) before reading any feed data.

**Known gaps (follow-ups):**
- Event-attached content on the Notes and Time tabs (a note or time entry whose parent is a hidden event) is matter-wide: the label is scrubbed, the note body / time narrative is not. Matter-level access, not event visibility, governs those tabs today.
- Trust `deposit` rows ("Trust applied to invoice … $amount") are now omitted without `billing.view` (ADR-038).
- Expense activity rows are identified by the title prefix `Expense ` on type `filing` (`src/lib/expense-activity.ts`, shared with the writer in `expenses.ts`, pinned by `matter-detail.test.ts`). A dedicated ActivityLog type plus a backfill is the cleaner follow-up. The Overview WIP figure is computed live; `Matter.wipAmount` is no longer read.
- Session guards now exist on every page (ADR-028), and the dashboard agenda and recent-activity feed apply the Busy scrub and the same money filters (settlement rows need `matters.settlement.view`, `Expense ` rows `matters.expense.view`, `matterId = null` firm-scope rows `firm.view_activity`). Contact and automation edits log with `matterId = null`, so they no longer appear in the dashboard feed for non-privileged users. The query helpers (`listLeads`, `getMatterParties`, `getMatterFlaggedMoments`, `getMatterActivity`, `getDocumentForViewer`, ...) still carry no auth of their own; the page-level guard is the boundary.

**Trade-offs:**
- (+) One privacy rule across calendar, Events tab and event chips
- (-) A viewer with `matters.settlement.view` revoked sees no trace that a settlement exists on the timeline


## ADR-022: Security-header baseline, no CSP yet, and "no class on user HTML"

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The W6b content-security sweep found (a) no response security headers, (b) sanitizer profiles that let `class` through on inbound email and note HTML while the app ships a global Tailwind stylesheet (a hostile `class="fixed inset-0 z-50 bg-white"` overlays the whole CRM), (c) a prefix check in `src/proxy.ts` that was not path-boundary aware, and (d) docx-preview output whose `<style>` text (built from unescaped document strings) was appended to the live page before sanitation.

**Decision:**
- **Headers** (`next.config.ts`, pinned by `src/next-config.test.ts`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy`. The two same-origin routes the document viewer iframes (`/api/documents/:id/download`, `/api/email-attachments/:id/download`) get `SAMEORIGIN` instead. The rules are non-overlapping (the catch-all negative-matches those routes) so behavior never depends on how Next/Vercel merge repeated keys.
- **No CSP yet.** A script-src/style-src policy needs per-request nonces in `proxy.ts` and has to be proven against Next's inline bootstrap scripts, Tiptap and Tailwind inline styles, docx-preview, the PDF iframe and presigned Blob downloads; that cannot be verified without a browser pass and a wrong CSP breaks the app. The download routes already send their own `Content-Security-Policy: sandbox`. Rollout plan: ship `Content-Security-Policy-Report-Only` first, watch reports, then enforce.
- **Sanitizer contract:** no profile allows `class`, except the exact token `email-blocked-image` on `span` in the email profile. A renderer that needs a class must allowlist the exact name. Because stored rows predate this, `EmailMessage.body` and `Note.content` are **re-sanitized at read time** (idempotent, cheap): in `thread-reader.tsx` and in the note queries in `matter-detail.ts` / `calendar.ts` that feed every note renderer. Protocol-relative hrefs are rejected in every profile.
- **`poweredByHeader` is off** (`next.config.ts`).
- **Reply recipient integrity:** the reply composer posts the recipients it displayed plus a `recipientsEdited` flag; `email-send.ts` re-derives the unedited recipients server-side and refuses with `recipients_changed` if they moved since the composer rendered, so a reply can't silently go to a different set than the user saw.
- **Proxy:** public-prefix matching is path-boundary aware (`/login` and `/login/x`, not `/loginfoo`); `SELF_AUTHENTICATED_PATHS` stays an exact-match set.
- **docx-preview:** the render is built detached (`parseAsync` + `renderDocument`), sanitized by `sanitizeRenderedDocx` (rule-by-rule `<style>` rebuild, `url()`/fetch-function neutralizing), and only then attached, so nothing a hostile document injects applies or fetches before it is clean. A sandboxed iframe was the alternative; detaching was chosen because it keeps text selection and TreeWalker quote relocation (evidence review) working on the same DOM.

**Trade-offs:**
- (+) Clickjacking, MIME sniffing and referrer leaks closed with no behavior risk
- (+) Legacy hostile rows are neutralized without a data migration
- (-) No CSP means an XSS bug elsewhere is not contained by the browser; the sanitizers remain the primary boundary
- (-) Read-time sanitizing costs a parse per note/email render (bounded by the existing list caps)
- (-) Lenient server-side email validation for contacts, parties and calendar attendees (F987) is still open; `EmailLink` encodes the address at render time


## ADR-023: Google sync skips only deterministic failures; catch-up never advances past an open gap; Google cancel is unlink-only

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Gmail/Calendar sync had two opposite failure modes: one poisoned message (NUL byte, bad date) wedged a mailbox forever because the pass aborted before the cursor advanced, and the history-expired fallback was a 200-thread import that left a permanent gap (backfill only walks below the oldest local thread). Isolating failures naively would trade the first problem for silent, permanent loss on a database blip. Separately, a Google-side cancel could hard-delete a CRM event shaped like a personal import, which a CRM-born matterless "meeting" also is.

**Decision:**
- **Per-item isolation is limited to deterministic data errors.** `isTransientInfraError` (`src/lib/google/transient-error.ts`: Prisma P1001/P1002/P1008/P1017/P2024/P2034, initialization / rust-panic errors, driver socket + SQLSTATE codes) aborts the pass so the history cursor / calendar sync token stays put and the next run retries. A pass in which three or more items all failed and none succeeded also aborts (systemic, not poison); one or two failures with no success still count as isolated poison so a single-thread pass cannot wedge.
- **Catch-up never closes over a gap it did not fill.** Expired history for an account that has synced before triggers a catch-up since `lastSyncAt − 1d` under a safety cap (`CATCHUP_MAX_THREADS` = 1000; only a first import is capped at 200 threads / 90 days). If the cap truncates it, neither `historyId` nor `lastSyncAt` advances and `syncError` says so; each re-run skips threads already current locally (`format=minimal` compare of message count, last message time, flags) so the cap is spent on new threads and the gap shrinks every pass. No schema change; progress is implicit in the local threads.
- **Incremental sync skips unknown threads older than the oldest local thread** (the backfill frontier), so label-only history records on ancient mail cannot drag the anchor back and strand the middle.
- **Junk mail is never imported.** A thread whose every message is SPAM or TRASH is not imported (history.list reports changes on every label, so this keeps the junk folder out); a local thread that later becomes junk-only is kept, marked read and archived. Drafts are never stored.
- **A Google-side cancellation only unlinks** (deletes the `CalendarEventSync` row). With no origin flag on `CalendarEvent` there is no reliable "Google-born" discriminator, and deleting loses notes/time/tasks links with no audit entry.

**Trade-offs:**
- (+) A DB blip can no longer silently drop mail or calendar changes; a poisoned item can no longer wedge a mailbox
- (+) The large-outage gap closes over multiple passes without schema work
- (-) Skipped (poisoned) items are retried only if they change upstream again; they are visible via `syncError` and server logs until the next clean pass
- (-) A catch-up pass costs one extra `format=minimal` request per already-local thread
- (-) Google-born imports deleted in Google linger in the CRM until removed; a durable fix needs `CalendarEvent.origin` (and `EmailAccount.backfillBefore` for an explicit backfill anchor) - deferred schema work


## ADR-024: Invoice line items are draft-only; money is rounded per line (HALF_UP, cents)

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Line-item editing was allowed until an invoice was `sent`, so an approver could sign off on a total that then changed, and it was gated only on authorship. Computed amounts (hours x rate, line and invoice totals, payments, trust applications) were stored unrounded, so sub-cent values leaked into totals and aggregates.

**Decision:**
- Approved invoices are not editable in place: line items (hours / rate) can be changed only while the invoice is `draft`, under `billing.generate_invoice` (plus author-or-`time_entries.edit_any`), with the status re-checked under a row lock and an activity-log row written. To change an approved or sent invoice, void it and regenerate from WIP.
- Paying from trust (`recordInvoicePayment` source `trust`) needs `billing.apply_trust`, the same key as the dedicated apply-trust path.
- Every persisted computed amount goes through `roundMoney` (`src/lib/money.ts`): `ROUND_HALF_UP` to 2 dp, applied per line before summing, so the invoice total is the sum of displayed line amounts. Hours are validated to 2 dp on new input.
- Balances are computed from rounded totals, so legacy rows carrying sub-cent values stay payable. Approve and send refuse a $0 client invoice. Outstanding A/R means client invoices in `sent` or `partial` (same as the A/R aging report). `issueDate` and `dueDate` are reset at send with the payment terms preserved. Invoice numbers take their year from the user's profile zone, and the number of a deleted never-sent draft is reused on purpose (gap-free numbering).
- Money-view and generation permissions gate the matching controls in the Billing tab; hiding a button never replaces the server check.
- Status transitions use a status predicate (`updateMany where id and status = expected`); 0 rows is a conflict error. WIP generation links only still-unbilled entries and aborts on a count mismatch.

**Trade-offs:**
- (+) What the approver sees is what is billed; totals reconcile to the cent
- (+) Concurrent approve/send/void/edit can't silently overwrite each other
- (-) Fixing a typo on an approved invoice costs a void and regenerate
- ~~Columns are still wider than 2 dp~~ Money columns are now DECIMAL(14,2) (ADR-036)


## ADR-025: Captures do not inherit the primary's permission gate - every record kind clears its own create key

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Notes and the primary composers (task / event / deadline / time) can carry sibling captures that create other record kinds in the same transaction. Each entry point used to gate only on the primary's key, so a role holding just `notes.create` could mint tasks, deadlines, events or billable time entries through a note's attachments, bypassing the specific keys (and ADR-013's "denying `time_entries.create` closes every time-logging entry point").

**Decision:**
- The set of required keys is computed from the capture list BEFORE any write (`requiredCapturePermissions`, `src/lib/capture-permissions.ts`) and enforced with `requirePermissions` (`src/lib/permission-check.ts`): `tasks.create`, `events.create`, `deadlines.create`, `time_entries.create`, `notes.create`, plus `notes.pin` when a primary note or sibling note is pinned.
- The same helper backs `createNote`, the primary composers in `captures.ts` and the bulk-attach action, so no surface can drift.
- Deleting a note cascades to its replies, so when anyone other than the actor replied (any depth) the delete needs `notes.delete_any` even for the author.
- Event records minted through captures behave like the calendar create path: `createdById`, default attendees (`src/lib/calendar-default-attendees.ts`) and a post-commit Google Calendar push.

**Trade-offs:**
- (+) One key per capability holds regardless of which composer carried it
- (+) Denial happens before any write, so there is no partial thread to clean up
- (-) On the primary composers and bulk attach a denial redirects to `/`, so a draft carrying an attachment the user may not create is lost. The note surfaces (`createNote`) pre-check with `missingPermissions` and return a form error instead, keeping the draft. `getCaptureAccess` / `getNoteAccess` now hide capture kinds and Pin per viewer on the Notes tab; the create dock's note panel still defaults `canPin` to true (follow-up: pass `allowedKinds` and `canPin`).
- (-) Keys are plain strings (no `PermissionKey` union exists); `capture-permissions.test.ts` asserts every mapped key is known to `isKnownPermission`


## ADR-026: Conflict matcher scope — own-contact exclusion, inactive parties stay hard

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Every lead hangs off a Contact built from the very name/email/organization the conflict check scans, so the matcher matched the lead against itself and a lead could never come back "clear". Separately, the hard tier required `Contact.isActive`, but deactivating a contact only flips that flag and leaves its `MatterContact` rows on active matters — so deactivating an opposing party silently removed the conflict.

**Decision:**
- The candidate's own Contact (`ownContactId`, from `Lead.contactId`) is skipped by the soft "already in the directory" warnings. The hard tier still considers it: if the person is also an opposing-side party on an active matter, that is a real conflict.
- Contacts that are deactivated but still parties on non-archived matters stay in the hard tier. Only contacts merged away (`mergedIntoId` set; their rows moved to the survivor) are excluded. The soft warn still applies to active contacts only.
- Conflict-check audit entries identify the lead: the title carries the name, the detail begins `lead {id}:` (older rows keep the nameless title).
- **`Contact.conflictStatus` is a manual flag only.** `setContactConflictStatus` writes it and merge carries it over, but the matcher never reads it. Whether it should feed the matcher is an open product decision (see Open decisions).

**Trade-offs:**
- (+) A genuinely clean lead can be cleared; a deactivated adverse party can't hide a conflict
- (-) A deactivated party on an old open matter keeps raising conflicts until the matter is archived or the party row is removed


## ADR-027: The Matter owns the statute of limitations; the SOL Deadline row is a mirror

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The SOL lived in two places: `Matter.statuteOfLimitationsDate` (+ incident date, notes, satisfied flags) and an auto-created `Deadline` (`sourceType = statute_of_limitations`). Either could be edited independently, so the next matter save silently reverted a deadline edit (or vice versa), editing the incident date left a stale statute date, and a deadline delete removed a live statute with no trace. Missing an SOL is malpractice.

**Decision:**
- **Matter fields are authoritative.** The SOL `Deadline` is rewritten from the matter on every save (`syncSolDeadline`); deadline actions refuse to change its due date (`updateDeadline`, tolerating the +/-1 day a browser-local read-back introduces) or delete it (`deleteDeadline`), with an error pointing at the matter edit page. Status changes (complete / reopen / waive) stay allowed on the deadline, and matter saves preserve the row's status and owner. The deadline dialog renders the SOL row read-only; the row menu hides Delete and surfaces action errors.
- **Auto vs manual is inferred, not stored** (no schema change): a stored SOL equal to `computeSolDate(stored incident, stored area period)` (or null) is auto-derived and is recomputed from the posted incident date + the possibly-new area on edit (`resolveEditedSolDate` / `isAutoDerivedSol` in `src/lib/sol.ts`); anything else is a manual override and is kept. The edit form shows the auto value as a live preview and leaves the override input empty unless a real override exists. Clearing the incident date, or switching to an area with no period, keeps the stored date rather than dropping it.
- **Switching to an area without SOL tracking never wipes** the incident date, SOL date/notes or the SOL deadline.
- **Audit:** `createMatter`, `updateMatter` (incl. SOL old -> new) and `setMatterSolSatisfied` write `ActivityLog`; every deadline create/edit/status/delete does too.
- **Audit conventions:** matter mutations log type `filing`, deadline mutations type `deadline`; `logAuditEntry` (`src/lib/audit-entry.ts`, free-string type, field names only in the detail) serves parties, practice-area and calendar-default edits.
- **Lead attorney changes** on the edit form require `matters.manage_team` (same key as `addMatterTeamMember`); the field is locked without it, and the edit page always includes the matter's current client and lead in the option lists even if inactive so a save never detaches them.

**Trade-offs:**
- (+) One place to change the statute; no silent divergence between matter and deadline
- (-) Auto-vs-manual is inferred: a manual date that happens to equal the computed one is treated as auto and will follow later incident/area edits
- (-) ~~The 365/30-day period arithmetic is unchanged~~ Superseded by ADR-035: periods are now calendar amount + unit and computed with calendar arithmetic


---

## ADR-028: Layouts are not auth gates; every page authenticates itself

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The (dashboard) layout called `auth()` and redirected, and the docs described it as the authoritative gate. But Next renders a page on a partial (RSC) navigation without re-running its parent layouts, and the proxy only checks that a session cookie is present. A page that read data without its own guard could therefore be reached with a stale or forged cookie, and several pages (billing tab, invoice print route, matters list, lead detail) did exactly that.

**Decision:**
- Every `page.tsx` and `layout.tsx` under `src/app/(dashboard)` and `src/app/print` calls a session guard as the **first `await`** of its default export, before any data read: `requireUser()` (`src/lib/current-user.ts`; redirects to `/login`, never wrap in try/catch), or a stronger `requirePermission(key)` / `requireAdmin()` / `getCurrentUserId()`. All are React-`cache()`d, so repeat calls in a request are free.
- `currentUserHasPermission` is a read-side flag and does not count as a guard.
- `src/app/page-guards.test.ts` statically enforces the rule (first `await` is a guard; no `prisma.` before it). The page allowlist (`PAGE_ALLOWLIST`) is now empty; only `(dashboard)/layout.tsx` (the UX gate itself) and `print/layout.tsx` (no data reads) are exempt layouts.
- The (dashboard) layout and the proxy remain a UX convenience (redirect early, render the shell for signed-in users), not the security boundary. `src/proxy.ts` is an optimistic cookie-presence check only; its matcher excludes `/api/documents/upload` exactly (not `/upload/blob`) because proxy body buffering (`proxyClientMaxBodySize`, 10 MB) would truncate the streaming multipart upload, and that route authenticates itself (401 without a session, 403 without `documents.upload`). `SELF_AUTHENTICATED_PATHS` (cron + blob callback) stays pinned by `src/vercel-config.test.ts`. Cron endpoints authenticate with `isAuthorizedCron` (`src/lib/cron-auth.ts`, constant-time compare, fail closed).
- Where no billing read permission key exists (matter Billing tab, invoice print route), only the session guard was added; no key was invented because that would change who can see billing. Introducing one is a separate decision.

**Trade-offs:**
- (+) Authentication no longer depends on which layouts happen to run
- (+) A new page that forgets the guard fails CI instead of shipping
- (-) One extra line per page; a static scan cannot see guards hidden behind conditionals or helpers, so reviewers still read the first lines of each page


## ADR-029: Matter visibility today is firm-wide; matter-team access is planned, not built

**Date:** 2026-10-17
**Status:** Accepted (history); superseded by ADR-039

**Context:** Older docs implied `MatterTeamMember` restricts who can see a matter. It does not, and the sweep confirmed it on every read path. The firm decided on 2026-10-16 how the restriction should work; the design is in `out/sweep/MATTER_ACCESS_DESIGN.md`. This ADR records the truth so nobody builds on the wrong assumption.

**Decision (current, built):**
- Every signed-in user can list, open, search, download and export every matter and everything attached to it — notes (including strategy memos), documents, invoices, trust ledger, time narratives — subject only to the granular permission keys and the calendar Busy scrub (ADR-021). Even the zero-permission default role reads matter detail; the Billing tab and `/print/invoices/[id]` now need `billing.view` (ADR-038).
- `MatterTeamMember` drives assignment, notifications, auto-attendees (`src/lib/calendar-default-attendees.ts`), calendar detail unlocks and the lead filter. It is **not** an access-control list. Ethical walls are unsupported.
- The document download route and the upload, blob-upload and document-template routes have no firm or matter-team scoping. Scoping them needs the matter-access phase and, for true multi-tenancy, a `Matter.firmId`.
- Email is the exception: it is mailbox-personal (ADR-014).

**Decision (planned, NOT built — Proposed):**
- A user can see a matter when they are an active team member, hold the grantable `matters.view_all` key (Admins implicitly), or the firm's matter-visibility switch is still at "everyone". Hidden matters 404 (never 403). Every matter-scoped write also requires access.
- A firm-level switch (Settings → Firm) starts at "everyone"; the admin flips it to "team only" after fixing rosters with a "thin teams" list. Turning it on is logged.
- Events on inaccessible matters show as Busy through the existing scrub.
- Mechanism: `src/lib/matter-access.ts` (`matterAccessWhere`, `canAccessMatter`, `assertMatterAccess`), enforced by a static scan like `page-guards.test.ts` plus two-user integration tests. The firm-switch column and `matters.view_all` ship in the Batch 4 migration (see `SCHEMA_NOTES.md`; not applied).

**Trade-offs:**
- (+) Docs now state what the code does; the planned phase has an agreed rollout that cannot lock anyone out on day one
- (-) Until the phase ships, any staff account can read any client file; permissions narrow actions, not reads

---

## ADR-030: Settlement status follows the approval chain; amounts and steps serialize under a per-matter lock

**Date:** 2026-10-17
**Status:** Accepted

**Context:** `matters.settlement.edit` could set `status` directly, so an editor could mark a settlement approved or disbursed without the approval chain, and amount edits raced with approver clicks.

**Decision** (`src/app/actions/settlements.ts`):
- New settlements are always `pending`. Only the approval chain (`setApprovalStepStatus` promotes `pending` to `approved` when every step is approved and demotes `approved` to `pending` when a step is rejected or reset) or `matters.settlement.approve` moves status. `edit` alone can no longer change status; `approve` also covers reopen and stage transitions through `upsertSettlement`. Step notifications go only to `matters.settlement.view` holders.
- `disbursed` and `closed` lock amounts. Changing amounts on a fully approved settlement resets the approvals and therefore requires `matters.settlement.approve`.
- Amount edits, step changes and creation all take `pg_advisory_xact_lock(hashtext('settlement:' + matterId))`, so two approvers or an approver and an editor serialize. The unique index on `settlements(matterId)` now backs the one-settlement-per-matter guarantee in the database (ADR-036); the lock stays because it also serializes status transitions and amount edits.
- Client net is signed and never clamped (a negative net is shown, in warn tone). Fee math is Decimal HALF_UP to cents via `src/lib/settlement-waterfall.ts` (same rounding rule as ADR-024); `Settlement.clientNet` is derived on read, not stored.

**Trade-offs:**
- (+) The recorded status always matches the recorded sign-offs
- (-) The lock is app-level, but a second row for the same matter is no longer possible: the unique index (ADR-036) refuses it

---

## ADR-031: Google sync coordination — claim CAS, deterministic event ids, frontier skip

**Date:** 2026-10-17
**Status:** Accepted (complements ADR-023)

**Context:** The cron, "Sync now" and the opportunistic page kick can all start a sync for the same mailbox, and Calendar pushes can race or retry. A new claim column was avoided to keep the schema untouched.

**Decision:**
- **Sync claim by compare-and-set** on `EmailAccount.syncStatus` (`gmail-sync.ts`): `updateMany` flips the row to `syncing` only if it is not already `syncing` or its `updatedAt` is older than `SYNC_CLAIM_STALE_MS` (10 minutes, a crashed run). Zero rows claimed means another pass has it and this one returns `skipped`. The claim also requires a refresh token and a non-`disconnected` status so a concurrent disconnect is not stomped. **`EmailAccount.updatedAt` is therefore the heartbeat** — any update to the account refreshes it. The sweep order is `lastSyncAt` ascending, nulls first; the email-sync route sets `maxDuration = 300` (confirm against the Vercel plan limit).
- **Deterministic Google event ids:** the CRM event id is base32hex-encoded (`googleEventIdFor`, `calendar-shared.ts`) and sent as the Google event id on insert. A 409 means that id already exists (lost mapping write, racing first push, or a copy cancelled at Google) and the push PATCHes it with `status: confirmed` instead of creating a duplicate.
- **Backfill anchor without a schema column:** incremental sync skips unknown threads older than the oldest local thread (ADR-023). A durable `EmailAccount.backfillBefore` is deferred.
- **Junk:** SPAM/TRASH-only threads are never imported; local ones are kept, read and archived (ADR-023).
- **Host allowlist:** `gmailFetch` only calls `gmail.googleapis.com` and `www.googleapis.com`, with a 60 s per-request timeout (caller signal wins; OAuth endpoints 30 s). OAuth connect refuses a grant missing `gmail.modify` / `gmail.send`; connect and disconnect are audited as `auth` rows. Read-state writeback is per message (`messages/batchModify` over synced ids), and after a failed writeback the local flag stands until Gmail next reports that thread, then Gmail's labels win.

**Trade-offs:**
- (+) Concurrent passes are safe and crashed runs recover without a lock table
- (-) Reusing `updatedAt` as the heartbeat means unrelated account writes extend a stale claim; a dedicated `syncStartedAt` column would be cleaner
- (-) A Google-born event deleted in Google lingers until `CalendarEvent.origin` exists (ADR-023)

---

## ADR-032: Database pool sizing

**Date:** 2026-10-17
**Status:** Accepted

**Context:** The pool was capped at one connection per process. With the advisory-lock transactions of ADRs 020, 030 and 031, a single slow transaction queued every other request in that instance, and the concurrency tests could not exercise real lock contention.

**Decision:** `src/lib/prisma.ts` sizes the `pg` pool from `DATABASE_POOL_MAX` (a positive integer), default **5** per instance. Vercel Fluid compute shares one instance across concurrent requests, so a handful of connections per instance is the right unit; total connections are instances times this value, which must stay under the database's limit (use a pooler for large fan-out). The test suite runs with `DATABASE_POOL_MAX=4`, and lock-contention tests use a multi-connection pool on purpose.

**Trade-offs:**
- (+) Concurrent requests no longer serialize behind one connection; row- and advisory-lock behavior is testable
- (-) More connections per instance; revisit if the database connection limit is approached

---

## ADR-033: Error boundaries use retry(); the notification bell reads over GET

**Date:** 2026-10-17
**Status:** Accepted

**Context:** In Next 16 an error boundary's `reset()` only re-renders the client tree and does not refetch the server component that threw, so "Try again" re-showed the same error. Separately, a polled Server Action is dispatched one at a time per client, so the bell's poll queued ahead of the user's real mutations (Save waited behind a fetch).

**Decision:**
- Error boundaries call `retry()` (re-fetches and re-renders the segment). `src/app/error.tsx` is the layout-level backstop for errors thrown above any route-level boundary.
- Notification bell state lives in a provider inside `AppShell`. The poll reads through `GET /api/notifications/bell` (`src/app/api/notifications/bell/route.ts`, session-checked, scoped to the session user, never cached); mutations (mark read, mark all read) stay Server Actions. Notification writers and mark-read actions no longer revalidate the layout; the bell and feed are client state.
- Rule of thumb: polled or background **reads** use a GET route handler that authenticates itself (the proxy only checks cookie presence, ADR-028); **mutations** use Server Actions (`docs/ARCHITECTURE.md`).

**Trade-offs:**
- (+) Retry actually recovers from transient failures; saves are not blocked by the poll
- (-) One more route handler to keep guarded and tested

---

## ADR-034: Document bytes never travel through server actions

**Date:** 2026-10-17
**Status:** Accepted

**Context:** Server Actions cap the request body (about 1 MB) and run on a serverless function; the single-file composer originally posted its file through `uploadDocument` and silently failed for ordinary files. ADR-015 already moved bulk uploads off the serverless path.

**Decision:** Any code path that carries file bytes uses an upload transport, never a server action: the streaming busboy route `POST /api/documents/upload` under the local driver, or the client-direct Blob upload (`/api/documents/upload/blob`) under the Vercel Blob driver. The uploader and the single-file composer pick the transport from the `storageDriver` prop supplied by the server component. The route accepts optional `name` (single-file only) and `category` fields; the blob `clientPayload` accepts `category`. The `uploadDocument` server action is no longer referenced by the UI (it still enforces `documents.upload` for programmatic callers; removal is a dead-code decision). The composer uses a manual submit handler, so the typed form survives errors. There is no edit-metadata action (rename or re-categorize); adding one needs a `documents.edit` key and is an open product decision.

**Trade-offs:**
- (+) Large files work in production; the 1 MB action cap can't truncate an upload
- (-) Two transports to keep behaviorally identical (name/category round-trip, permission checks, audit rows)

---

## Open product decisions

These are not ADRs: each needs a human call, and when it is made it becomes an ADR (or amends one).

1. **Trust `deposit` activity rows.** "Trust applied to invoice ... $amount" rows show to every viewer on the matter Timeline. Should they require a billing-view key? No such key exists (ADR-021, ADR-029).
2. **Does `Contact.conflictStatus` feed the conflict matcher?** It is a manual flag the matcher never reads (ADR-026).
3. **`documents.template.delete` versus `.edit` for archive/restore.** The catalog text for `documents.template.delete` says "Archive or permanently remove", but `document-templates.ts` gates archive and restore on `documents.template.edit` (the action docstring calls this deliberate). Align the catalog text or the code.
4. ~~Privileged time narratives.~~ Decided in ADR-039: visible to anyone who can access the matter.
5. ~~A per-event `private` calendar visibility value.~~ Decided and shipped: ADR-037.
6. **Reads that need a key before they can be gated:** `exportContactsCsv`, the command-palette data, `searchAttendeesAction`, `previewDocumentFromTemplate`, and the billing read surface (ADR-028 added only session guards).
7. ~~Matter-team access phase.~~ Built: ADR-039.
8. **Document metadata edit** (rename, re-categorize) needs a `documents.edit` key (ADR-034); the receipt picker is capped at 200 documents.
9. **Google-born event cleanup and an explicit backfill anchor** need `CalendarEvent.origin` and `EmailAccount.backfillBefore` (ADR-023, ADR-031).

---

## ADR-035: Statute periods are calendar amount + unit, computed with calendar arithmetic

**Date:** 2026-10-17
**Status:** Accepted (supersedes the 365/30 convention in ADR-027 and ADR-019)

**Context:** `PracticeArea.statutePeriodDays` stored "years x 365 + months x 30 + days". Statutes say "two years" or "six months", which run to the same calendar date, so the computed SOL date could be a day early across a leap year or a day or two off for months. Missing an SOL is malpractice, so the stored period must say what the statute says.

**Decision:**
- `PracticeArea.statutePeriodAmount Int?` + `statutePeriodUnit SolPeriodUnit?` (`DAYS | MONTHS | YEARS`), set together or not at all. The settings form is an amount input plus a unit select. The migration backfills from the old column: days divisible by 365 become `YEARS` (730 -> 2 YEARS), anything else stays `DAYS` (180 -> 180 DAYS; an "18 months" area stored as 540 comes back as 540 DAYS and should be re-entered).
- `statutePeriodDays` stays in the schema (expand/contract) but nothing reads or writes it; a later migration drops it. Rolling the app back one release still works for existing areas.
- `computeSolDate` (`src/lib/sol.ts`) works on the incident's UTC date-only value (ADR-012). DAYS adds N days; MONTHS/YEARS add N (12N) calendar months keeping the day of month. **Month-end rule:** when the target month is shorter, the result clamps to its last day (2024-02-29 + 1 year = 2025-02-28; 2024-02-29 + 4 years = 2028-02-29; 2026-01-31 + 1 month = 2026-02-28). No time zone ever enters the math.
- Callers (`createMatter`, `updateMatter` via `resolveEditedSolDate`, lead conversion, the edit/new matter form previews and the SOL card) take a `SolPeriod = { amount, unit }` built by `toSolPeriod`.
- Automation deadline rules (ADR-019) keep their single signed `offsetDays` integer plus `offsetUnit`; the amount is recovered with `unpackOffset` and months/years are then applied as calendar months on the day key (`applyOffsetToKey`). "Days" rules are unchanged.
- Auto-vs-manual inference (ADR-027) is unchanged but now compares against the calendar result; a matter whose stored auto date was computed under the old 365-day rule can look manual after the migration (the safe direction: it is kept).

**Trade-offs:**
- (+) The date matches the statute's wording; leap years and month ends are explicit and tested
- (-) A date computed under the old rule can differ by a day or two from the new one for existing matters; they keep their stored dates (treated as manual) until edited
- (-) A mixed period ("1 year 6 months") is entered as 18 months

---

## ADR-036: Money is DECIMAL(14,2); one settlement per matter; hot-path indexes

**Date:** 2026-10-17
**Status:** Accepted (completes ADR-024)

**Context:** ADR-024 rounds every persisted amount in code (`roundMoney`), but the columns were unconstrained `Decimal(65,30)`, so a path that skipped the helper could still store sub-cent values. The one-settlement-per-matter rule rested on an advisory lock (ADR-030). The perf audit listed missing indexes.

**Decision:**
- Every money column (`Matter.trustBalance/wipAmount`, `TimeEntry.rate/amount`, `Expense.amount`, `Invoice.subtotal/taxAmount/totalAmount/paidAmount`, `InvoicePayment.amount`, `TrustTransaction.amount`, `Settlement.grossAmount/firmFee/advancedCosts/clientNet`, `SettlementLien.originalAmount/negotiatedAmount`) is `DECIMAL(14,2)` (up to 999,999,999,999.99). `Settlement.firmFeePercent` is `DECIMAL(7,4)`. `ALTER ... TYPE` rounds existing values to the new scale in place (half away from zero); the code-side `roundMoney` stays as the first line of defence and for intermediate math.
- Not changed: `TimeEntry.hours` is `Float` (hours are validated to 2 dp on input and are not money; amounts are derived and rounded). Converting it to Decimal needs a wide code change for no correctness gain today.
- `Settlement.matterId` is unique. The migration starts with a guard that **raises an exception naming the offending matters** if any matter has 2+ settlements, so a deploy fails before changing anything and nothing is ever deleted. The per-matter advisory lock stays (it serializes status transitions and amount edits); reads and the upsert use the unique key.
- New indexes: `TimeEntry(invoiceId)`, `EmailAttachment(messageId)`, `MatterContact(contactId)`, `SettlementLien(settlementId)`, `SettlementApproval(settlementId)`, `Deadline(status, dueDate)`, `ActivityLog(matterId, timestamp)` and `(userId, type, timestamp)`, `MatterTeamMember(userId, removedAt)`. The old `settlements(matterId)` index is dropped as redundant with the unique one.

**Trade-offs:**
- (+) The database refuses sub-cent or oversized amounts and a second settlement
- (-) The rounding step is irreversible; deploy notes tell the operator to expect it
- (-) Extra indexes add small write cost on hot tables

---

## ADR-037: Private calendar events show to their creator only

**Date:** 2026-10-17
**Status:** Accepted (completes ADR-021's calendar model)

**Context:** A per-event `show_details` toggle could only add visibility, and the creator's `defaultEventVisibility = show_details` profile setting exposed every event they create, past and future, with no per-event way to hide one.

**Decision:**
- `CalendarEvent.visibility` (a text column) gains `private`. `canViewEventDetails` returns true for a private event **only to its creator**. Attendees, the matter team, anyone with `events.edit`, and a show-details profile default all see "Busy" with the time range. Private beats every other rule; there is no Admin bypass.
- It works on every read surface because they all use the one resolver: calendar grid and modal, dashboard agenda, matter Events tab and event chips, and global search (a private event never matches or leaks a snippet).
- The matter activity log never records a private event's title (`auditEventTitle` writes "Private event"), since the Timeline is read by every matter viewer.
- Google sync: a private CRM event is pushed with `visibility: "private"`; every other pushed event is sent as `default` (so un-privating resets the Google copy). A Google event marked private is imported as a CRM-private event.
- UI: a "Private event" checkbox on the quick composer, full-page form, matter event capture and the detail modal; mutually exclusive with "Show details to everyone".

**Trade-offs:**
- (+) Gives creators a reliable per-event hide that no profile default can undo
- (-) Invitees see Busy for a private event they were invited to (the creator chose private); use a normal event for invitees
- (-) A colleague with `events.edit` can still move or delete a private event they see as Busy (the edit gate is unchanged)

---

## ADR-038: `billing.view` gates the billing read surface

**Date:** 2026-10-17
**Status:** Accepted

**Context:** Billing had action keys (`billing.*`, `trust.record_transaction`) but no read key: every signed-in user could open any matter's Billing tab, print any invoice by id, and see the firm trust total and trust deposit rows (ADR-021 listed this as open).

**Decision:**
- New key `billing.view` ("View billing, trust ledger and invoices"). It gates the matter Billing page (`requirePermission`, redirect to `/` like other denied pages), the Billing tab link (hidden without it), the invoice print route and its metadata, the Overview "Trust balance" and "WIP" facts, the dashboard Trust balance KPI (needs `reports.view` too), and trust `deposit` activity rows on the matter Timeline and the dashboard feed (omitted, as with settlement/expense rows).
- The migration grants `billing.view` to every role that already holds any `billing.*` or `trust.*` key, so nobody who could act on billing loses the tab. Admin is a wildcard in code and needs no row. Other roles gain nothing until an admin ticks the key.
- The matters list/kanban "Trust" column and its sort/filter are now gated by `billing.view` too (ADR-039).

**Trade-offs:**
- (+) Billing data has an explicit read gate separate from the action keys
- (-) Roles that could view billing only because everyone could (no `billing.*` key) lose the tab until granted

## ADR-039: Matter-team access (ethical walls)

**Date:** 2026-10-17
**Status:** Accepted

**Context:** ADR-029 recorded that every signed-in user could read every matter. The firm decided (2026-10-16) on team-based access with a safe rollout.

**Decision:**
- A user sees a matter and everything on it when they are an active `MatterTeamMember`, hold the new `matters.view_all` key (Admins implicitly), or `Firm.matterVisibility` is `FIRM` (default, today's behavior). Inactive users see nothing.
- Hidden is indistinguishable from missing: 404 on pages and routes, `notFound()` in actions; never 403.
- One module, `src/lib/matter-access.ts`: `matterAccessWhere` for lists/aggregates, `assertMatterAccess` / `assertChildMatterAccess` for details and writes, cached per request. Pages guard themselves (ADR-028); every matter-scoped write asserts after its permission key. Static tests enforce both (`page-guards.test.ts`, `matter-access-guards.test.ts`).
- Rollout switch in Settings, Firm: admin-only (not a delegable key, since a delegate could wall off the firm), logged; a "thin teams" list shows open matters with no active member or only a lead.
- Calendar: events on inaccessible matters are "Busy" (ADR-021 scrub); a Busy-only viewer cannot move/edit/delete private events or events on hidden matters (closes the ADR-037 gap).
- Privileged time narratives: visible to anyone with matter access, hidden from everyone else (search included).
- Matters list Trust column/sort/filter need `billing.view` (closes the ADR-038 gap).
- Conflict-check hits on inaccessible matters keep their severity but lose the matter name/link: filtering them out would silently clear a real conflict.
- Aggregates gated by `reports.view` (firm pulse, trust total, A/R aging, utilization, realization) stay firm-wide; named per-matter rows are filtered.
- No schema change: the `matterVisibility` column shipped in the Batch 4 migration.

**Trade-offs:**
- (+) Real walls with a staged rollout and no behavior change until the switch flips
- (-) Every new matter-scoped page/action must remember the assert (the static tests catch omissions); contacts that exist only on hidden matters remain findable by name; `mergeContacts` is a firm-wide directory operation and is allowlisted
- (-) Admins must grant `matters.view_all` to billing/office roles before flipping

## ADR-040: Dependent deadlines are recalculated only after explicit confirmation

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Deadline rules can count from another rule's deadline or from the incident date (ADR-019), but dates were snapshotted at apply time. Moving a trial date left "motions 30 days before trial" where it was — wrong, with no warning. Moving deadlines automatically would fix that but is itself dangerous: a court date entered by mistake could silently shift a dozen statutory dates, and some dependent dates are deliberately different from what the rule says.

**Decision:**
- **Two-step, always.** The two places a rule's anchor date can change — `updateDeadline` (a deadline's date) and `updateMatter` (the incident date) — first compute what would move (`previewRecalc`). If anything would, they return `status: "confirm"` with the list and **write nothing**. The form shows `CascadeConfirm`; the user resubmits with `cascadeDecision=apply` + the ticked `cascadeId`s, or `skip`.
- **Only ticked deadlines move.** On the confirmed submit the server re-plans from current rows inside the same transaction as the primary save (`applyRecalc`) and moves only deadlines in the selection — never one the user didn't see and tick, even if the plan changed in between. Unticking a deadline also keeps everything counting from it.
- **Planning rules** (`src/lib/automations/recalc-plan.ts`, pure): chains are followed in dependency order; a rule's anchor for its dependents is its newest deadline on the matter (the same one `applyDeadlineRules` counts from); only open/overdue deadlines move, and nothing propagates through a completed/waived one; offsets use `applyOffsetToKey`, so a recalculated date equals a freshly applied one.
- **Hand-set dates are protected, not frozen.** Editing a rule-generated deadline's date sets `Deadline.dueDateSetManually`. Such a deadline still appears in the list when its anchor moves — flagged "changed by hand", unticked by default. Recalculating it clears the marker.
- The primary save keeps its stale-form guard; the recalculation shares its transaction, so a refused save moves nothing.
- Every moved deadline gets its own activity-log row: old → new, what it counts from, and what triggered it.

**Trade-offs:**
- (+) No deadline ever moves without the user seeing old → new and choosing it
- (+) Deliberate exceptions survive (hand-set marker + unticked default)
- (-) One extra round-trip on saves that affect dependents
- (-) Only the two UI paths recalculate; dates changed by other means (data imports, direct DB edits) don't trigger it
- (-) "Matter opened" anchors can't change, and "date entered when applied" anchors aren't stored, so neither triggers a recalculation — the deadlines they produced are themselves the anchors for later rules

## ADR-041: PDFs render in the page with pdf.js; PDF flags anchor to page + quote

**Date:** 2026-10-18
**Status:** Accepted

**Context:** PDFs were shown in an iframe using the browser's PDF plugin. The plugin is a black box: the app can't read its current page, see the reviewer's selection, or jump without reloading it. So PDF flags could only carry a hand-typed page number, unlike Word documents where a selection becomes a quote flag.

**Decision:**
- Render PDFs ourselves with **pdf.js** (`pdfjs-dist`, pinned): a canvas plus pdf.js's transparent text layer per page (`src/components/documents-viewer/pdf-document-viewer.tsx`). The worker is bundled via `new Worker(new URL(...))`, and the library is dynamic-imported so it loads only on PDF pages.
- **Virtualized pages.** Every page gets a sized placeholder (sizes from page 1, corrected per page as pages render), so jumps are arithmetic. Only pages within ~1,200 px of the viewport render, and pages that leave are cleared. Pure layout math lives in `src/lib/pdf-viewer-math.ts`.
- **Anchor = page (+ optional span end) + optional quote.** A selection on a page becomes `{ pageNumber, quote }`; one that runs across a page break also stores `endPageNumber` (added 2026-10-18, max 25 pages), and the viewer keeps the whole span rendered so the passage can be relocated across the break. The corner page numbers are CSS-generated content, so they never leak into a cross-page quote. The page disambiguates repeated phrases; relocation uses the same `locateQuote` matcher as the Word viewer, scoped to that page's text layer. Highlights use the CSS Custom Highlight API: no DOM changes to pdf.js's layer.
- **Hardening:** pdf.js 6 never evals font code. No annotation, form or XFA layer is mounted, so embedded links and scripts are inert. The bytes come from the same auth-gated download route (blob 302s are followed, as for docx-preview).

**Trade-offs:**
- (+) PDF tagging matches Word: select, flag, click to return to the highlighted passage
- (+) In-app navigation: no plugin reload per jump; current page known (prefills "Flag this page")
- (-) Roughly 430 KB of library plus a 1.2 MB worker, loaded on PDF pages only
- (-) No in-viewer text search yet (the browser's find only sees rendered pages); scanned PDFs with no text layer can only take page flags until OCR
- (-) Rendering fidelity is pdf.js's, not the browser plugin's (in practice equal or better; forms and annotations aren't shown)

## ADR-042: Excel and email convert on the server; TIFF and HEIC decode in the browser

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Discovery arrives as phone-record spreadsheets, exported emails (.eml from most clients, .msg from Outlook), multi-page TIFF scans and iPhone photos (HEIC). Browsers show none of these natively, so they were download-only.

**Decision:**
- **Excel (.xlsx) and email (.eml/.msg) convert server-side**, like the docx/text previews (`src/lib/office-preview.ts`). Libraries: `read-excel-file` (values only, maintained; SheetJS's npm release is stale with known advisories and `exceljs` is heavy), `postal-mime`, `@kenjiuno/msgreader`. The output is plain server-rendered text, so TextReview's quote flags work on it, and email bodies reuse `sanitizeEmailHtml` (the same hostile-mail profile as synced Gmail: no scripts, remote images blocked). Size caps (10 MB workbook, 25 MB email), zip-bomb bounds and row/column/sheet caps apply; every failure is a reason card.
- **TIFF and HEIC decode in the browser** from the auth-gated download route: TIFF with `utif` inside a Web Worker (its page-chain walk has no cycle guard, so a hostile file could spin forever; the worker is terminated after a timeout), HEIC with `heic-to` (libheif WASM, loaded on demand). Neither touches the server's CPU, and neither changes the download route's inline allowlist (fetch ignores Content-Disposition).
- PowerPoint and legacy .xls/.doc stay download-only: faithful rendering needs a real office converter (e.g. LibreOffice on a server), a bigger decision.

**Trade-offs:**
- (+) Four common evidence formats open inline; spreadsheets and emails take quote flags
- (-) Spreadsheets show values only (no formatting, formulas or charts); email attachments are listed, not opened
- (-) TIFF/HEIC flags are anchorless for now (page/region tagging deferred); heic-to is LGPL (loaded unmodified as a separate module)

## ADR-043: Email attachments become documents; "Copy to…" makes independent copies without re-uploading

**Date:** 2026-10-18 (revised the same day: links → copies)
**Status:** Accepted

**Context:** Emails uploaded as evidence (.eml/.msg) carry the files that matter — reports, photos, spreadsheets — but those were only names on a chip. To review or flag one, someone had to download the email, extract it by hand and upload it again; and putting a document in a second folder meant uploading it twice.

**Decision:**
- **Extract on upload.** After an email document is created (both upload transports), each listed attachment becomes its own Document (`src/lib/email-attachment-extract.ts`): stored under its own key, `parentDocumentId` = the email, `attachmentIndex` = its position (so the viewer's chips open it), the email's folder and category, `source: "email_attachment"`. Images embedded in the body (cid:) aren't attachments. Extraction is idempotent (atomic claim on `attachmentsExtractedAt`), rolls back fully on failure, and is best-effort — the upload itself never fails because of it. Older emails get an "Add attachments to documents" button (`documents.upload`).
- **Attachments live under their email.** They share its folder and move with it; moving one directly is refused. Trees and the Documents tab show them nested under the email.
- **"Copy to…" makes a real copy, not a link** (`copyDocumentToFolder`, `documents.organize`). The copy is its own document from then on — name, folder, status, flags and notes are separate — but it shares the stored file, so nothing is uploaded or stored again. `deleteDocument` already removes bytes only when no other row references them, so deleting either side is safe. Copying an email copies its attachments too. (The first version shipped "Also file in" links to one shared document; the user wanted copies to behave as their own documents, so the links table was dropped and existing links converted to copies.)
- **Deleting an email** (the user's rule): an attachment that's been copied elsewhere is "saved" and lives on as that copy; attachments with no copy are named in the delete prompt with an explicit choice — delete with the email (default) or keep in the folder. The server refuses to guess.

**Trade-offs:**
- (+) No re-uploads: every attachment is reviewable and flaggable where it arrived, and copies cost no storage
- (+) Copies behave exactly like any other document
- (-) A copy doesn't track its original — later edits, flags or notes on one don't appear on the other (by design)
- (-) Attachment bytes are stored twice (inside the email and as their own file); emails over 25 MB and attachments past 100 per email aren't extracted
- (-) Outlook .msg embedded (cid) images still show as blocked in the body; nested emails inside emails are extracted as files, not expanded

## ADR-044: Intake notes share the Note table, scoped to a lead until conversion

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Intake needed a Notes section like the matter's. Screening calls, evaluation thoughts and follow-ups happen before a matter exists, and they should not be lost when the lead converts.

**Decision:**
- **One `Note` table, two scopes.** `Note.leadId` (nullable, Cascade) was added and `Note.matterId` made nullable. Exactly one is set, the same invariant TimeEntry has used since 2026-07-07. `src/lib/note-scope.ts` holds the `NoteScope` type, the both/neither check and the revalidation paths.
- **Shared UI.** The matter Notes components take a `scope` instead of a `matterId`. On a lead scope they hide everything that needs a matter: captures, attached tasks / deadlines / time, Convert to task, event and email link chips.
- **Same permissions.** Intake notes use the existing `notes.*` keys. Writing an intake note is the same capability as writing a matter note, so no new key.
- **Roll forward on conversion.** `convertLeadToMatter` re-homes lead notes onto the new matter in its transaction. Replies, reads and reactions reference the note id, so they move with no extra work.
- **Quiet activity rows.** Lead notes have no matter team to scope the feed to, so their activity rows are firm-wide with no note text (the intake-time pattern).

**Trade-offs:**
- (+) No duplicate note model or actions; threads, reactions and read state work on day one and survive conversion
- (+) After conversion, intake notes read exactly like any other matter note
- (-) Every reader of `Note.matterId` has to handle null. The sweep was small (search, event-note mapping, note attachments), but new code must remember it
- (-) Lead notes can't capture tasks or deadlines until the lead is a matter

## ADR-045: Intake tasks and events reuse Task and CalendarEvent, scoped to a lead until conversion

**Date:** 2026-10-18
**Status:** Accepted

**Context:** After intake notes (ADR-044), intake needed tasks (call back, request records) and events (consultations) before a matter exists, carried onto the matter when the lead converts.

**Decision:**
- **Same tables, at-most-one scope.** `Task.leadId` and `CalendarEvent.leadId` were added. Unlike notes, both models already allow no matter (firm-wide tasks, personal events), so the invariant is at most one of (matterId, leadId). `src/lib/record-scope.ts` holds `RecordScope` (also the note scope type), the both-set check and the revalidation paths.
- **Shared UI.** The task and event composers take a `scope`; the status-grouped task list is `TaskListByStatus`, used by both Tasks tabs. On a lead, sibling captures and the matter-only row actions (log time, add note, convert to deadline) are off; those actions already refuse a task with no matter.
- **Lead events are personal-event-like.** A lead has no team, so the creator is the only default attendee, and visibility and edit rights follow the personal-event rules (creator, attendees, `show_details`; `events.edit_non_matter` to edit someone else's). After conversion the matter team rules apply.
- **Same permissions.** `tasks.*` and `events.*`; no new keys.
- **Visible firm-wide surfaces.** Lead tasks show in "Your tasks", lead events on the calendar, both in search, labelled "Intake · {lead}".

**Trade-offs:**
- (+) One task and one event model; status toggles, editing, Google sync and the calendar work unchanged
- (+) Conversion is two `updateMany`s; nothing is copied
- (-) Teammates who aren't attendees see an intake event as Busy until the lead converts
- (-) Intake notes can't yet capture a task or event from their composer


## ADR-046: Intake documents share Document and DocumentFolder, scoped to a lead until conversion

**Date:** 2026-10-18
**Status:** Accepted

**Context:** After intake notes (ADR-044) and tasks/events (ADR-045), intake needed documents (retainers, ID scans, generated letters) before a matter exists, carried onto the matter when the lead converts.

**Decision:**
- **Same tables, exactly-one scope.** `Document.leadId` and `DocumentFolder.leadId` were added and `matterId` made nullable on both. Exactly one of (matterId, leadId) is set on each row, and a folder and its documents share a scope. `RecordScope` helpers in `src/lib/record-scope.ts` (`scopeOf`, `scopeWhere`, `scopeBasePath`) and `src/lib/scope-access.ts` (`assertScopeAccess`, `assertScopeWritable`, `revalidateDocumentScope`) are the single place scope is resolved.
- **Upload routes accept `leadId`.** The streaming and blob upload routes take `leadId` in place of `matterId`; the viewer, listing and download resolve the row's scope rather than assuming a matter.
- **No matter wall on lead documents.** A lead has no team, so any signed-in user can view and download lead documents (same as the intake pages); the `documents.*` write keys gate upload, organize and delete. Matter documents keep the matter wall.
- **Converted leads are read-only.** Writes to a converted lead's documents and folders are refused; the tab links to the matter.
- **Conversion re-homes, not copies.** `rehomeLeadDocuments` (`src/lib/lead-documents.ts`) moves folders and documents onto the matter inside the convert transaction. A root folder whose name collides with an existing matter root folder gets a "(n)" suffix.
- **Uploads survive a mid-upload conversion.** Both upload paths decide scope and insert in one transaction that takes `FOR SHARE` on the lead row (`resolveLeadUploadTarget`); a lead converted meanwhile reroutes the file onto its matter (folder falls back to the matter root). If the uploader can't access that matter the upload is discarded (fail closed).
- **Search lists intake documents** labelled "Intake · {lead}", linking to the intake viewer.

**Trade-offs:**
- (+) One document system; the viewer, flags, email extraction and copies work unchanged
- (+) Conversion moves rows; no files are copied
- (-) Every reader of `Document.matterId` has to handle null
- (-) Copy and move across scopes are refused; there is no lead-to-matter copy
- (-) A streaming upload to a lead that converts mid-request can land on the lead (known, minor)
