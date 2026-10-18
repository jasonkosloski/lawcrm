# ADR-019: Deadline rules + task lists as firm libraries, applied on demand or by AutoApply defaults

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Lead conversion (and the New-matter form) created only the SOL deadline; every other recurring deadline (government-notice periods, response windows, pretrial dates) and every recurring checklist was entered by hand. The roadmap item framed this as per-practice-area conversion logic, but the firm needs the same rules and checklists at other times too — after service, at a stage change, whenever.

**Decision:**
- **Two firm libraries**, decoupled from any trigger: `DeadlineRule` (title, kind, anchor, signed `offsetDays` + the `offsetUnit` it was entered in, citation, notes) and `TaskList` + ordered `TaskListItem`s (priority, assign to lead/unassigned, optional due offset from the apply date). Managed on Settings → Automations under granular `automations.*` keys.
- **Anchors**: `incident_date`, `matter_opened`, `prompt` (asked at apply time), `rule` (another rule's deadline on the same matter). Rule-to-rule links are refused if they'd loop; `anchorRuleId` is ON DELETE RESTRICT, and the delete action explains which rules depend on it.
- **Date math in calendar-day keys** (`src/lib/automations/deadline-plan.ts`, pure): every anchor is a day key — incident dates and deadline dates are UTC-midnight date-only values read with `dateOnlyKey` (ADR-012), "matter opened" is the day in the actor's profile zone — the offset is added in UTC day arithmetic, and the result is written with `parseDateOnly` like every other date-only deadline or task `dueDate`. Due dates are plain calendar days: **no weekend, holiday or court-day adjustment**. Months/years are stored as a signed 365/30 day total (`UNIT_DAYS`, only to keep one integer column) but **applied as calendar months** (`applyOffsetToKey`, ADR-035): "2 years after" is the same calendar date two years on, clamped at month end. The UI shows the amount in the unit it was entered. Offsets are capped at `MAX_OFFSET_DAYS` = 36,500; an overflowing stored offset is reported as unplanned with reason `out_of_range`. (An earlier version of this ADR described server-local midnight dates; that is superseded.)
- **`incident_date` rules resolve only on matters whose practice area tracks a statute of limitations**, because `Matter.incidentDate` is only persisted then. Otherwise a manual apply asks for a date and an automatic apply creates a "Set date: ..." task for the lead.
- **Locking and numbering:** a manual apply takes a per-matter advisory lock (`automation-apply:<matterId>`), and applied task-list items are numbered after the matter's existing tasks.
- **Applying is a separate concern** (`src/lib/automations/apply.ts`, takes a transaction client): manual applies report duplicates (confirm to re-apply) and unresolvable anchors (ask for a date); automatic applies skip duplicates and turn an undatable rule into a "Set date: …" task for the lead — never silently dropped. Generated rows carry provenance (`Deadline.deadlineRuleId`, `Task.taskListId`, both SetNull). Manual apply is gated on the capability exercised (`deadlines.create` / `tasks.create`), not the library keys.
- **Wiring layer**: `AutoApply` rows (`trigger`, nullable `practiceAreaId` = all areas, exactly one of rule/list). The only trigger today is `matter_created`, fired from both creation paths through one `applyAutoDefaults` call inside the creating transaction. New triggers add a value, not a table.
- The pre-existing `Automation` model (JSON steps, never used) is left untouched and unrelated.

**Trade-offs:**
- (+) One library serves conversion, new matters, and any later moment; firms edit rules without a deploy
- (+) Dates can't drift by a day regardless of server/user TZ (pinned by tests in Denver)
- (-) Dates are snapshotted at apply time — moving the trial date doesn't move "30 days before trial" (recalculate-dependents is a follow-up)
- (-) The firm owns the legal periods; the app ships none, so correctness of each rule is a firm configuration responsibility
