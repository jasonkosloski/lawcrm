/**
 * Lead Detail — Events tab
 *
 * Calendar events on an intake lead (`CalendarEvent.leadId`) —
 * consultations, intake calls, meetings with the prospective client —
 * split into Upcoming and Past. Same composer as the matter Events tab
 * (no sibling captures) and the same `?event=<id>` contract for the
 * event detail modal. Rows are compact links rather than the matter
 * tab's expandable rows: an event's inline notes and time are matter
 * records, and a lead has none.
 *
 * Visibility follows the personal-event rules (a lead has no team):
 * the creator, attendees and `show_details` events show in full,
 * everyone else sees "Busy". Lead events are on the firm calendar too.
 * On conversion they re-home onto the new matter.
 */

import Link from "next/link";
import { Briefcase, CalendarDays, MapPin } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";
import { EventComposer } from "@/components/matters/captures/event-composer";
import { requireUser } from "@/lib/current-user";
import { assertLeadAccess } from "@/lib/lead-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";
import {
  getLeadEvents,
  type MatterEventRow,
} from "@/lib/queries/matter-detail";
import {
  getCalendarEventById,
  getEventNotes,
  getEventTimeEntries,
} from "@/lib/queries/calendar";
import { EVENT_TYPE_LABEL } from "@/lib/constants/calendar-event-type";
import {
  dateKeyInTz,
  formatDate,
  formatDateOnly,
} from "@/lib/format-date";

export default async function LeadEventsPage({
  params,
  searchParams,
}: PageProps<"/intake/[id]/events">) {
  // Pages guard themselves: layouts don't re-run on soft navigation (ADR-028).
  await requireUser();
  const { id } = await params;
  await assertLeadAccess(id);
  const sp = await searchParams;
  const rawEventParam = Array.isArray(sp.event) ? sp.event[0] : sp.event;
  const requestedEventId =
    typeof rawEventParam === "string" ? rawEventParam : null;

  const tz = await getCurrentUserTimeZone();
  const [lead, events, canCreateEvent] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      select: { stage: true, convertedMatterId: true },
    }),
    getLeadEvents(id, { tz }),
    // The composer's action requires events.create and redirects
    // denied users to "/" (discarding the form) — don't offer it.
    currentUserHasPermission("events.create"),
  ]);
  // The layout notFound()s missing leads.
  if (!lead) return null;
  const isConverted = lead.stage === "converted";

  // Only open the modal for an event on THIS lead (stale or tampered
  // ?event= ids are ignored — the matter Events tab's guard). The event
  // resolves before its notes / time: getCalendarEventById scrubs a
  // Busy event, and the other two have no visibility check of their own.
  const eventId =
    requestedEventId && events.some((e) => e.id === requestedEventId)
      ? requestedEventId
      : null;
  const selectedEvent = eventId ? await getCalendarEventById(eventId) : null;
  const [selectedEventNotes, selectedEventTime] =
    selectedEvent?.viewerCanSeeDetails && eventId
      ? await Promise.all([getEventNotes(eventId), getEventTimeEntries(eventId)])
      : [[], []];

  const upcoming = events.filter((e) => e.isUpcoming);
  const past = events.filter((e) => !e.isUpcoming).reverse(); // most recent first

  return (
    <div className="p-5 flex flex-col gap-5">
      {isConverted ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-2 px-3 py-2.5">
          <p className="text-xs text-ink-3">
            This lead converted — its intake events were carried forward to
            the matter. Schedule new events there.
          </p>
          {lead.convertedMatterId && (
            <Link
              href={`/matters/${lead.convertedMatterId}/events`}
              className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand-700 hover:underline"
            >
              <Briefcase size={13} />
              Open matter events
            </Link>
          )}
        </div>
      ) : (
        canCreateEvent && (
          <EventComposer scope={{ kind: "lead", leadId: id }} siblingKinds={[]} />
        )
      )}

      {events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No intake events yet"
          description={
            canCreateEvent && !isConverted ? "Schedule one above." : undefined
          }
          className="py-6"
        />
      ) : null}

      {upcoming.length > 0 && (
        <EventSection title="Upcoming" events={upcoming} leadId={id} tz={tz} />
      )}
      {past.length > 0 && (
        <EventSection title="Past" events={past} leadId={id} tz={tz} />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          notes={selectedEventNotes}
          timeEntries={selectedEventTime}
        />
      )}
    </div>
  );
}

function EventSection({
  title,
  events,
  leadId,
  tz,
}: {
  title: string;
  events: MatterEventRow[];
  leadId: string;
  tz: string;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-semibold text-ink-2">
          {title}
        </h2>
        <span className="text-2xs font-mono text-ink-4">{events.length}</span>
      </div>
      <Card className="p-0 overflow-hidden">
        <ul className="divide-y divide-line">
          {events.map((event) => (
            <LeadEventRow key={event.id} event={event} leadId={leadId} tz={tz} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function LeadEventRow({
  event,
  leadId,
  tz,
}: {
  event: MatterEventRow;
  leadId: string;
  /** Viewer's profile zone — timed events are instants; all-day
   *  events are date-only (ADR-012). */
  tz: string;
}) {
  const timeLabel = event.isAllDay
    ? "All day"
    : dateKeyInTz(event.startTime, tz) === dateKeyInTz(event.endTime, tz)
      ? `${formatDate(event.startTime, "time", tz)} – ${formatDate(event.endTime, "time", tz)}`
      : `${formatDate(event.startTime, "datetime", tz)} – ${formatDate(event.endTime, "datetime", tz)}`;
  const dateLabel = event.isAllDay
    ? formatDateOnly(event.startTime, "short_weekday")
    : formatDate(event.startTime, "short_weekday", tz);
  const typeLabel =
    (EVENT_TYPE_LABEL as Record<string, string>)[event.type] ?? event.type;

  const body = (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span
        className="w-1 self-stretch rounded-full shrink-0"
        style={{ background: event.color }}
      />
      <div className="flex flex-col leading-tight w-28 shrink-0">
        <span className="text-xs font-medium text-ink">{dateLabel}</span>
        <span className="text-2xs font-mono text-ink-4">{timeLabel}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-ink truncate">
          {event.title}
        </div>
        {event.viewerCanSeeDetails && event.location && (
          <div className="flex items-center gap-1 text-2xs text-ink-3 truncate">
            <MapPin size={10} className="shrink-0" />
            {event.location}
          </div>
        )}
      </div>
      {event.viewerCanSeeDetails && (
        <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line shrink-0">
          {typeLabel}
        </span>
      )}
    </div>
  );

  // "Busy" shells open nothing — there's nothing more to show.
  return (
    <li>
      {event.viewerCanSeeDetails ? (
        <Link
          href={`/intake/${leadId}/events?event=${event.id}`}
          scroll={false}
          className="block hover:bg-brand-tint transition-colors"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
