# ADR-050: Lead conversion re-runs the conflict check and refuses a live conflict

**Date:** 2026-10-18
**Status:** Accepted

**Context:** `convertLeadToMatter` never consulted the conflict check; a lead with a known conflict, or one never checked, could become a matter, and only a timeline entry recorded the gap. The stored `Lead.conflictCheck` can also be stale: a contact flagged as a conflict (ADR-026) or an adverse party added after the last run never reaches it.

**Decision:**

- Conversion re-runs `runConflictMatcher` against the lead's identity at submit time and writes the result back to the lead (unless it is `override`).
- A live `conflict` refuses conversion with a form error. The only way through is the existing override (`overrideLeadConflictCheck`: `intake.conflict_check.override`, justification required).
- A live `warn` (soft directory matches, e.g. a shared name) returns `conflictWarnings: N`; the dialog shows a review tick and the resubmit must carry `conflictWarningsReviewed=true`. No new permission: reviewing soft matches is part of converting (`matters.create`).
- A recorded `override` stands even if the live run now finds a conflict, matching `runLeadConflictCheck`, which never reverts an override.
- The matter timeline records `Converted with conflict check: warn (reviewed)` or `: override` (with the lead id); a plain clear stays silent. Errors and the review prompt carry counts only, never match details (they can name restricted matters; see `conflict-check-redact.ts`).

**Trade-offs:**

- (+) A known or newly arisen conflict can't slip into a matter; stale stored statuses can't wave one through
- (+) Common-name warnings cost one tick, not an override with a justification
- (-) An override granted for an earlier set of matches also covers conflicts that appear later; re-running the check and overriding again is the user's job
- (-) One matcher run (a handful of indexed queries) per conversion attempt
