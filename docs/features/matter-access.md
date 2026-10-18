# Matter-team access (ethical walls)

Matters are visible only to active team members, holders of `matters.view_all`, and everyone when the firm switch is "Everyone" (default). Detail lives in the ADR and permissions doc; this file only tracks status.
Related: [ADR-039](../decisions/039-matter-team-access-ethical-walls.md), [PERMISSIONS.md](../PERMISSIONS.md)

## Shipped
- [x] **Matter-team access / ethical walls (ADR-039)** (2026-10-17) — `matters.view_all` key; `src/lib/matter-access.ts`; admin-only Settings page with the Firm switch ("Everyone / Team only", logged) and a thin-teams roster list. Enforced on the matters list/kanban/counts, matter pages, sidebar, search, command palette, dashboard, contacts, calendar (Busy), time, reports rows, document/attachment downloads, invoice print, uploads and every matter-scoped server action. Trust column gated by `billing.view`; Busy-only viewers cannot edit private events.

## Notes
- Before flipping to Team only, grant `matters.view_all` to billing/office roles.
- Leads have no team, so intake records are not walled (lead-scoped notes, tasks, events, documents and requests use the normal permission keys).
