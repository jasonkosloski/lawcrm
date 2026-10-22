# Search

Global text search across the app: `/search?q=` results page plus a "Search everywhere" row in the command palette. ILIKE v1 by design; Postgres full-text search is the upgrade path.
Related: [ADR-014](../decisions/014-global-search-is-ilike-v1-inheriting-each.md), [ADR-037](../decisions/037-private-calendar-events-show-to-their-creator.md), [ADR-039](../decisions/039-matter-team-access-ethical-walls.md)

## Open work

- [~] **Search follow-ups** (P1) — shipped (below); left: within-list keyword filters, and the Postgres FTS upgrade when ILIKE stops scaling. OCR text feeding search is tracked in [documents.md](documents.md).

## Shipped

- [x] **Global text search** (2026-07-07) — `globalSearch(q)` in `src/lib/queries/search.ts`: one parallel ILIKE batch across matters, contacts (active, unmerged), leads, notes (HTML matched, tag-stripped snippets), documents, transcript segments (completed only, via the Document scope; hit links to the viewer at `?t=`), tasks, deadlines, calendar events, email threads/messages, messenger items and time entries. No new permission keys: search inherits each entity's read model.
  - Calendar events pass through the same `canViewEventDetails` scrub as the calendar, so private events never match or leak.
  - Privileged time narratives match only for their author. Email results are scoped to the viewer's OWN mailbox.
  - Matter-team access (ADR-039) applies to results.
- [x] **Results page** — `/search?q=` grouped by type with highlighted snippets, counts, and per-group `?type=` expansion; the command palette has an always-last "Search everywhere" row.
- [x] **Saved searches** (2026-07-07) — per-user `SavedSearch` rows: a save toggle next to the query input (captures the active `?type=` scope, dedupes on (q, scope), un-saves when already saved) and a "Saved" chip strip with kebab rename/delete. Identity-scoped actions in `src/app/actions/saved-searches.ts` with no permission key (notifications precedent); about 50 rows per user.
