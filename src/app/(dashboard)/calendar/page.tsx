/**
 * Calendar Page
 *
 * Week view (default), Month view, and Day view. State lives in the
 * URL: `?view=week|month|day`, `?d=YYYY-MM-DD`, and `?show=deadlines`
 * (the deadlines-only filter — default mixes events + deadlines). No
 * external-calendar integration yet — this is the internal view of
 * CalendarEvents + Deadlines stored in the DB.
 *
 * Event creation reuses the same CreateStackProvider + CreateDock
 * pattern as the matter detail pages: the "New event" button opens a
 * docked right-rail panel that can expand to modal, and multiple
 * panels can be open concurrently.
 */

import { Suspense } from "react";
import { TopBar } from "@/components/layout/topbar";
import { CalendarToolbar } from "@/components/calendar/calendar-toolbar";
import { WeekView } from "@/components/calendar/week-view";
import { MonthView } from "@/components/calendar/month-view";
import { DayView } from "@/components/calendar/day-view";
import { CalendarAgenda } from "@/components/calendar/calendar-agenda";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";
import { CreateStackProvider } from "@/components/create-stack/create-stack-provider";
import { CreateDock } from "@/components/create-stack/create-dock";
import { NewEventButton } from "@/components/calendar/new-event-button";
import {
  calendarDayInTz,
  filterCalendarItems,
  parseCalendarParams,
} from "@/lib/calendar-utils";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  calendarMonthGridInTz,
  calendarWeekInTz} from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  getCalendarEventById,
  getCalendarItems,
  getCalendarSummary,
  getEventNotes,
  getEventTimeEntries,
} from "@/lib/queries/calendar";

export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  const sp = await searchParams;

  // Resolve user TZ once and thread it through every calendar
  // surface — including param parsing, whose default focal (first
  // load without ?d=) must be "today" on the user's calendar, not
  // the server's. The week/month range bounds + bucketing all live
  // in user TZ so a user in MDT viewing "this week" gets Sunday
  // 00:00 MDT through Saturday 23:59 MDT (instead of UTC bounds,
  // which cut off the last 6 hours of Saturday and pull in 6 hours
  // from the prior Saturday).
  const userTz = await getCurrentUserTimeZone();
  const { view, focal, show } = parseCalendarParams(sp, userTz);
  const week = calendarWeekInTz(focal, userTz);
  const monthGrid = calendarMonthGridInTz(focal, userTz);
  const dayRange = calendarDayInTz(focal, userTz);
  const range =
    view === "week" ? week : view === "month" ? monthGrid : dayRange;

  // Event-detail modal is URL-driven via ?event=<id> so refresh +
  // back-button both work. The modal's queries live in a separate
  // suspense boundary below so opening / closing an event doesn't
  // re-await the calendar's own queries — that re-await was firing
  // the calendar `loading.tsx` skeleton on every chip click.
  const rawEventParam = Array.isArray(sp.event) ? sp.event[0] : sp.event;
  const eventId = typeof rawEventParam === "string" ? rawEventParam : null;

  const [items, summary, canEditEvents] = await Promise.all([
    getCalendarItems(range.rangeStart, range.rangeEnd),
    getCalendarSummary(range.rangeStart, range.rangeEnd),
    // Drives whether week-view chips become draggable + drop
    // zones light up. The action itself is gated server-side
    // regardless — this is just the UX affordance.
    currentUserHasPermission("events.edit"),
  ]);

  // `?show=deadlines` filters at render — the fetch above is the
  // same single getCalendarItems round-trip either way, so toggling
  // the filter costs nothing extra server-side.
  const visibleItems = filterCalendarItems(items, show);
  const deadlinesOnly = show === "deadlines";

  const crumbBits = [
    `${summary.events} events`,
    `${summary.deadlines} deadlines`,
    summary.criticalDeadlines > 0
      ? `${summary.criticalDeadlines} critical`
      : null,
  ].filter(Boolean);

  return (
    <CreateStackProvider>
      <TopBar
        title="Calendar"
        crumbs={crumbBits.join(" · ")}
        actions={<NewEventButton />}
      />

      <div className="flex-1 flex flex-col min-h-0 animate-page-enter">
        <CalendarToolbar view={view} focal={focal} show={show} />
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0 flex flex-col">
            {view === "week" ? (
              <WeekView
                days={week.days}
                items={visibleItems}
                canEditEvents={canEditEvents}
                userTz={userTz}
                deadlinesOnly={deadlinesOnly}
              />
            ) : view === "month" ? (
              // Month view needs no layout mode — the filtered
              // items simply omit event pills from the cells.
              <MonthView
                focal={focal}
                days={monthGrid.days}
                items={visibleItems}
                userTz={userTz}
              />
            ) : (
              <DayView
                day={dayRange.day}
                items={visibleItems}
                canEditEvents={canEditEvents}
                userTz={userTz}
                deadlinesOnly={deadlinesOnly}
              />
            )}
          </div>
          {/* Agenda sits between the main calendar and the create dock,
              so both rails remain visible when a create panel opens and
              the create panel is the rightmost element on the page. */}
          <CalendarAgenda />
          <CreateDock />
        </div>
      </div>

      {/* Modal lives in its own suspense boundary so the page's
          calendar queries above don't get re-awaited every time
          the user clicks an event. The modal's own loading state
          is null — the modal pops in the moment its queries
          resolve, which on a primed cache is instant. */}
      {eventId && (
        <Suspense fallback={null}>
          <EventDetailLoader
            eventId={eventId}
            canEdit={canEditEvents}
          />
        </Suspense>
      )}
    </CreateStackProvider>
  );
}

/** Async server component owning the event-detail fetches. Lives
 *  inside a Suspense boundary so its queries don't block the
 *  calendar's render — opening an event no longer re-awaits the
 *  whole page. Returns null when the eventId points at a missing
 *  row (URL tampering or stale link). */
async function EventDetailLoader({
  eventId,
  canEdit,
}: {
  eventId: string;
  canEdit: boolean;
}) {
  // The event must resolve BEFORE notes/time entries are fetched:
  // getCalendarEventById scrubs private events to a "Busy" shell, but
  // getEventNotes/getEventTimeEntries carry no visibility check of
  // their own. Fetching all three in parallel would ship note contents
  // and time-entry narratives for an event the viewer can't see into
  // the RSC payload — the modal declining to render them doesn't help,
  // the data is already in the browser.
  const event = await getCalendarEventById(eventId);
  if (!event) return null;
  const [notes, timeEntries] = event.viewerCanSeeDetails
    ? await Promise.all([getEventNotes(eventId), getEventTimeEntries(eventId)])
    : [[], []];
  return (
    <EventDetailModal
      event={event}
      notes={notes}
      timeEntries={timeEntries}
      canEdit={canEdit}
    />
  );
}
