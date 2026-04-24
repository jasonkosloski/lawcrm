/**
 * Matter Detail — Events tab
 *
 * Calendar events linked to this matter, split into Upcoming and Past.
 * Click an event to open the same EventDetailModal used on the
 * calendar page (via the `?event=<id>` URL contract).
 */

import { format, isSameDay } from "date-fns";
import { Card } from "@/components/ui/card";
import { EventLink } from "@/components/calendar/event-link";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";
import { EventComposer } from "@/components/matters/captures/event-composer";
import {
  getMatterEvents,
  type MatterEventRow,
} from "@/lib/queries/matter-detail";
import { getCalendarEventById, getEventNotes } from "@/lib/queries/calendar";

const TYPE_LABEL: Record<string, string> = {
  meeting: "Meeting",
  deposition: "Deposition",
  hearing: "Hearing",
  intake: "Intake",
  block_time: "Block time",
  mediation: "Mediation",
  trial: "Trial",
};

export default async function MatterEventsPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/events">) {
  const { id } = await params;
  const sp = await searchParams;

  const rawEventParam = Array.isArray(sp.event) ? sp.event[0] : sp.event;
  const eventId = typeof rawEventParam === "string" ? rawEventParam : null;

  const [events, selectedEvent, selectedEventNotes] = await Promise.all([
    getMatterEvents(id),
    eventId ? getCalendarEventById(eventId) : Promise.resolve(null),
    eventId ? getEventNotes(eventId) : Promise.resolve([]),
  ]);

  const upcoming = events.filter((e) => e.isUpcoming);
  const past = events.filter((e) => !e.isUpcoming).reverse(); // most recent first

  return (
    <div className="p-5 flex flex-col gap-5">
      <EventComposer matterId={id} />

      {events.length === 0 ? (
        <div className="text-xs text-ink-4 text-center py-6">
          No events yet — schedule one above.
        </div>
      ) : null}

      {upcoming.length > 0 && (
        <EventSection title="Upcoming" events={upcoming} />
      )}
      {past.length > 0 && <EventSection title="Past" events={past} />}

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} notes={selectedEventNotes} />
      )}
    </div>
  );
}

function EventSection({
  title,
  events,
}: {
  title: string;
  events: MatterEventRow[];
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {title}
        </h2>
        <span className="text-2xs font-mono text-ink-4">{events.length}</span>
      </div>
      <Card className="p-0 overflow-hidden">
        <ul className="divide-y divide-line">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function EventRow({ event }: { event: MatterEventRow }) {
  const timeLabel = event.isAllDay
    ? "All day"
    : isSameDay(event.startTime, event.endTime)
      ? `${format(event.startTime, "h:mm a")} – ${format(event.endTime, "h:mm a")}`
      : `${format(event.startTime, "MMM d, h:mm a")} – ${format(event.endTime, "MMM d, h:mm a")}`;

  return (
    <li>
      <EventLink eventId={event.id} className="block">
        <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-tint transition-colors cursor-pointer">
          <span
            className="w-1 self-stretch rounded-full shrink-0"
            style={{ background: event.color }}
          />
          <div className="flex flex-col leading-tight w-28 shrink-0">
            <span className="text-xs font-medium text-ink">
              {format(event.startTime, "EEE, MMM d")}
            </span>
            <span className="text-2xs font-mono text-ink-4">{timeLabel}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-ink truncate">
              {event.title}
            </div>
            {event.location && (
              <div className="text-2xs text-ink-3 truncate">
                {event.location}
              </div>
            )}
          </div>
          <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line shrink-0">
            {TYPE_LABEL[event.type] ?? event.type}
          </span>
          {event.attendeeCount > 0 && (
            <span className="text-2xs font-mono text-ink-4 shrink-0">
              {event.attendeeCount}{" "}
              {event.attendeeCount === 1 ? "attendee" : "attendees"}
            </span>
          )}
        </div>
      </EventLink>
    </li>
  );
}
