# ADR-039: Matter-team access (ethical walls)

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
