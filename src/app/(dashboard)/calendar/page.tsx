/**
 * Calendar Page
 *
 * Week view (default) and Month view, both read-only. State lives in
 * the URL: `?view=week|month` and `?d=YYYY-MM-DD`. No external-calendar
 * integration yet — this is the internal view of CalendarEvents +
 * Deadlines stored in the DB.
 *
 * Event creation reuses the same CreateStackProvider + CreateDock
 * pattern as the matter detail pages: the "New event" button opens a
 * docked right-rail panel that can expand to modal, and multiple
 * panels can be open concurrently.
 */

import { TopBar } from "@/components/layout/topbar";
import {
  CalendarToolbar,
  monthGridRange,
  weekRange,
} from "@/components/calendar/calendar-toolbar";
import { WeekView } from "@/components/calendar/week-view";
import { MonthView } from "@/components/calendar/month-view";
import { CalendarAgenda } from "@/components/calendar/calendar-agenda";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";
import { CreateStackProvider } from "@/components/create-stack/create-stack-provider";
import { CreateDock } from "@/components/create-stack/create-dock";
import { NewEventButton } from "@/components/calendar/new-event-button";
import { parseCalendarParams } from "@/lib/calendar-utils";
import {
  getCalendarEventById,
  getCalendarItems,
  getCalendarSummary,
  getEventNotes,
} from "@/lib/queries/calendar";

export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  const sp = await searchParams;
  const { view, focal } = parseCalendarParams(sp);

  const range =
    view === "week" ? weekRange(focal) : monthGridRange(focal);

  // Event-detail modal is URL-driven via ?event=<id> so refresh +
  // back-button both work. We fetch in parallel with the other queries.
  const rawEventParam = Array.isArray(sp.event) ? sp.event[0] : sp.event;
  const eventId = typeof rawEventParam === "string" ? rawEventParam : null;

  const [items, summary, selectedEvent, selectedEventNotes] = await Promise.all(
    [
      getCalendarItems(range.start, range.end),
      getCalendarSummary(range.start, range.end),
      eventId ? getCalendarEventById(eventId) : Promise.resolve(null),
      eventId ? getEventNotes(eventId) : Promise.resolve([]),
    ]
  );

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
        <CalendarToolbar view={view} focal={focal} />
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0 flex flex-col">
            {view === "week" ? (
              <WeekView focal={focal} items={items} />
            ) : (
              <MonthView focal={focal} items={items} />
            )}
          </div>
          {/* Agenda sits between the main calendar and the create dock,
              so both rails remain visible when a create panel opens and
              the create panel is the rightmost element on the page. */}
          <CalendarAgenda />
          <CreateDock />
        </div>
      </div>

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} notes={selectedEventNotes} />
      )}
    </CreateStackProvider>
  );
}
