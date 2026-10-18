# ADR-014: Global search is ILIKE v1, inheriting each entity's read model — Postgres FTS is the upgrade path

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
