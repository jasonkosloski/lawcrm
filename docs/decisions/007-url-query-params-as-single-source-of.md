# ADR-007: URL query params as single source of truth for list filters

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
