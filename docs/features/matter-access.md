# Matter-team access (ethical walls)

Matters are visible only to active team members, holders of `matters.view_all`, and everyone when the firm switch is "Everyone" (default) unless the matter is restricted. Detail lives in the ADR and permissions doc; this file only tracks status.
Related: [ADR-039](../decisions/039-matter-team-access-ethical-walls.md), [ADR-049](../decisions/049-restricted-intake-is-an-opt-in-wall-carried-to-the-matter.md), [PERMISSIONS.md](../PERMISSIONS.md)

## Shipped
- [x] **Matter-team access / ethical walls (ADR-039)** (2026-10-17) — `matters.view_all` key; `src/lib/matter-access.ts`; admin-only Settings page with the Firm switch ("Everyone / Team only", logged) and a thin-teams roster list. Enforced on the matters list/kanban/counts, matter pages, sidebar, search, command palette, dashboard, contacts, calendar (Busy), time, reports rows, document/attachment downloads, invoice print, uploads and every matter-scoped server action. Trust column gated by `billing.view`; Busy-only viewers cannot edit private events.

- [x] **Restricted matters (ADR-049)** (2026-10-19) — `Matter.restricted` keeps a matter team-only even in "Everyone" mode (view-all holders and Admins still see it); toggled on the matter edit page with `matters.restrict` (needs an active team member), inherited from a restricted lead on conversion; lock badge in the header.

## Notes
- Before flipping to Team only, grant `matters.view_all` to billing/office roles.
- Intake has its own opt-in wall (restricted leads, `src/lib/lead-access.ts`); see [intake](intake.md) and ADR-049.
