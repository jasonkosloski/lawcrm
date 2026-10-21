# Client portal: case status (sub-project 1) design

Tier: Full (schema, portal visibility, new permission keys).

## Goal
A client opens the portal and sees, in plain words, where their matter stands, what happens next, and the dates that involve them, without calling the firm. Everything a client sees is written or chosen by staff; nothing internal is shown automatically.

Decided with the user (2026-10-20):
- Staff-written updates, not a mapping from the internal matter stage.
- A dated timeline of updates; the newest is the current status.
- Per-post "Email the client" checkbox, on by default.
- Only calendar events can be shared (deadlines stay internal), each with a client-facing title.
- Event location may be shown to clients.

## Data (approach A: separate portal tables)
Client-facing data lives only in portal tables, so isolation is checkable: a field not in these tables (or the narrow event select below) can't reach a client.

`PortalStatusUpdate` (`portal_status_updates`)
- `id`, `matterId` (FK Matter, onDelete Cascade), `stageLabel` (String, max 60), `body` (String, max 4,000, plain text), `postedById` (FK User), `postedAt` (default now), `editedAt?`, `emailedAt?`.
- Index `(matterId, postedAt)`. Newest by `postedAt` is the current status.

`PortalSharedEvent` (`portal_shared_events`)
- `id`, `eventId` (FK CalendarEvent, unique, onDelete Cascade), `matterId` (FK Matter, onDelete Cascade; snapshot of the event's matter at share time), `clientTitle` (max 200), `clientNote?` (max 2,000, plain text), `sharedById` (FK User), `sharedAt`, `updatedAt`.
- Index `(matterId)`.
- Visible only while `event.matterId = share.matterId`. Re-filing the event to another matter (or unfiling it) hides it, so it never surfaces in a different matter's portal. Lead events (`matterId` null) can't be shared.
- Time and location are read live from the event (`startTime`, `endTime`, `isAllDay`, `location`), so reschedules, including Google-synced ones, flow through. The internal `title` and `description` are never selected for portal reads.

Migration: create both tables and grant `portal.add_updates`, `portal.edit_updates`, `portal.delete_updates`, `portal.share_events` to every role holding `matters.edit` (same pattern as `20261019090000_client_portal_foundation`). Expand-only (ADR-058).

## Permissions
New keys in the portal group of `src/lib/permissions.ts`:
- `portal.add_updates`: post a status update.
- `portal.edit_updates`: edit a posted update (marks it edited; never re-emails).
- `portal.delete_updates`: delete an update.
- `portal.share_events`: share, edit the share of, or stop sharing a calendar event.

All staff actions also require matter access (`assertMatterAccess`). Reading the staff-side block needs `portal.view` + matter access.

## Client reads
One reader, `getPortalMatterStatus(identity, matterId)` in `src/lib/portal/`, gated exactly like documents: live `PortalMatterAccess`, portal on, identity enabled. Anything else is a bare not-found. Returns `{ updates: [...newest first], upcoming: [...], past: [...] }` with only portal-table fields and the narrow event fields. "Upcoming" means the event ends today or later in America/Denver (the existing portal zone caveat); past events are collapsed.

Archived (closed) matters stay readable, matching documents. Revoke or portal-off hides everything immediately because every read goes through the gate.

## Staff UI
Matter Overview → Portal card gets a **Client status** block (behind `portal.view`):
- Latest update (stage chip, note, posted date and author, "edited" marker) plus "N earlier" disclosure.
- **Post update** dialog: stage label (prefilled from the previous update), "What's next" note, "Email the client about this update" checkbox (default on). Hidden without `portal.add_updates`.
- Per-update menu: Edit (`portal.edit_updates`), Delete (`portal.delete_updates`).
- Reuses the "No one has portal access on this matter yet." hint when no live access row exists.

Event menus (calendar event detail and the matter Events tab), matter events only, with `portal.share_events`:
- **Share with client…** dialog: client title (prefilled from the event title, editable), optional client note.
- Shared events show a "Shared" badge; menu offers **Edit share** and **Stop sharing**.

Actions in `src/app/actions/portal-status.ts`: `postStatusUpdate`, `editStatusUpdate`, `deleteStatusUpdate`, `shareEventWithClient`, `updateEventShare`, `stopSharingEvent`. Each `requirePermission` + scope check, Zod-validated, `logActivity`, `revalidatePath` for the matter overview, events tab and calendar.

## Client UI
Portal matter page `/matters/[id]`, above documents:
- **Where things stand**: stage chip, note, "Updated <date>". **Earlier updates** list below, newest first.
- **Coming up**: shared events ordered by start time with client title, date/time, location, note. Collapsed **Past** list.
- Empty states: "Your legal team hasn't posted an update yet." / nothing rendered for events when none are shared.
- Portal home: each matter row shows its latest stage label beside the Open/Closed chip.
- Text is rendered as text (no HTML), line breaks preserved.

## Email
`statusUpdateEmail` sent via `emailLivePortalUsers` when the checkbox is ticked and the portal is on; sets `emailedAt`. Body says an update was posted and links to the portal matter page; it never includes the update text (email isn't a secure channel). Editing never re-sends. Sharing an event sends nothing in this sub-project.

## Out of scope
Messages (sub-project 3, separate spec), sharing deadlines or matter dates, reminder emails for shared events, rich text, attachments on updates, client read receipts.

## Testing
- Reader integration tests: live access sees updates/events; revoked access, portal off and disabled identity get nothing; an event re-filed to another matter is hidden on both matters; a lead event can't be shared; result never contains the internal event title or description.
- Action tests per key (denied without it), matter-access denial on a walled matter, validation limits, email sent vs. skipped (portal off / unticked), `emailedAt` set, edit doesn't re-email, activity rows.
- Migration verified by `npm run check:migrations` (the repo has no grant-test pattern; prior grant migrations are untested SQL).
- Render tests for the portal section (with and without data) and the staff dialogs.

## Docs on ship
`docs/features/client-portal.md` (sub-project 1 shipped, end state), its ROADMAP line, PERMISSIONS only if conventions change. Delete this spec and its plan in the finishing commit.
