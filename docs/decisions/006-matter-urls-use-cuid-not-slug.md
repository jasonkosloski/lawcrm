# ADR-006: Matter URLs use cuid, not slug

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
