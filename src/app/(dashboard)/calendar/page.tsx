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
import { EventAttachmentsProvider } from "@/components/calendar/event-attachments-context";
import { eventTimeEntryDate } from "@/components/calendar/event-dates";
import { CreateStackProvider } from "@/components/create-stack/create-stack-provider";
import { CreateDock } from "@/components/create-stack/create-dock";
import { NewEventButton } from "@/components/calendar/new-event-button";
import {
  calendarDayInTz,
  filterCalendarItems,
  parseCalendarParams,
  toDateParam,
} from "@/lib/calendar-utils";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  calendarMonthGridInTz,
  calendarWeekInTz,
} from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  getCalendarEventById,
  getCalendarItems,
  getEventNotes,
  getEventTimeEntries,
} from "@/lib/queries/calendar";
import { getEventPortalShareProp } from "@/lib/queries/portal-status";
import { getEditableEventIds } from "@/lib/queries/calendar-edit-flags";
import { requireUser } from "@/lib/current-user";
import { firstParam } from "@/lib/search-params";

export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  const userId = await requireUser();
  const sp = await searchParams;

  // Resolve user TZ once and thread it through every calendar
  // surface — including param parsing, whose default focal (first
  // load without ?d=) must be "today" on the user's calendar, not
  // the server's. The week/month range bounds + timed-event bucketing
  // all live in user TZ so a user in MDT viewing "this week" gets
  // Sunday 00:00 MDT through Saturday 23:59 MDT (instead of UTC
  // bounds, which cut off the last 6 hours of Saturday and pull in 6
  // hours from the prior Saturday). Deadlines and all-day events are
  // date-only values and ignore the zone entirely (ADR-012).
  const userTz = await getCurrentUserTimeZone();
  const { view, focal, show } = parseCalendarParams(sp, userTz);
  const week = calendarWeekInTz(focal, userTz);
  const monthGrid = calendarMonthGridInTz(focal, userTz);
  const dayRange = calendarDayInTz(focal, userTz);
  const range =
    view === "week" ? week : view === "month" ? monthGrid : dayRange;

  // Event-detail modal is URL-driven via ?event=<id> so refresh +
  // back-button both work. The modal's queries live in a separate
  // suspense boundary below so the modal streams in after the grid.
  // (Opening an event still re-renders this page — searchParams
  // changed — so the grid's queries re-run; the boundary only keeps
  // the modal's own fetches from blocking the grid.)
  const rawEventParam = firstParam(sp.event);
  const eventId = typeof rawEventParam === "string" ? rawEventParam : null;

  const items = await getCalendarItems(range.rangeStart, range.rangeEnd);

  // Which of the visible events THIS viewer may edit — the same
  // per-event `canEditEvent` resolver the actions enforce (creator
  // bypass, events.edit for matter events, events.edit_non_matter for
  // the rest), not the blanket `events.edit` key. Scrubbed "Busy" rows
  // are never editable. Drives drag/resize; the action still gates
  // server-side regardless.
  const editableEventIds = [
    ...(await getEditableEventIds(
      items
        .filter((i) => i.kind === "event" && i.viewerCanSeeDetails)
        .map((i) => i.id)
    )),
  ];
  const canEditEvents = editableEventIds.length > 0;

  // The top-bar crumb counts come from the rows already fetched
  // (before the `?show=` filter, so the numbers don't change with the
  // lens) instead of three more COUNT queries over the same range.
  const eventCount = items.filter((i) => i.kind === "event").length;
  const deadlineItems = items.filter((i) => i.kind === "deadline");
  const criticalCount = deadlineItems.filter(
    (i) => i.kind === "deadline" && i.deadlineKind === "critical"
  ).length;

  // `?show=deadlines` filters at render — the fetch above is the
  // same single getCalendarItems round-trip either way, so toggling
  // the filter costs nothing extra server-side.
  const visibleItems = filterCalendarItems(items, show);
  const deadlinesOnly = show === "deadlines";

  const crumbBits = [
    `${eventCount} events`,
    `${deadlineItems.length} deadlines`,
    criticalCount > 0 ? `${criticalCount} critical` : null,
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
                editableEventIds={editableEventIds}
                userTz={userTz}
                deadlinesOnly={deadlinesOnly}
              />
            ) : view === "month" ? (
              // Month view needs no layout mode — the filtered
              // items simply omit event pills from the cells.
              <MonthView
                focalKey={toDateParam(focal)}
                days={monthGrid.days}
                items={visibleItems}
                userTz={userTz}
              />
            ) : (
              <DayView
                day={dayRange.day}
                items={visibleItems}
                canEditEvents={canEditEvents}
                editableEventIds={editableEventIds}
                userTz={userTz}
                deadlinesOnly={deadlinesOnly}
              />
            )}
          </div>
          {/* Agenda sits between the main calendar and the create dock,
              so both rails remain visible when a create panel opens and
              the create panel is the rightmost element on the page. It
              streams in on its own so the grid never waits for the
              agenda's second range query. */}
          <Suspense
            fallback={
              <aside className="hidden lg:block w-72 shrink-0 border-l border-line bg-paper-2/30" />
            }
          >
            <CalendarAgenda userTz={userTz} />
          </Suspense>
          <CreateDock />
        </div>
      </div>

      {/* Modal lives in its own suspense boundary so its fetches
          (event, notes, time entries) don't block the calendar grid.
          The modal's own loading state is null — it pops in the
          moment its queries resolve. */}
      {eventId && (
        <Suspense fallback={null}>
          <EventDetailLoader
            eventId={eventId}
            viewerId={userId}
            userTz={userTz}
          />
        </Suspense>
      )}
    </CreateStackProvider>
  );
}

/** Async server component owning the event-detail fetches. Lives
 *  inside a Suspense boundary so its queries stream in after the
 *  calendar grid. Returns null when the eventId points at a missing
 *  row (URL tampering or stale link). */
async function EventDetailLoader({
  eventId,
  viewerId,
  userTz,
}: {
  eventId: string;
  viewerId: string;
  userTz: string;
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
  if (!event.viewerCanSeeDetails) {
    // The "Busy" shell: no notes, no time entries, never editable.
    return (
      <EventDetailModal
        event={event}
        notes={[]}
        timeEntries={[]}
        canEdit={false}
      />
    );
  }
  const [
    notes,
    timeEntries,
    editable,
    canPinNotes,
    canDeleteAnyNote,
    canDeleteAnyTimeEntry,
    portalShare,
  ] = await Promise.all([
    getEventNotes(eventId),
    getEventTimeEntries(eventId),
    getEditableEventIds([eventId]),
    currentUserHasPermission("notes.pin"),
    currentUserHasPermission("notes.delete_any"),
    currentUserHasPermission("time_entries.delete_any"),
    getEventPortalShareProp(eventId, event.matter?.id),
  ]);
  return (
    // The notes / time sections read what the viewer may do from this
    // provider, so they hide pin / delete buttons the server would
    // refuse (a denial redirects to "/" with no message).
    <EventAttachmentsProvider
      viewerId={viewerId}
      canPinNotes={canPinNotes}
      canDeleteAnyNote={canDeleteAnyNote}
      canDeleteAnyTimeEntry={canDeleteAnyTimeEntry}
      defaultTimeEntryDate={eventTimeEntryDate(event, userTz)}
    >
      <EventDetailModal
        event={event}
        notes={notes}
        timeEntries={timeEntries}
        canEdit={editable.has(eventId)}
        portalShare={portalShare}
      />
    </EventAttachmentsProvider>
  );
}
