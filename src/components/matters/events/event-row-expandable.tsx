/**
 * Expandable Event Row — matter Events tab.
 *
 * Same compact summary as before (date/time/title/type/location) but
 * the summary is no longer a single click target. Instead:
 *   - Clicking the title opens the event detail modal (deeper view)
 *   - Clicking the count chip or the chevron toggles an inline
 *     section under the row with the full EventNotesSection (list +
 *     composer) and EventTimeEntriesSection (list + composer) stacked
 *
 * Modal still exists; the inline expansion is the friction-free
 * capture path for both notes and time.
 */

"use client";

import { useState } from "react";
import { format, isSameDay } from "date-fns";
import { ChevronDown, Clock, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { EventLink } from "@/components/calendar/event-link";
import { EventNotesSection } from "@/components/calendar/event-notes-section";
import { EventTimeEntriesSection } from "@/components/calendar/event-time-entries-section";
import type { MatterEventRow } from "@/lib/queries/matter-detail";

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
 *  shown under the event title when the row is collapsed. */
function notePreview(note: {
  content: string;
  authorInitials: string;
}): string {
  const text = note.content
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const snippet = text.length > 110 ? `${text.slice(0, 109)}…` : text;
  return `${note.authorInitials}: ${snippet}`;
}

export function EventRowExpandable({
  event,
  matterId,
  matterName,
}: {
  event: MatterEventRow;
  matterId: string;
  matterName: string;
}) {
  const hasAttachments =
    event.notes.length > 0 || event.timeEntries.length > 0;
  // Auto-expand when there's already something attached so the user
  // sees the thread + time logs on first load.
  const [expanded, setExpanded] = useState(hasAttachments);

  const timeLabel = event.isAllDay
    ? "All day"
    : isSameDay(event.startTime, event.endTime)
      ? `${format(event.startTime, "h:mm a")} – ${format(event.endTime, "h:mm a")}`
      : `${format(event.startTime, "MMM d, h:mm a")} – ${format(event.endTime, "MMM d, h:mm a")}`;

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
        <EventLink
          eventId={event.id}
          className="flex-1 min-w-0 block"
        >
          <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-tint transition-colors cursor-pointer">
            <span
              className="w-1 self-stretch rounded-full shrink-0"
              style={{ background: event.color }}
            />
            <div className="flex flex-col leading-tight w-28 shrink-0">
              <span className="text-xs font-medium text-ink">
                {format(event.startTime, "EEE, MMM d")}
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
                  <span
                    className="inline-flex items-center gap-0.5 text-2xs font-medium text-brand-700 bg-brand-soft border border-brand-200 px-1.5 py-0.5 rounded-full shrink-0"
                    title={`${notesCount} note${notesCount === 1 ? "" : "s"} attached`}
                  >
                    <MessageSquare size={10} />
                    {notesCount}
                  </span>
                )}
                {timeCount > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-2xs font-medium text-ok bg-ok-soft border border-line px-1.5 py-0.5 rounded-full shrink-0 font-mono"
                    title={`${totalHours.toFixed(1)} hours logged across ${timeCount} entr${timeCount === 1 ? "y" : "ies"}`}
                  >
                    <Clock size={10} />
                    {totalHours.toFixed(1)}h
                  </span>
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

        {/* Expand/collapse — separate click target so toggling the
            inline sections doesn't open the modal. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide attachments" : "Show attachments"}
          className={cn(
            "flex items-center px-3 border-l border-line text-2xs font-mono shrink-0 transition-colors",
            hasAttachments
              ? "text-brand-700 hover:bg-brand-soft"
              : "text-ink-4 hover:bg-paper-2 hover:text-ink-2"
          )}
        >
          <ChevronDown
            size={14}
            className={cn(
              "transition-transform",
              expanded && "rotate-180"
            )}
          />
        </button>
      </div>

      {expanded && (
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
      )}
    </li>
  );
}
