# Restricted intake (lead ethical walls) — design

**Date:** 2026-10-18 · **Tier:** Full (schema, permissions/visibility, data moving lead → matter)
**Models on:** ADR-039 matter-team walls (`src/lib/matter-access.ts`)

## Goal

An attorney can wall off a sensitive intake so only named people see it.
Everyone else gets the same 404 a missing lead gives, on every surface
(tab pages, downloads, search, Cmd+K, dashboard, time, calendar shows
"Busy"). The wall survives conversion to a matter. Most intake stays a
shared triage pool: walls are opt-in and exceptional.

## Data model

- `Lead.restricted Boolean @default(false)`
- `Matter.restricted Boolean @default(false)`
- `LeadTeamMember { id, leadId, userId, role, addedBy?, createdAt }`,
  `@@unique([leadId, userId])`, `@@index([userId])`; Cascade on lead and
  user delete. `role` uses the matter-team vocabulary
  (lead | co_counsel | paralegal | investigator | of_counsel). Hard
  delete on removal (activity log keeps the history).
- `ActivityLog.leadId String?` + `@@index([leadId])`, relation to Lead
  with `onDelete: SetNull`. Migration backfills it from rows whose
  `detail` starts `lead <id>:` and whose id exists.
- Drop `Expense.leadId` (unwired; lead expenses need `Expense.matterId`
  relaxed, which is a separate money change — roadmap P2 line stays).

## Access rule

**Lead.** Unrestricted → every active user (unchanged). Restricted →
its `LeadTeamMember`s, holders of `intake.view_restricted`, Admins.
Inactive users → nothing.

**Matter.** ADR-039 unchanged, plus: in FIRM mode a restricted matter
is visible only to its active team, `matters.view_all` holders and
Admins. In TEAM mode the flag is moot. `matters.view_all` still sees
restricted matters (billing must invoice them).

**Denial** is `notFound()` / 404, never 403.

**Mutating the wall.** New keys `intake.restrict` (toggle a lead's
flag, manage its team) and `matters.restrict` (toggle a matter's flag
on the Team tab). Restricting auto-adds the actor to the lead team; a
restricted lead keeps ≥1 member; a matter can't be restricted with no
active team member. All logged.

## Module

`src/lib/lead-access.ts` (server-only), shape of `matter-access.ts`:

- `resolveLeadScope(userId)` — `cache()`d: `{ active, all }` where
  `all` = Admin or `intake.view_restricted`.
- `leadAccessWhere(userId): Prisma.LeadWhereInput` — `{}` when `all`;
  match-nothing when inactive; else
  `{ OR: [{ restricted: false }, { teamMembers: { some: { userId } } }] }`.
- `canAccessLead(userId, leadId)`, `assertLeadAccess(leadId)` (404s,
  returns userId; never wrapped in try/catch).

`matter-access.ts`: `resolveScope` keeps FIRM/TEAM; `matterAccessWhere`
in FIRM mode for non-view-all users returns
`{ OR: [{ restricted: false }, { teamMembers: { some: { userId, removedAt: null } } }] }`;
`canAccessMatter` follows the same rule.

Child records: `CHILD_RESOLVERS` return `{ matterId, leadId }`;
`assertChildMatterAccess` asserts lead access when `leadId` is set.
`optionalRecordAccessClause(userId)` for models carrying both
`matterId` and `leadId` (Note, Task, CalendarEvent, TimeEntry,
Document, RecordsRequest): unscoped rows, rows on an accessible matter,
rows on an accessible lead.

## Surfaces

| Surface | Change |
|---|---|
| `intake/[id]/**` pages (12) + layout | `assertLeadAccess(id)` |
| Queue list, summary counts, sidebar badge | `leadAccessWhere` |
| Pipeline report (`reports.view`) | firm-wide counts unchanged (ADR-039 aggregates rule) |
| Child by-id actions (note, task, event, document, folder, flag, time entry) | lead-aware `assertChildMatterAccess` (time entries / flags switch from `assertOptionalMatterAccess(matterId)`) |
| `assertScopeAccess` lead branch | `assertLeadAccess` (folders, records requests, templates, uploads) |
| Lead actions (convert, decline, conflict run/override, `createLead*`) | `assertLeadAccess` after the permission key |
| `/api/documents/[id]/download` | lead branch → `canAccessLead` |
| Search, dashboard tasks, time, calendar, records queries | `optionalRecordAccessClause`; `searchLeads` + Cmd+K leads use `leadAccessWhere` |
| Calendar | events on hidden leads render "Busy", not editable |
| Firm / dashboard activity feed | filter on `ActivityLog.leadId` via `leadAccessWhere` |

**Conflict checks.** The matcher never scans leads (no change).
Run/override require lead access. Hits on restricted matters keep
severity and lose the name via the existing `redactConflictResultForViewer`
(it uses `filterAccessibleMatterIds`, which picks up the matter flag).

**Conversion.** Requires lead access. Inside the transaction: copy
`restricted` to the Matter; each `LeadTeamMember` → `MatterTeamMember`
with its role; the converter is still added as `lead` (an existing
member's role is upgraded only if they are the converter). The lead
keeps its own flag/team.

**Known, accepted gaps** (recorded in the ADR):
- Communication tab threads are matched by email/contact, not lead —
  threads keep existing email rules.
- Contacts that exist only on a walled lead stay findable by name
  (as ADR-039 for hidden matters); `findDeactivationBlockers` still
  counts them.
- Older activity rows that name a lead but lack `lead <id>` in detail
  stay firm-wide.

## UI

- Lead topbar "Access" action (`intake.restrict`): dialog with a
  Restricted switch and, when on, a team picker (active users + role,
  default co_counsel; actor pre-added; last member not removable).
- "Restricted" lock badge in the lead header and its queue row; a
  small Team card on Overview when restricted.
- Convert dialog note for a restricted lead: "Restricted — the matter
  will be restricted to: …".
- Matter Team tab "Restricted" switch (`matters.restrict`); lock badge
  in the matter header.
- Not in scope: restricting from the New intake form.

## Testing

- Unit: `lead-access` (unrestricted / member / non-member / view_restricted
  / Admin / inactive); `matterAccessWhere` + `canAccessMatter` with the flag
  in FIRM and TEAM mode.
- Static: `page-guards.test.ts` requires `assertLeadAccess` in intake
  pages; `matter-access-guards.test.ts` requires a lead guard in lead actions.
- Integration (test DB): non-member 404 on a page, a child by-id action,
  `assertScopeAccess`, the download route; list filters (search, queue,
  dashboard tasks, activity); conversion carries team + flag; restrict
  actions enforce ≥1 member and log.

## Docs

ADR-049 (+ README row); `docs/features/intake.md` (shipped + notes; remove
the "no matter wall on leads" wording); `docs/PERMISSIONS.md` (lead access
section, new keys); `docs/ROADMAP.md` line; `docs/SCHEMA_NOTES.md`
(ActivityLog.leadId backfill, Expense.leadId dropped). Delete this spec and
the plan in the commit that finishes the feature.

## Rollout

The migration is additive except the `Expense.leadId` drop (no code has ever written it). Per ADR-016 the migration is not pushed without the user's go-ahead.
