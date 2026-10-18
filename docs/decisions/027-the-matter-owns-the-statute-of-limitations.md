# ADR-027: The Matter owns the statute of limitations; the SOL Deadline row is a mirror

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The SOL lived in two places: `Matter.statuteOfLimitationsDate` (+ incident date, notes, satisfied flags) and an auto-created `Deadline` (`sourceType = statute_of_limitations`). Either could be edited independently, so the next matter save silently reverted a deadline edit (or vice versa), editing the incident date left a stale statute date, and a deadline delete removed a live statute with no trace. Missing an SOL is malpractice.

**Decision:**
- **Matter fields are authoritative.** The SOL `Deadline` is rewritten from the matter on every save (`syncSolDeadline`); deadline actions refuse to change its due date (`updateDeadline`, tolerating the +/-1 day a browser-local read-back introduces) or delete it (`deleteDeadline`), with an error pointing at the matter edit page. Status changes (complete / reopen / waive) stay allowed on the deadline, and matter saves preserve the row's status and owner. The deadline dialog renders the SOL row read-only; the row menu hides Delete and surfaces action errors.
- **Auto vs manual is inferred, not stored** (no schema change): a stored SOL equal to `computeSolDate(stored incident, stored area period)` (or null) is auto-derived and is recomputed from the posted incident date + the possibly-new area on edit (`resolveEditedSolDate` / `isAutoDerivedSol` in `src/lib/sol.ts`); anything else is a manual override and is kept. The edit form shows the auto value as a live preview and leaves the override input empty unless a real override exists. Clearing the incident date, or switching to an area with no period, keeps the stored date rather than dropping it.
- **Switching to an area without SOL tracking never wipes** the incident date, SOL date/notes or the SOL deadline.
- **Audit:** `createMatter`, `updateMatter` (incl. SOL old -> new) and `setMatterSolSatisfied` write `ActivityLog`; every deadline create/edit/status/delete does too.
- **Audit conventions:** matter mutations log type `filing`, deadline mutations type `deadline`; `logAuditEntry` (`src/lib/audit-entry.ts`, free-string type, field names only in the detail) serves parties, practice-area and calendar-default edits.
- **Lead attorney changes** on the edit form require `matters.manage_team` (same key as `addMatterTeamMember`); the field is locked without it, and the edit page always includes the matter's current client and lead in the option lists even if inactive so a save never detaches them.

**Trade-offs:**
- (+) One place to change the statute; no silent divergence between matter and deadline
- (-) Auto-vs-manual is inferred: a manual date that happens to equal the computed one is treated as auto and will follow later incident/area edits
- (-) ~~The 365/30-day period arithmetic is unchanged~~ Superseded by ADR-035: periods are now calendar amount + unit and computed with calendar arithmetic
