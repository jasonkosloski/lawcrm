/**
 * New Event page — /calendar/events/new.
 *
 * The full-page create form (matter picker, attendee picker,
 * visibility) linked from the calendar toolbar's "New event"
 * button; the docked quick composer stays available as the
 * lightweight secondary path. Server component gates + fetches,
 * client form does the rest. (Existing events are edited inline in
 * the event modal; there is no standalone edit route.)
 *
 * Access: `events.create` — the same key `createCalendarEvent`
 * enforces server-side; the page check just avoids rendering a
 * form whose submit is guaranteed to be rejected.
 */

import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { NewEventForm } from "@/components/calendar/new-event-form";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getFilingMatterOptions } from "@/lib/queries/communication";
import { requireUser } from "@/lib/current-user";

export default async function NewEventPage() {
  await requireUser();
  const canCreate = await currentUserHasPermission("events.create");
  if (!canCreate) notFound();

  // Open matters (pinned first) for the optional matter picker —
  // same compact option rows the email filing picker uses.
  const matters = await getFilingMatterOptions();

  return (
    <>
      <TopBar title="New event" crumbs="Calendar" />
      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <NewEventForm matters={matters} />
      </div>
    </>
  );
}
