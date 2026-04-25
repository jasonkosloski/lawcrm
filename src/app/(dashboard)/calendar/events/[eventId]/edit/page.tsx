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

export default async function EditEventPage({
  params,
}: PageProps<"/calendar/events/[eventId]/edit">) {
  const { eventId } = await params;
  const event = await getCalendarEventById(eventId);
  if (!event) notFound();

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
            location: event.location,
            zoomUrl: event.zoomUrl,
            description: event.description,
            matterId: event.matter?.id ?? null,
          }}
        />
      </div>
    </>
  );
}
