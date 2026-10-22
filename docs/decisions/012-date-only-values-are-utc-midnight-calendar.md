# ADR-012: Date-only values are UTC-midnight calendar dates; instants display in the user's profile zone

**Date:** 2026-07-07 · **Revised:** 2026-10-16
**Status:** Accepted (revised)

**Context:** The P2 timezone sweep surfaced two recurring bug classes: (1) date-only inputs (`<input type="date">` → `"YYYY-MM-DD"`) fed to `new Date(value)` parse as UTC midnight while local getters read them back, so round-tripping forms drifted dates a day per save; (2) "today" boundaries computed with server-local `startOfToday()` misclassified items for users whose calendar day differs from the server's (always, on a UTC production box).

The original decision stored date-only values at **server-local** midnight and displayed them on the server's day grid. That frame only exists on the server: production runs in UTC, developers' laptops in Denver, and browsers wherever the user is. The 2026-10-16 review found it at the root of a whole class of production bugs — client components read the UTC-midnight values with browser-local getters (edit dialogs prefilled the day before, so every save moved deadlines, tasks, time entries and invoice lines a day earlier), calendar and dashboard views bucketed due dates as instants, "overdue" fired on the due date, and `datetime-local` values were parsed in the server's zone, storing events and calls 6–7 hours off. The suite passed in every zone because tests never separate the server's frame from the browser's.

**Decision:**

- **Date-only values** (Task/Deadline `dueDate`; TimeEntry / Expense / TrustTransaction / InvoicePayment `date`; Firm `establishedAt`; Matter `incidentDate` / `statuteOfLimitationsDate`; all-day event bounds; automation-generated `dueDate`s) are calendar dates, **stored at UTC midnight** and **always read in UTC**. No time zone — the viewer's, the browser's or the server's — is ever applied to them. Helpers in `src/lib/format-date.ts`:
  - write: `parseDateOnly("YYYY-MM-DD")` (null on malformed or impossible dates → field error, never an Invalid Date 500)
  - read: `dateOnlyKey(d)` → `"YYYY-MM-DD"`; display: `formatDateOnly(d, variant)` — identical on server and client; never the zone-less `formatDate`
  - "today"/overdue: `daysUntilDateOnly(d, tz)` against `todayKey(tz)`; never compare a date-only value to `new Date()`
  - queries: `{ dueDate: dateOnlyRange(firstKey, lastKey) }` (half-open UTC midnights)
  - **Client components never convert a date-only value to a `Date` in the browser.** Servers hand dialogs `dateOnlyKey` strings; date inputs are seeded from those keys and "today" from `todayKey(useUserTimeZone())`.
- **Instants** (event start/end, call `occurredAt`, timestamps) are real UTC moments, displayed in the user's **profile** zone: server code passes `getCurrentUserTimeZone()` to `formatDate(d, variant, tz)`; client components get the same zone from `useUserTimeZone()` (provided by the dashboard layout). Client components must NOT use browser-local getters (`getDate`, `getHours`, `toLocaleString` without a zone) for either kind: they server-render on the UTC host, so a browser-zone read disagrees with the server render and hydrates differently. (An earlier wording of this ADR allowed "browser-local after hydration"; that is withdrawn.)
- **Wall-clock input** (`<input type="datetime-local">`): parse on the server with `parseWallClock(value, await getCurrentUserTimeZone())`; prefill with `toWallClockInput(instant, tz)`. Never `new Date(naiveString)`. This covers calendar event forms, event captures from notes, and manual call logging (`parseCallOccurredAt`). Calendar clients take timed schedule values as the profile-zone wall clock and all-day values as date-only keys (`src/lib/event-schedule.ts`; grid math is zone-aware in `src/components/calendar/grid-time.ts`).
- **All-day events** are date-only (`parseDateOnly`, UTC midnight, including all-day events pulled from Google and pushed back with day-key math). Calendar queries match deadlines and all-day events by day keys and timed events by overlap; `eventDayKeys` buckets multi-day events.
- **Follow-ups** (`followUpAt` on email and messenger threads) are stored as day-end values and treated as calendar days: read with `dateOnlyKey` and compared as day keys, not instants. The inbox filter and the dashboard must agree on that rule.
- **Firm** `establishedAt` is date-only (`parseDateOnly` / `dateOnlyKey` / `formatDateOnly`).
- `parseLocalDate`, `parseLocalDateOrDateTime` and `parseLocalEstablishedAt` **have been removed**; no caller remains. Use the helpers above.

**Known unrepaired data:** rows saved before the fix — timed events and call times stored hours off for non-UTC users, all-day events stored at server-local midnight — are not auto-corrected. Call `occurredAt` rows logged before the change are stored shifted for non-UTC users.

**Compatibility:** No data migration. Production rows were written by `parseLocalDate` on a UTC host, i.e. already at UTC midnight. Rows written on a dev laptop sit at Denver midnight (06:00/07:00Z) — still inside the right UTC day, so UTC reads and half-open UTC day ranges place them correctly.

**Testing:** run date work in both zones — `npm test` (developer's zone) and `npm run test:utc` (production's). A client-component test that renders a UTC-midnight value catches browser-local reads when run west of UTC.

**Trade-offs:**

- (+) One frame per kind of value, identical on every machine; parse and display can no longer disagree
- (+) The Matter incident/SOL dates' UTC convention (previously an exception) is now the rule
- (-) Date-only values are still `DateTime` columns; a true `DATE` column would express intent better (revisit with a migration)
- (-) Client components that show instants need the zone threaded through context (`useUserTimeZone`)
