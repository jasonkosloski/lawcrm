# ADR-037: Private calendar events show to their creator only

**Date:** 2026-10-17
**Status:** Accepted (completes ADR-021's calendar model)

**Context:** A per-event `show_details` toggle could only add visibility, and the creator's `defaultEventVisibility = show_details` profile setting exposed every event they create, past and future, with no per-event way to hide one.

**Decision:**

- `CalendarEvent.visibility` (a text column) gains `private`. `canViewEventDetails` returns true for a private event **only to its creator**. Attendees, the matter team, anyone with `events.edit`, and a show-details profile default all see "Busy" with the time range. Private beats every other rule; there is no Admin bypass.
- It works on every read surface because they all use the one resolver: calendar grid and modal, dashboard agenda, matter Events tab and event chips, and global search (a private event never matches or leaks a snippet).
- The matter activity log never records a private event's title (`auditEventTitle` writes "Private event"), since the Timeline is read by every matter viewer.
- Google sync: a private CRM event is pushed with `visibility: "private"`; every other pushed event is sent as `default` (so un-privating resets the Google copy). A Google event marked private is imported as a CRM-private event.
- UI: a "Private event" checkbox on the quick composer, full-page form, matter event capture and the detail modal; mutually exclusive with "Show details to everyone".

**Trade-offs:**

- (+) Gives creators a reliable per-event hide that no profile default can undo
- (-) Invitees see Busy for a private event they were invited to (the creator chose private); use a normal event for invitees
- (-) A colleague with `events.edit` can still move or delete a private event they see as Busy (the edit gate is unchanged)
