/**
 * Edit Event — placeholder
 *
 * Landing spot for the modal's "Edit" button until the real edit flow
 * exists. Shows the current event values read-only + a link back to
 * the matter + a link back to the calendar. Replace this page with a
 * real form (or switch the modal's Edit button to an inline edit
 * mode) when we figure out the most seamless flow — likely in-place
 * within the modal itself.
 */

import { format } from "date-fns";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCalendarEventById } from "@/lib/queries/calendar";

const TYPE_LABEL: Record<string, string> = {
  meeting: "Meeting",
  deposition: "Deposition",
  hearing: "Hearing",
  intake: "Intake",
  block_time: "Block time",
  mediation: "Mediation",
  trial: "Trial",
};

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
        <div className="max-w-2xl flex flex-col gap-4">
          <Link
            href="/calendar"
            className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-brand-700 w-fit"
          >
            <ArrowLeft size={12} />
            Back to calendar
          </Link>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Current values
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-xs">
                <Field label="Title" value={event.title} />
                <Field
                  label="Type"
                  value={TYPE_LABEL[event.type] ?? event.type}
                />
                <Field
                  label="Start"
                  value={format(event.startTime, "EEE, MMM d · h:mm a")}
                />
                <Field
                  label="End"
                  value={format(event.endTime, "EEE, MMM d · h:mm a")}
                />
                <Field
                  label="Location"
                  value={event.location ?? "—"}
                />
                <Field
                  label="Zoom URL"
                  value={event.zoomUrl ?? "—"}
                />
                {event.matter && (
                  <div className="col-span-2 pt-2 border-t border-line">
                    <dt className="text-ink-4 mb-0.5">Matter</dt>
                    <dd>
                      <Link
                        href={`/matters/${event.matter.id}`}
                        className="inline-flex items-center gap-2 text-ink hover:text-brand-700"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: event.matter.color }}
                        />
                        <span className="font-medium">
                          {event.matter.name}
                        </span>
                        <span className="text-2xs text-ink-4">
                          · {event.matter.area}
                        </span>
                        <ExternalLink size={11} className="text-ink-4" />
                      </Link>
                    </dd>
                  </div>
                )}
                {event.description && (
                  <div className="col-span-2 pt-2 border-t border-line">
                    <dt className="text-ink-4 mb-1">Notes</dt>
                    <dd className="text-ink leading-relaxed whitespace-pre-wrap">
                      {event.description}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                In-place edit coming
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xs text-ink-3 leading-relaxed mb-3">
                The real edit experience will live inside the event detail
                modal itself — click a field to edit in-place, change time
                by dragging the event block on the calendar grid, delete
                with a keyboard shortcut. Goal: never leave the calendar
                to fix an event.
              </p>
              <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4">
                <li>Inline title + notes editing in the modal</li>
                <li>Date/time pickers with duration shortcuts</li>
                <li>Drag-to-move and resize on the week-view grid</li>
                <li>Matter picker / re-link via autocomplete</li>
                <li>Attendee add / remove with status tracking</li>
                <li>Recurrence rules</li>
                <li>Delete + undo toast</li>
              </ul>
              <div className="mt-4 pt-3 border-t border-line text-2xs text-ink-4">
                Until that ships, events are created via the seed script
                and edited in Prisma Studio. See{" "}
                <code className="font-mono text-ink-3">docs/FEATURES.md</code>{" "}
                for the Phase 5 roadmap.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-4 mb-0.5">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
