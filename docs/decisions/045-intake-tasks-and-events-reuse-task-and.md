# ADR-045: Intake tasks and events reuse Task and CalendarEvent, scoped to a lead until conversion

**Date:** 2026-10-18
**Status:** Accepted

**Context:** After intake notes (ADR-044), intake needed tasks (call back, request records) and events (consultations) before a matter exists, carried onto the matter when the lead converts.

**Decision:**
- **Same tables, at-most-one scope.** `Task.leadId` and `CalendarEvent.leadId` were added. Unlike notes, both models already allow no matter (firm-wide tasks, personal events), so the invariant is at most one of (matterId, leadId). `src/lib/record-scope.ts` holds `RecordScope` (also the note scope type), the both-set check and the revalidation paths.
- **Shared UI.** The task and event composers take a `scope`; the status-grouped task list is `TaskListByStatus`, used by both Tasks tabs. On a lead, sibling captures and the matter-only row actions (log time, add note, convert to deadline) are off; those actions already refuse a task with no matter.
- **Lead events are personal-event-like.** A lead has no team, so the creator is the only default attendee, and visibility and edit rights follow the personal-event rules (creator, attendees, `show_details`; `events.edit_non_matter` to edit someone else's). After conversion the matter team rules apply.
- **Same permissions.** `tasks.*` and `events.*`; no new keys.
- **Visible firm-wide surfaces.** Lead tasks show in "Your tasks", lead events on the calendar, both in search, labelled "Intake · {lead}".

**Trade-offs:**
- (+) One task and one event model; status toggles, editing, Google sync and the calendar work unchanged
- (+) Conversion is two `updateMany`s; nothing is copied
- (-) Teammates who aren't attendees see an intake event as Busy until the lead converts
- (-) Intake notes can't yet capture a task or event from their composer
