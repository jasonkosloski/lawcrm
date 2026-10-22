# ADR-040: Dependent deadlines are recalculated only after explicit confirmation

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Deadline rules can count from another rule's deadline or from the incident date (ADR-019), but dates were snapshotted at apply time. Moving a trial date left "motions 30 days before trial" where it was — wrong, with no warning. Moving deadlines automatically would fix that but is itself dangerous: a court date entered by mistake could silently shift a dozen statutory dates, and some dependent dates are deliberately different from what the rule says.

**Decision:**

- **Two-step, always.** The two places a rule's anchor date can change — `updateDeadline` (a deadline's date) and `updateMatter` (the incident date) — first compute what would move (`previewRecalc`). If anything would, they return `status: "confirm"` with the list and **write nothing**. The form shows `CascadeConfirm`; the user resubmits with `cascadeDecision=apply` + the ticked `cascadeId`s, or `skip`.
- **Only ticked deadlines move.** On the confirmed submit the server re-plans from current rows inside the same transaction as the primary save (`applyRecalc`) and moves only deadlines in the selection — never one the user didn't see and tick, even if the plan changed in between. Unticking a deadline also keeps everything counting from it.
- **Planning rules** (`src/lib/automations/recalc-plan.ts`, pure): chains are followed in dependency order; a rule's anchor for its dependents is its newest deadline on the matter (the same one `applyDeadlineRules` counts from); only open/overdue deadlines move, and nothing propagates through a completed/waived one; offsets use `applyOffsetToKey`, so a recalculated date equals a freshly applied one.
- **Hand-set dates are protected, not frozen.** Editing a rule-generated deadline's date sets `Deadline.dueDateSetManually`. Such a deadline still appears in the list when its anchor moves — flagged "changed by hand", unticked by default. Recalculating it clears the marker.
- The primary save keeps its stale-form guard; the recalculation shares its transaction, so a refused save moves nothing.
- Every moved deadline gets its own activity-log row: old → new, what it counts from, and what triggered it.

**Trade-offs:**

- (+) No deadline ever moves without the user seeing old → new and choosing it
- (+) Deliberate exceptions survive (hand-set marker + unticked default)
- (-) One extra round-trip on saves that affect dependents
- (-) Only the two UI paths recalculate; dates changed by other means (data imports, direct DB edits) don't trigger it
- (-) "Matter opened" anchors can't change, and "date entered when applied" anchors aren't stored, so neither triggers a recalculation — the deadlines they produced are themselves the anchors for later rules
