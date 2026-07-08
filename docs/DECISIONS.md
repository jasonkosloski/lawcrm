# Architectural Decision Records

Each decision is numbered and immutable once written. If we reverse a decision, we add a new ADR that supersedes it.

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

## ADR-012: Two date storage conventions — date-only at local midnight, instants in user TZ

**Date:** 2026-07-07
**Status:** Accepted

**Context:** The P2 timezone sweep surfaced two recurring bug classes: (1) date-only inputs (`<input type="date">` → `"YYYY-MM-DD"`) fed to `new Date(value)` parse as **UTC midnight**, so any viewer/server west of UTC reads the day back one earlier — and round-tripping forms drift the date a day per save; (2) "today" boundaries computed with server-local `startOfToday()` misclassify agenda/tasks/deadlines for any user whose calendar day differs from the server's (always, in a UTC production box).

**Decision:**
- **Date-only fields** (Task/Deadline `dueDate`, TimeEntry/Expense/TrustTransaction/InvoicePayment `date`, Firm `establishedAt`) store **server-local midnight** of the picked calendar day, parsed via the shared `parseLocalDate` (`src/lib/format-date.ts`). Display uses `formatDate` **without** a TZ override so the same server-local day grid renders back. Malformed input returns a field error, never an Invalid Date 500. Capture schemas enforce `YYYY-MM-DD` shape so transaction loops can parse non-null.
- **Instants** (event start/end, createdAt-style timestamps) stay real UTC moments; display threads the viewer's IANA zone (`getCurrentUserTimeZone` → `formatDate(d, variant, tz)`) on server-rendered surfaces. Client components fall back to browser-local (already the user's zone after hydration).
- **"Today" queries** (dashboard) resolve the user's calendar date via `dateKeyInTz`, then either round-trip it to server-local midnight (for date-only columns) or take true day bounds via `instantInTz` (for instant columns) — same approach the calendar's `parseCalendarParams` fix established.

**Exception:** Matter `incidentDate` / `statuteOfLimitationsDate` keep their pre-existing **UTC-midnight** convention — parsing (`actions/matters.ts`), SOL math (`daysUntil`), and display (`formatCalendarDate`, UTC-anchored) are self-consistent and pinned by `sol.test.ts`. Migrating them means touching stored rows; deferred until a data migration is worth it.

**Trade-offs:**
- (+) One shared parser + one shared formatter family; drift bugs become impossible at new callsites by convention
- (+) Correct on a UTC production host AND on local dev (any zone), since parse/format use the same frame
- (-) Date-only values are still `DateTime` columns; a true `DATE` column type would express intent better (revisit with a migration)
- (-) A user whose TZ differs from the *server's* still sees date-only values on the server's day grid — acceptable because the value has no instant semantics; the day label always matches what was typed

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
- **No new permission keys.** Search inherits each entity's existing read model: calendar events run through the same `canViewEventDetails` resolver as the calendar (scrubbed BEFORE snippets are built), privileged time-entry narratives match only for their author, merged/inactive contacts are excluded. A search surface must never widen visibility.
- **Documented approximations:** per-type totals for events (JS-resolver visibility, 200-row candidate window) and notes (markup-only matches dropped post-fetch) are upper bounds, noted in code.

**Trade-offs:**
- (+) Shipped with zero infra; authz posture is provably no-wider-than-existing surfaces
- (+) Swap to FTS is contained in one file
- (-) Leading-wildcard ILIKE can't use btree indexes — full scans on big tables (acceptable now, the trigger to revisit)
- (-) No relevance ranking; results are grouped by type, recency-ordered within type

## ADR-015: Driver-based document storage — local disk in dev, Vercel Blob (client-direct + 302 serving) in prod

**Date:** 2026-07-07
**Status:** Accepted

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
