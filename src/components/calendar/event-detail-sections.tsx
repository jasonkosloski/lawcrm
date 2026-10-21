/** Event Detail Modal — the Busy-only view and the larger body
 *  sections (visibility, attendees). */

"use client";

import { EventPrivateToggle } from "@/components/calendar/event-private-toggle";
import { Calendar, Eye, Users, X } from "lucide-react";
import { EmailLink } from "@/components/ui/email-link";
import { ATTENDEE_STATUS_LABEL, AttendeePicker } from "./attendee-picker";
import type { CalendarEventDetail } from "@/lib/queries/calendar";
import { Row, type EventEditState } from "./event-detail-helpers";
import { ModalShell } from "./event-modal-shell";

/** Busy-only view: viewer is allowed to see this slot is taken
 *  but not what's on it. Render a minimal modal — time + the
 *  single line "Busy" — so the click-on-busy-block behavior is
 *  predictable but no detail leaks. */
export function BusyEventView({
  dateLabel,
  startsAndEnds,
  close,
}: {
  dateLabel: string;
  startsAndEnds: string;
  close: () => void;
}) {
  return (
    <ModalShell label="Busy" widthClass="w-[min(92vw,400px)]" onClose={close}>
      <div className="contents">
        <header className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-line">
          <div className="w-1 self-stretch rounded-full shrink-0 bg-ink-3" />
          <div className="flex-1 min-w-0">
            <div className="text-2xs font-medium text-ink-3 mb-1">
              Busy
            </div>
            <h2 className="text-lg font-display font-medium text-ink leading-tight">
              Unavailable
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="p-1 rounded-md text-ink-3 hover:bg-muted hover:text-ink-2 shrink-0"
          >
            <X size={16} />
          </button>
        </header>
        <div className="px-5 py-4 flex flex-col gap-2">
          <div className="flex items-start gap-3 text-xs text-ink">
            <Calendar size={14} className="text-ink-3 mt-0.5 shrink-0" />
            <div className="flex flex-col leading-tight">
              <span className="font-medium">{dateLabel}</span>
              <span className="text-2xs text-ink-3 font-mono">
                {startsAndEnds}
              </span>
            </div>
          </div>
          <p className="text-2xs text-ink-4 leading-relaxed mt-1">
            You don&apos;t have access to this event&apos;s details.
            Ask the creator or a matter team member to share more.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}

/** Visibility toggle — editor-only (see the comment at the call site). */
export function EventVisibilityRow({
  committed,
  commit,
}: {
  committed: EventEditState;
  commit: (changes: Partial<EventEditState>) => void;
}) {
  return (
    <Row icon={<Eye size={14} />}>
      <label className="inline-flex items-center gap-2 text-xs text-ink-2 select-none">
        <input
          type="checkbox"
          checked={committed.visibility === "show_details"}
          onChange={(e) =>
            commit({
              visibility: e.target.checked
                ? "show_details"
                : "default",
            })
          }
          className="h-3.5 w-3.5 rounded border-line"
        />
        <span>
          Show details to everyone in the firm
          <span className="text-2xs text-ink-4 ml-1.5">
            (off: attendees + matter team always see
            details; everyone else follows the
            creator&apos;s profile default — usually
            &ldquo;Busy&rdquo;)
          </span>
        </span>
      </label>
    <div className="mt-2">
        <EventPrivateToggle
          checked={committed.visibility === "private"}
          onChange={(next) =>
            commit({ visibility: next ? "private" : "default" })
          }
        />
      </div>
    </Row>
  );
}

export function EventAttendeesSection({
  canEdit,
  committed,
  event,
  commit,
}: {
  canEdit: boolean;
  committed: EventEditState;
  event: CalendarEventDetail;
  commit: (changes: Partial<EventEditState>) => void;
}) {
  if (!(canEdit || committed.attendees.length > 0)) return null;
  return (
    <div className="pt-3 border-t border-line">
      <div className="flex items-center gap-2 text-2xs font-medium text-ink-3 mb-2">
        <Users size={11} />
        {committed.attendees.length} attendee
        {committed.attendees.length === 1 ? "" : "s"}
      </div>
      {canEdit ? (
        <AttendeePicker
          value={committed.attendees}
          onCommit={(next) => commit({ attendees: next })}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {event.attendees.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between text-xs"
            >
              <div className="flex flex-col leading-tight">
                <span className="text-ink">{a.name}</span>
                {a.email && (
                  <EmailLink
                    email={a.email}
                    className="text-2xs text-ink-4 font-mono"
                  />
                )}
              </div>
              {a.status !== "accepted" && (
                <span className="text-2xs text-ink-3">
                  {ATTENDEE_STATUS_LABEL[a.status] ?? a.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
