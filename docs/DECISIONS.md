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
