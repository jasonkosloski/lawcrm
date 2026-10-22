/**
 * Expandable Event Row — matter Events tab.
 *
 * Primary interaction flipped: clicking the row body expands the
 * attachments (notes + time) inline right there. A small
 * "open full view" button on the right side opens the event detail
 * modal for the deeper view. That way the common path (capture a
 * note or log some time) is friction-free; the modal is an opt-in
 * zoom.
 */

"use client";

import { useState } from "react";
import { ChevronDown, Clock, Maximize2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
// Event instants render in the viewer's PROFILE zone (useUserTimeZone),
// never the runtime's: this client component is also server-rendered,
// and a browser-zone format would disagree with the UTC server text and
// trip a hydration mismatch. All-day events are date-only values and
// read in UTC.
import { dateKeyInTz, formatDate, formatDateOnly } from "@/lib/format-date";
import { formatHours } from "@/lib/format-hours";
import { useUserTimeZone } from "@/components/user-time-zone";
import { EventLink } from "@/components/calendar/event-link";
import {
  EventAttachmentsProvider,
  type EventAttachmentsViewer,
} from "@/components/calendar/event-attachments-context";
import { eventTimeEntryDate } from "@/components/calendar/event-dates";
import { EventNotesSection } from "@/components/calendar/event-notes-section";
import { EventTimeEntriesSection } from "@/components/calendar/event-time-entries-section";
import type { MatterEventRow } from "@/lib/queries/matter-detail";
import { Badge } from "@/components/ui/badge";

const TYPE_LABEL: Record<string, string> = {
  meeting: "Meeting",
  deposition: "Deposition",
  hearing: "Hearing",
  intake: "Intake",
  block_time: "Block time",
  mediation: "Mediation",
  trial: "Trial",
};

/** Plain-text preview of the first (pinned-first, most-recent) note
 *  shown under the event title when the row is collapsed. Note content
 *  is sanitized HTML, so after the tags go the entities must be decoded
 *  too ("Smith &amp; Wesson" -> "Smith & Wesson"); `&amp;` is decoded
 *  LAST so "&amp;lt;" stays the literal text "&lt;" instead of being
 *  double-decoded. The result is rendered as React text (escaped), so
 *  decoding is XSS-safe. Exported for tests. */
export function notePreview(note: {
  content: string;
  authorInitials: string;
}): string {
  const text = note.content
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const snippet = text.length > 110 ? `${text.slice(0, 109)}…` : text;
  return `${note.authorInitials}: ${snippet}`;
}

export function EventRowExpandable({
  event,
  matterId,
  matterName,
  viewer,
}: {
  event: MatterEventRow;
  matterId: string;
  matterName: string;
  /** What the signed-in user may do with the notes / time entries
   *  inside (resolved on the server by the page). Omitted = the
   *  buttons all show and the server decides, as before. */
  viewer?: Partial<Omit<EventAttachmentsViewer, "defaultTimeEntryDate">>;
}) {
  const tz = useUserTimeZone();
  // "Busy" shell rows (viewer can't see this event's details) carry
  // no notes/time and expose no expand or modal affordance.
  const canSeeDetails = event.viewerCanSeeDetails;
  const hasAttachments =
    event.notes.length > 0 || event.timeEntries.length > 0;
  // Auto-expand when there's already something attached so the user
  // sees the thread + time logs on first load.
  const [expanded, setExpanded] = useState(canSeeDetails && hasAttachments);

  const timeLabel = event.isAllDay
    ? "All day"
    : dateKeyInTz(event.startTime, tz) === dateKeyInTz(event.endTime, tz)
      ? `${formatDate(event.startTime, "time", tz)} – ${formatDate(event.endTime, "time", tz)}`
      : `${formatDate(event.startTime, "datetime", tz)} – ${formatDate(event.endTime, "datetime", tz)}`;
  const dateLabel = event.isAllDay
    ? formatDateOnly(event.startTime, "short_weekday")
    : formatDate(event.startTime, "short_weekday", tz);

  const notesCount = event.notes.length;
  const timeCount = event.timeEntries.length;
  const totalHours = event.timeEntries.reduce((s, e) => s + e.hours, 0);

  return (
    <li className="flex flex-col">
      <div
        className={cn(
          "flex items-stretch gap-0",
          expanded && "bg-paper-2/30"
        )}
      >
        {/* Row body — expands attachments inline. This is the
            primary interaction; the modal is now opt-in via the
            right-side "open full view" button. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={canSeeDetails ? expanded : undefined}
          disabled={!canSeeDetails}
          className="flex-1 min-w-0 block text-left disabled:cursor-default"
        >
          <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-tint transition-colors">
            <span
              className="w-1 self-stretch rounded-full shrink-0"
              style={{ background: event.color }}
            />
            <div className="flex flex-col leading-tight w-28 shrink-0">
              <span className="text-xs font-medium text-ink">
                {dateLabel}
              </span>
              <span className="text-2xs font-mono text-ink-4">
                {timeLabel}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <div className="text-xs font-medium text-ink truncate">
                  {event.title}
                </div>
                {notesCount > 0 && (
                  <Badge
                    className="gap-0.5"
                    title={`${notesCount} note${notesCount === 1 ? "" : "s"} attached`}
                  >
                    <MessageSquare size={10} />
                    {notesCount}
                  </Badge>
                )}
                {timeCount > 0 && (
                  <Badge
                    variant="ok"
                    className="gap-0.5 font-mono"
                    title={`${formatHours(totalHours)} hours logged across ${timeCount} entr${timeCount === 1 ? "y" : "ies"}`}
                  >
                    <Clock size={10} />
                    {formatHours(totalHours)}h
                  </Badge>
                )}
              </div>
              {event.location && (
                <div className="text-2xs text-ink-3 truncate">
                  {event.location}
                </div>
              )}
              {notesCount > 0 && !expanded && (
                <div className="text-2xs text-ink-3 truncate mt-0.5 italic">
                  {notePreview(event.notes[0])}
                </div>
              )}
            </div>
            <Badge variant="neutral">
              {TYPE_LABEL[event.type] ?? event.type}
            </Badge>
            {event.attendeeCount > 0 && (
              <span className="text-2xs font-mono text-ink-4 shrink-0">
                {event.attendeeCount}{" "}
                {event.attendeeCount === 1 ? "attendee" : "attendees"}
              </span>
            )}
            {canSeeDetails && (
              <ChevronDown
                size={14}
                className={cn(
                  "text-ink-3 shrink-0 transition-transform",
                  expanded && "rotate-180",
                  hasAttachments && !expanded && "text-brand-700"
                )}
              />
            )}
          </div>
        </button>

        {/* Open full view — the modal lives here now, as an opt-in
            zoom rather than the default click behavior. */}
        {canSeeDetails && (
          <EventLink
            eventId={event.id}
            className={cn(
              "flex items-center px-3 border-l border-line shrink-0 transition-colors",
              "text-ink-3 hover:bg-paper-2 hover:text-brand-700"
            )}
          >
            <span
              title="Open full event view"
              aria-label="Open full event view"
              className="inline-flex items-center"
            >
              <Maximize2 size={13} />
            </span>
          </EventLink>
        )}
      </div>

      {canSeeDetails && expanded && (
        <EventAttachmentsProvider
          {...viewer}
          defaultTimeEntryDate={eventTimeEntryDate(event, tz)}
        >
          <div className="px-5 py-3 border-t border-line bg-paper-2/30 flex flex-col gap-4">
            <EventNotesSection
              eventId={event.id}
              matterId={matterId}
              matterName={matterName}
              notes={event.notes}
            />
            <EventTimeEntriesSection
              eventId={event.id}
              matterId={matterId}
              entries={event.timeEntries}
            />
          </div>
        </EventAttachmentsProvider>
      )}
    </li>
  );
}
