/**
 * Edit Event page.
 *
 * Server-fetches the event, renders the client edit form. Linked from
 * the event detail modal's footer "Edit" button.
 */

import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { EditEventForm } from "@/components/calendar/edit-event-form";
import { getCalendarEventById } from "@/lib/queries/calendar";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function EditEventPage({
  params,
}: PageProps<"/calendar/events/[eventId]/edit">) {
  const { eventId } = await params;
  const [event, canEdit] = await Promise.all([
    getCalendarEventById(eventId),
    currentUserHasPermission("events.edit"),
  ]);
  // getCalendarEventById returns a scrubbed "Busy" placeholder (not
  // null) when the viewer fails the visibility resolver — the modal
  // needs that row to render a busy block. Here it would pre-fill the
  // form with the scrubbed values ("Busy", null location/description,
  // no attendees), and saving would overwrite the real event with
  // them. So a scrubbed row is a 404 on this page, as is a viewer
  // without events.edit (updateEvent gates the write regardless).
  if (!event || !event.viewerCanSeeDetails || !canEdit) notFound();

  return (
    <>
      <TopBar title="Edit event" crumbs={`Calendar / ${event.title}`} />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <EditEventForm
          event={{
            id: event.id,
            title: event.title,
            type: event.type,
            startTime: event.startTime,
            endTime: event.endTime,
            isAllDay: event.isAllDay,
            location: event.location,
            zoomUrl: event.zoomUrl,
            description: event.description,
            matterId: event.matter?.id ?? null,
            attendees: event.attendees,
          }}
        />
      </div>
    </>
  );
}
