# ADR-025: Captures do not inherit the primary's permission gate - every record kind clears its own create key

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Notes and the primary composers (task / event / deadline / time) can carry sibling captures that create other record kinds in the same transaction. Each entry point used to gate only on the primary's key, so a role holding just `notes.create` could mint tasks, deadlines, events or billable time entries through a note's attachments, bypassing the specific keys (and ADR-013's "denying `time_entries.create` closes every time-logging entry point").

**Decision:**

- The set of required keys is computed from the capture list BEFORE any write (`requiredCapturePermissions`, `src/lib/capture-permissions.ts`) and enforced with `requirePermissions` (`src/lib/permission-check.ts`): `tasks.create`, `events.create`, `deadlines.create`, `time_entries.create`, `notes.create`, plus `notes.pin` when a primary note or sibling note is pinned.
- The same helper backs `createNote`, the primary composers in `captures.ts` and the bulk-attach action, so no surface can drift.
- Deleting a note cascades to its replies, so when anyone other than the actor replied (any depth) the delete needs `notes.delete_any` even for the author.
- Event records minted through captures behave like the calendar create path: `createdById`, default attendees (`src/lib/calendar-default-attendees.ts`) and a post-commit Google Calendar push.

**Trade-offs:**

- (+) One key per capability holds regardless of which composer carried it
- (+) Denial happens before any write, so there is no partial thread to clean up
- (-) On the primary composers and bulk attach a denial redirects to `/`, so a draft carrying an attachment the user may not create is lost. The note surfaces (`createNote`) pre-check with `missingPermissions` and return a form error instead, keeping the draft. `getCaptureAccess` / `getNoteAccess` now hide capture kinds and Pin per viewer on the Notes tab; the create dock's note panel still defaults `canPin` to true (follow-up: pass `allowedKinds` and `canPin`).
- (-) Keys are plain strings (no `PermissionKey` union exists); `capture-permissions.test.ts` asserts every mapped key is known to `isKnownPermission`
