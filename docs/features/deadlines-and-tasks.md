# Deadlines and Tasks: Automations

Firm-level libraries of deadline rules and task lists that can be applied to any matter by hand or fire automatically on matter creation, plus the confirm-before-moving recalculation of dependent deadlines. The matter Deadlines / Tasks / SOL tab features live in [matters.md](matters.md).
Related: [ADR-019](../decisions/019-deadline-rules-task-lists-as-firm-libraries.md), [ADR-040](../decisions/040-dependent-deadlines-are-recalculated-only-after-explicit.md), [ADR-035](../decisions/035-statute-periods-are-calendar-amount-unit-computed.md), [ADR-027](../decisions/027-the-matter-owns-the-statute-of-limitations.md), [PERMISSIONS.md](../PERMISSIONS.md)

## Open work
- [~] **Automations follow-ups** (P2) — core shipped (below). Left: task due dates relative to a deadline; more triggers (stage change); assignment notifications for auto-created tasks.

## Shipped
- [x] **Deadline rules + task lists** (2026-10-16, ADR-019) — Settings -> Automations holds:
  - **Deadline rules**: "N days/months/years after/before" an anchor: incident date, matter opened, a date entered when applied, or another rule's deadline on the same matter. Chains resolve in dependency order; loops are refused on save. The offset displays in the unit it was entered ("182 days" never reads "6 months 2 days"). Month/year offsets are calendar-correct (ADR-035).
  - **Task lists**: ordered items with priority, assign to the matter's lead attorney or nobody, optional due offset from the apply date.
  - **Apply to a matter** from its Deadlines / Tasks tab (gated `deadlines.create` / `tasks.create`; re-applying asks first; an unresolvable anchor asks for the date).
  - **Automatic defaults** (AutoApply rows: rule/list x practice area or all) fire on `matter_created`, from both the New-matter form and lead conversion, inside the creating transaction. Rules that cannot be dated yet become a "Set date: ..." task for the lead instead of being dropped.
  - Generated rows carry provenance (`Deadline.deadlineRuleId`, `Task.taskListId`); every application is activity-logged. Sweep fixes added locking and duplicate-force handling.
  - Keys: `automations.view`, `automations.deadline_rule.*`, `automations.task_list.*`, `automations.defaults.{create,delete}`. The legal periods themselves are firm-entered, not shipped.
- [x] **Lead -> matter conversion v2 automations** (2026-10-16) — delivered via the generic Automations feature rather than per-area code: the firm sets rules/lists as defaults for a practice area (e.g. section 1983 -> CGIA notice rule + intake checklist). Conversion also logs "Converted from lead: <name>" on the matter timeline.
- [x] **Dependent-deadline recalculation** (2026-10-18, ADR-040) — changing a deadline's date (edit dialog) or a matter's incident date (matter edit form) that other rule-generated deadlines count from never moves them silently. The first save writes nothing and shows "Changing ... will change N other deadlines" with each one's old -> new date and what it counts from. The user ticks which to update and saves via "Save and update N deadlines" or "Save, don't change them". Whole chains follow; completed/waived deadlines (and what counts from them) stay put; a hand-set date (`Deadline.dueDateSetManually`) is listed, flagged and unticked by default; unticking a deadline also keeps what counts from it. The server re-plans on the confirmed submit and moves only ticked ids. Each moved deadline is activity-logged with old -> new.

## Notes
- Deadline-approaching / overdue / due-today notices come from the sweep described in [notifications.md](notifications.md).
