# ADR-055: Venues are a firm list; required matter fields are per practice area

**Date:** 2026-10-20
**Status:** Accepted

**Context:** `/matters/new` had a free-text "Case location" that only fed the auto-generated matter name and was never stored, so the same court was typed a dozen ways and nothing could be filtered by it. Which intake fields matter also differs by practice area (a PI matter needs an incident date; a contract matter may not), but the form let anything be skipped.

**Decision:**

- No free-text location. A matter points at a firm-managed `Venue` (`Matter.venueId`, `onDelete: Restrict`). Venues are archived, not deleted, once used; archived venues stay on existing matters and drop out of the picker.
- Venue names are unique case-insensitively through `Venue.nameKey`, which includes archived rows. Adding a name that matches an archived venue tells the user to restore it instead of creating a twin.
- Required fields are configured per practice area from a fixed key list (`src/lib/matter-required-fields.ts`). Create checks them on the server, from the area it reads there, before the conflict check (ADR-054). A required incident date applies only when the area tracks the statute of limitations.
- Edit is "can't clear, don't block": a required field that has a value cannot be saved empty; one already empty may stay empty, so tightening an area's rules never makes older matters unsavable. A practice-area change applies the new area's list with the same rule.
- The matter name comes from a template: the area's override, else the firm's. The default template reproduces the old auto-name.
- Venue management has its own keys (`venues.add/edit/delete`), audited as firm-level `settings` rows like practice areas. Picking a venue needs no key beyond creating or editing the matter.

**Trade-offs:**

- (+) One record per court; consistent names; location is queryable later
- (+) Tightening required fields is safe for existing matters
- (-) Matters created before this change have no venue until someone edits them
- (-) A field that was filled and is now required-and-empty on an old matter is only caught when the user tries to clear it, not swept
- (-) Lead → matter conversion does not yet enforce an area's required fields or capture a venue; follow-up tracked in [matters](../features/matters.md)
