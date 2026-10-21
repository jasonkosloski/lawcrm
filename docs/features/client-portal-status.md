# Client portal: case status

Sub-project 1 of the [client portal](client-portal.md): staff-written status updates and shared calendar events.

### Data and visibility rule
Client-facing status lives only in two portal tables, so isolation is checkable (migration `20261021130000_portal_case_status`, expand-only; grants the four keys below to every role holding `matters.edit`).
- `PortalStatusUpdate`: `stageLabel` (max 60), `body` (plain text, max 4,000), `postedById`, `postedAt`, `editedAt`, `emailedAt`. Newest `postedAt` is the current status. A timeline, not a mapping from the internal matter stage.
- `PortalSharedEvent`: unique `eventId`, `matterId` snapshot, `clientTitle` (max 200), `clientNote` (max 2,000), `sharedById`. Only calendar events on a matter can be shared (not leads, not deadlines). Visible only while `event.matterId` equals the snapshot, so re-filing hides it on both matters. Time and location are read live from the event (reschedules and Google syncs flow through); the internal title and description are never selected for portal reads.
- Nothing is shown automatically; text renders as plain text with line breaks.

### Read gate
`getPortalMatterStatus(identityId, matterId)` in `src/lib/portal/status.ts` returns `{ updates, upcoming, past }` with explicit fields only; `latestStageLabels` feeds the portal home rows. `portalMatterWhere` only checks revocation, so the reader checks portal-on and identity-not-disabled itself; anything else returns empty. Archived matters stay readable. "Upcoming" means the event ends today or later in America/Denver (all-day events compare as UTC-midnight dates, ADR-012).

### Staff side
- Keys `portal.add_updates`, `portal.edit_updates`, `portal.delete_updates`, `portal.share_events`; every action also calls `assertMatterAccess`. Actions in `src/app/actions/portal-status.ts` (`postStatusUpdate`, `editStatusUpdate`, `deleteStatusUpdate`, `shareEventWithClient`, `updateEventShare`, `stopSharingEvent`), Zod-validated, logged, revalidated. Reads in `src/lib/queries/portal-status.ts`.
- "Client status" card on the matter Overview (`portal.view`): latest update, earlier updates, post/edit/delete per key. Post dialog prefills the previous stage label and has an "Email the client" checkbox (default on). The usual "no portal access yet" hint shows when no live access row exists.
- Event detail modal and the matter Events tab: "Share with client" / "Edit share" / "Stop sharing" (`portal.share_events`), a "Shared" badge, client title prefilled from the event title.

### Client UI
Matter page above documents: "Where things stand" (stage chip, note, updated date), earlier updates, "Coming up" (client title, time, location, note), collapsed Past. Home rows show the latest stage label beside the Open/Closed chip.

### Email
Posting with the box ticked and the portal on sends `statusUpdateEmail` through `emailLivePortalUsers` (link to portal home, never the update text) and sets `emailedAt` if any send succeeded; a failure still posts and returns a warning. Editing never re-sends. Sharing an event sends nothing.

### Open risks and deferred items
- Portal time zone is America/Denver (clients have no zone), so "upcoming" and displayed times suit a Denver firm only.
- Sharing an event sends no email; no reminders for shared events.
- Re-sharing records the re-sharer as `sharedById` and resets `sharedAt`.
- A share stays live if the event is later made private (the explicit share wins). Sharing and editing a share require the actor to see the event's details (private or "Busy" events read as not found); stopping a share needs only `portal.share_events` and matter access, so any key holder can withdraw it.
- Deadlines and matter dates cannot be shared; no rich text, attachments or read receipts.
