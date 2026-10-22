# ADR-009: Sortable column headers use asc → desc → clear cycle

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
