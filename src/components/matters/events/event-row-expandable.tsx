/**
 * Expandable Event Row — matter Events tab.
 *
 * Same compact summary as before (date/time/title/type/location) but
 * the summary is no longer a single click target. Instead:
 *   - Clicking the title opens the event detail modal (?event=<id>)
 *   - Clicking the notes-count chip or the chevron toggles an
 *     inline thread below the row with the full EventNotesSection
 *     (list + composer)
 *
 * Modal still exists as the deeper view; the inline section is the
 * friction-free capture path.
 */

"use client";

import { useState } from "react";
import { format, isSameDay } from "date-fns";
import { ChevronDown, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { EventLink } from "@/components/calendar/event-link";
import { EventNotesSection } from "@/components/calendar/event-notes-section";
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

export function EventRowExpandable({
  event,
  matterId,
  matterName,
}: {
  event: MatterEventRow;
  matterId: string;
  matterName: string;
}) {
  // Expand by default when there are existing notes so the user
  // lands on the thread without an extra click; user can always
  // collapse if they want the compact list view.
  const [expanded, setExpanded] = useState(event.notes.length > 0);

  const timeLabel = event.isAllDay
    ? "All day"
    : isSameDay(event.startTime, event.endTime)
      ? `${format(event.startTime, "h:mm a")} – ${format(event.endTime, "h:mm a")}`
      : `${format(event.startTime, "MMM d, h:mm a")} – ${format(event.endTime, "MMM d, h:mm a")}`;

  const notesCount = event.notes.length;

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

        {/* Expand/collapse — separate click target so the user can
            toggle the inline notes thread without opening the modal. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide notes" : "Show notes"}
          className={cn(
            "flex items-center gap-1.5 px-3 border-l border-line text-2xs font-mono shrink-0 transition-colors",
            notesCount > 0
              ? "text-brand-700 hover:bg-brand-soft"
              : "text-ink-4 hover:bg-paper-2 hover:text-ink-2"
          )}
        >
          <MessageSquare size={12} />
          <span>{notesCount}</span>
          <ChevronDown
            size={12}
            className={cn(
              "transition-transform",
              expanded && "rotate-180"
            )}
          />
        </button>
      </div>

      {expanded && (
        <div className="px-5 py-3 border-t border-line bg-paper-2/30">
          <EventNotesSection
            eventId={event.id}
            matterId={matterId}
            matterName={matterName}
            notes={event.notes}
          />
        </div>
      )}
    </li>
  );
}
