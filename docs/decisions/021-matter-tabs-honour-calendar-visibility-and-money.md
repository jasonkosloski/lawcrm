# ADR-021: Matter tabs honour calendar visibility and money-view permissions

**Date:** 2026-10-16
**Status:** Accepted

**Context:** The calendar scrubs events a viewer may not see to "Busy" (`canViewEventDetails`), but the matter Events tab shipped raw titles, notes, locations and time entries to every user, and the Timeline showed settlement and expense amounts to users lacking `matters.settlement.view` / `matters.expense.view`.

**Decision:**
- **Events tab** (`getMatterEvents`): same resolver as the calendar. Rows the viewer can't see become a Busy shell (id + times only; no title, location, zoom link, attendee count, notes or time entries) built server-side, so nothing reaches the RSC payload.
- **Event labels on other tabs**: "From event" chips on Deadlines/Tasks and the event link on Notes go through `eventLabelForViewer`, which returns "Busy" when the resolver says no.
- **Timeline money rows are omitted, not redacted** (`activityMoneyFilters`, now in `src/lib/activity-money-filters.ts` — one rule shared by the Timeline, the dashboard feed and, since 2026-10-17, Settings → Activity, which previously listed settlement/trust/expense amounts to anyone holding `firm.view_activity`): settlement rows (`type = "settlement"`) need `matters.settlement.view`; expense rows (type `filing`, title prefix from `src/lib/expense-activity.ts`, shared with the writer in `expenses.ts`) need `matters.expense.view`. Omitting is simpler than parsing amounts out of free-text titles, and the type counts on the filter pills are filtered identically. Callers that don't pass the flags fail closed.
- **Timeline page** resolves the session itself (`getCurrentUserId`) before reading any feed data.

**Known gaps (follow-ups):**
- Event-attached content on the Notes and Time tabs (a note or time entry whose parent is a hidden event) is matter-wide: the label is scrubbed, the note body / time narrative is not. Matter-level access, not event visibility, governs those tabs today.
- Trust `deposit` rows ("Trust applied to invoice … $amount") are now omitted without `billing.view` (ADR-038).
- Expense activity rows are identified by the title prefix `Expense ` on type `filing` (`src/lib/expense-activity.ts`, shared with the writer in `expenses.ts`, pinned by `matter-detail.test.ts`). A dedicated ActivityLog type plus a backfill is the cleaner follow-up. The Overview WIP figure is computed live; `Matter.wipAmount` is no longer read.
- Session guards now exist on every page (ADR-028), and the dashboard agenda and recent-activity feed apply the Busy scrub and the same money filters (settlement rows need `matters.settlement.view`, `Expense ` rows `matters.expense.view`, `matterId = null` firm-scope rows `firm.view_activity`). Contact and automation edits log with `matterId = null`, so they no longer appear in the dashboard feed for non-privileged users. The query helpers (`listLeads`, `getMatterParties`, `getMatterFlaggedMoments`, `getMatterActivity`, `getDocumentForViewer`, ...) still carry no auth of their own; the page-level guard is the boundary.

**Trade-offs:**
- (+) One privacy rule across calendar, Events tab and event chips
- (-) A viewer with `matters.settlement.view` revoked sees no trace that a settlement exists on the timeline
