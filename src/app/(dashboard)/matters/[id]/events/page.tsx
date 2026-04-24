/**
 * Matter Detail — Events tab
 *
 * Calendar events linked to this matter, split into Upcoming and Past.
 * Each row is expandable: the compact summary opens the event detail
 * modal, while a separate chevron expands an inline Notes thread
 * (list + composer) directly under the row. Modal stays as the
 * deeper view; inline expansion is the friction-free capture path.
 */

import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";
import { EventComposer } from "@/components/matters/captures/event-composer";
import { EventRowExpandable } from "@/components/matters/events/event-row-expandable";
import {
  getMatterEvents,
  type MatterEventRow,
} from "@/lib/queries/matter-detail";
import { getMatterById } from "@/lib/queries/matters";
import {
  getCalendarEventById,
  getEventNotes,
} from "@/lib/queries/calendar";

export default async function MatterEventsPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/events">) {
  const { id } = await params;
  const sp = await searchParams;

  const rawEventParam = Array.isArray(sp.event) ? sp.event[0] : sp.event;
  const eventId = typeof rawEventParam === "string" ? rawEventParam : null;

  const [matter, events, selectedEvent, selectedEventNotes] =
    await Promise.all([
      getMatterById(id),
      getMatterEvents(id),
      eventId ? getCalendarEventById(eventId) : Promise.resolve(null),
      eventId ? getEventNotes(eventId) : Promise.resolve([]),
    ]);

  if (!matter) notFound();

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
        <EventSection
          title="Upcoming"
          events={upcoming}
          matterId={id}
          matterName={matter.name}
        />
      )}
      {past.length > 0 && (
        <EventSection
          title="Past"
          events={past}
          matterId={id}
          matterName={matter.name}
        />
      )}

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} notes={selectedEventNotes} />
      )}
    </div>
  );
}

function EventSection({
  title,
  events,
  matterId,
  matterName,
}: {
  title: string;
  events: MatterEventRow[];
  matterId: string;
  matterName: string;
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
            <EventRowExpandable
              key={event.id}
              event={event}
              matterId={matterId}
              matterName={matterName}
            />
          ))}
        </ul>
      </Card>
    </section>
  );
}
