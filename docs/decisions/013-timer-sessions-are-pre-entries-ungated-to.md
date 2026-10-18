# ADR-013: Timer sessions are pre-entries — ungated to run, gated to log

**Date:** 2026-07-07
**Status:** Accepted

**Context:** The floating timer widget (P1) needed server actions for start / update / discard / stop. Project convention says every gated capability gets a granular permission key — so the question was which of these are actually "capabilities."

**Decision:**
- A `TimerSession` is **private per-user scratch state**, not a billing record: it stores `startedAt` + optional matter/activity and nothing a client is ever billed for. `startTimer` / `updateTimer` / `discardTimer` therefore carry **no permission key** — gating them would only stop a user from watching their own clock.
- `stopTimer` — the one path that writes a `TimeEntry` (`source: "timer"`) — gates on the existing **`time_entries.create`**, same key as every other entry-creating action (`time-entries.ts`, `captures.ts`, `time-on-entity.ts`, `note-attachments.ts`). Denying that single key still closes ALL time-logging entry points, timer included.
- Stop is transactional: TimeEntry create + TimerSession delete in one `$transaction`, so a crash can't both log the time and leave the clock running (double billing on retry). A stop from a stale dialog (session already discarded/stopped in another tab) errors instead of silently double-logging.
- **Rounding convention:** timer-elapsed prefill rounds **UP** to `TIME_ENTRY_INCREMENT_HOURS = 0.25` (quarter-hour — the increment the schema already documents on `TimeEntry.hours`), minimum one increment. The value is a prefill, editable before save; the server re-validates only the normal 0–24h bounds.
- Elapsed is **never stored** — computed from `startedAt` at read time (widget ticks client-side; no polling).
- `startTimer` never silently replaces a running session: it returns `code: "already_running"` unless called with `replace: true`.

**Addendum (2026-10-17):** the "denying `time_entries.create` closes ALL time-logging entry points" claim is now true for the capture paths too. `captures.ts` and `createNote` compute the keys for every sibling kind with `requiredCapturePermissions` and enforce them with `requirePermissions` before any write (ADR-025). Error vs redirect: the primary composers and the bulk-attach action redirect to `/` on denial (`requirePermissions`, like `requirePermission`); the note surfaces pre-check with `missingPermissions` and return a form error so the typed note is kept, with `requirePermissions` as the enforcing backstop. `deleteNote` lets the author delete their own note, but the delete cascades to replies, so when anyone other than the actor replied (any depth) it needs `notes.delete_any` and returns a form error otherwise.

**Trade-offs:**
- (+) One permission key governs all time-entry creation; no new keys to administer
- (+) Timer state can't leak billing data to under-privileged users (there is none to leak)
- (-) A user without `time_entries.create` can run a timer they can never stop-and-log (only discard) — acceptable: the widget is still honest about elapsed time, and granting the key later converts the running session losslessly
