# ADR-049: Restricted intake is an opt-in wall with a lead team, carried to the matter

**Date:** 2026-10-19
**Status:** Accepted

**Context:** ADR-039 walled matters by team, but intake had no wall: any signed-in user could open any lead, its documents (the download route returned true for lead documents), records, notes, tasks and time by id. A sensitive intake could not be restricted. Most intake is a shared triage pool, where new web leads have no owner yet.

**Decision:**
- **Opt-in, not team-everywhere.** `Lead.restricted` (default false). An open lead is visible to every active user, as before. A restricted lead and everything on it is visible only to its `LeadTeamMember`s, holders of the new `intake.view_restricted` key, and Admins. A team on every lead was rejected: unassigned new leads would vanish from the queue.
- **One module.** `src/lib/lead-access.ts` mirrors `matter-access.ts`: `leadAccessWhere` (lists), `assertLeadAccess` / `canAccessLead` (details, actions, routes), `filterAccessibleLeadIds`, cached per request. Hidden == missing: 404, never 403.
- **Central routing, not per-call-site checks.** `assertScopeAccess` (lead branch), `assertChildMatterAccess` (child resolvers return `leadId`) and the new `assertRecordAccess({ matterId, leadId })` send lead rows to the lead wall. `optionalRecordAccessClause` replaces `optionalMatterAccessClause` on every model carrying both `matterId` and `leadId` (Note, Task, CalendarEvent, TimeEntry, Document, RecordsRequest, ActivityLog); it ANDs the two scopes, so a row carrying both ids needs both.
- **Where-fragment shape.** Both walls express "unrestricted or on the team" as a single top-level `NOT { restricted, teamMembers: none }`, so callers that spread the fragment into a where with its own `OR` don't clobber it. Both short-circuit to `{}` when no restricted row exists, so firms that never restrict keep today's queries.
- **Matters too.** `Matter.restricted` makes a matter team-only even while `Firm.matterVisibility` is `FIRM`; `matters.view_all` and Admins still see it (billing must invoice it). In TEAM mode it changes nothing. Without it, a restricted lead's wall would vanish at conversion.
- **Conversion carries the wall.** The matter copies `restricted` (re-read after the claim locks the lead row, so a concurrent restrict can't leave it open); every `LeadTeamMember` becomes a `MatterTeamMember` with its role; the converter stays the single lead (another intake `lead` joins as co-counsel). The lead keeps its own flag and team.
- **Managing it.** `intake.restrict` restricts / reopens a lead and manages its team; the actor is auto-added, and a restricted lead keeps at least one member (lead row locked `FOR UPDATE`). `matters.restrict` toggles a matter and needs an active team member. All logged.
- **Activity rows.** `ActivityLog.leadId` lets the feeds filter lead rows; existing firm-scope rows (`matterId` null) were backfilled from `detail` starting `lead <id>:`.
- **Notifications.** A task-assignment ping to someone who can't see the lead names neither the lead nor the task.
- **Calendar.** Events on hidden leads are Busy (`leadAccessible` input to `canViewEventDetails`; the creator still sees their own).
- **Conflict checks** need no change: the matcher never scans leads. Run / override require lead access; hits on restricted matters keep severity and lose the name through the existing redaction.
- **Aggregates** gated by `reports.view` (pipeline stage counts) stay firm-wide, as in ADR-039.
- `Expense.leadId` (never written) was dropped; lead expenses would need `Expense.matterId` relaxed, a separate money change.

**Trade-offs:**
- (+) A sensitive intake can be walled in one click, and the wall survives conversion; nothing changes for firms that never use it
- (+) Lead children are walled through the same helpers the matter wall already uses, enforced by the static guard tests (`page-guards.test.ts`, `matter-access-guards.test.ts` lead rule)
- (-) The Communication tab matches threads by email/contact, not lead: a walled lead's emails follow the ordinary mailbox rules
- (-) A contact that exists only on a walled lead stays findable by name in the directory (as ADR-039 accepted for hidden matters); `findDeactivationBlockers` still counts it
- (-) Older activity rows that name a lead without `lead <id>:` in detail stay firm-wide
