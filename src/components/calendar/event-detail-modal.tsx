/**
 * Event Detail Modal
 *
 * Google-calendar-style popover that opens when the user clicks an
 * event anywhere in the calendar. Driven by `?event=<id>` in the URL
 * so refresh and back-button just work.
 *
 * Dismisses on backdrop click, X button, or Escape — all of which
 * strip `?event=` while preserving the calendar's view + date params.
 */

"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowRight,
  Calendar,
  Link as LinkIcon,
  MapPin,
  Pencil,
  Users,
  Video,
  X,
} from "lucide-react";
import type { CalendarEventDetail, EventNote } from "@/lib/queries/calendar";
import { EventNotesSection } from "./event-notes-section";

const TYPE_LABEL: Record<string, string> = {
  meeting: "Meeting",
  deposition: "Deposition",
  hearing: "Hearing",
  intake: "Intake",
  block_time: "Block time",
  deadline: "Deadline",
  mediation: "Mediation",
  trial: "Trial",
};

const ATTENDEE_STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
  pending: "Pending",
};

export function EventDetailModal({
  event,
  notes,
}: {
  event: CalendarEventDetail;
  notes: EventNote[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("event");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);

  const startsAndEnds = event.isAllDay
    ? "All day"
    : isSameDay(event.startTime, event.endTime)
      ? `${format(event.startTime, "h:mm a")} – ${format(event.endTime, "h:mm a")}`
      : `${format(event.startTime, "MMM d, h:mm a")} – ${format(event.endTime, "MMM d, h:mm a")}`;
  const dateLabel = format(event.startTime, "EEEE, MMMM d, yyyy");

  return (
    <>
      <button
        type="button"
        aria-label="Close event"
        onClick={close}
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm cursor-default animate-in fade-in duration-100"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={event.title}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(92vw,560px)] max-h-[85vh] rounded-xl shadow-2xl ring-1 ring-black/5 border border-line bg-white flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-100"
      >
        {/* Header with color bar */}
        <header className="flex items-start gap-4 px-5 pt-5 pb-4 border-b border-line relative">
          <div
            className="w-1 self-stretch rounded-full shrink-0"
            style={{ background: event.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1">
              {TYPE_LABEL[event.type] ?? event.type}
            </div>
            <h2 className="text-lg font-display font-medium text-ink leading-tight">
              {event.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            title="Close"
            className="p-1 rounded-md text-ink-3 hover:bg-muted hover:text-ink-2 shrink-0"
          >
            <X size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Time */}
          <Row icon={<Calendar size={14} />}>
            <div className="flex flex-col leading-tight">
              <span className="text-xs text-ink font-medium">{dateLabel}</span>
              <span className="text-2xs text-ink-3 font-mono">
                {startsAndEnds}
              </span>
            </div>
          </Row>

          {/* Location */}
          {event.location && (
            <Row icon={<MapPin size={14} />}>
              <span className="text-xs text-ink">{event.location}</span>
            </Row>
          )}

          {/* Zoom */}
          {event.zoomUrl && (
            <Row icon={<Video size={14} />}>
              <a
                href={event.zoomUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs text-brand-700 hover:underline truncate"
              >
                Join video call
              </a>
            </Row>
          )}

          {/* Matter link */}
          {event.matter && (
            <Row icon={<LinkIcon size={14} />}>
              <Link
                href={`/matters/${event.matter.id}`}
                className="flex items-center gap-2 text-xs text-ink hover:text-brand-700"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: event.matter.color }}
                />
                <span className="font-medium truncate">
                  {event.matter.name}
                </span>
                <span className="text-2xs text-ink-4 shrink-0">
                  · {event.matter.area}
                </span>
              </Link>
            </Row>
          )}

          {/* Description */}
          {event.description && (
            <div className="pt-3 border-t border-line">
              <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1.5">
                Description
              </div>
              <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap">
                {event.description}
              </p>
            </div>
          )}

          {/* Attendees */}
          {event.attendees.length > 0 && (
            <div className="pt-3 border-t border-line">
              <div className="flex items-center gap-2 text-2xs font-mono uppercase tracking-wider text-ink-4 mb-2">
                <Users size={11} />
                {event.attendees.length} attendee
                {event.attendees.length === 1 ? "" : "s"}
              </div>
              <ul className="flex flex-col gap-1.5">
                {event.attendees.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex flex-col leading-tight">
                      <span className="text-ink">{a.name}</span>
                      {a.email && (
                        <span className="text-2xs text-ink-4 font-mono">
                          {a.email}
                        </span>
                      )}
                    </div>
                    <span className="text-2xs text-ink-3">
                      {ATTENDEE_STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes attached to this event */}
          <EventNotesSection
            eventId={event.id}
            matterId={event.matter?.id ?? null}
            matterName={event.matter?.name ?? null}
            notes={notes}
          />
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0 bg-paper-2/30">
          <Link
            href={`/calendar/events/${event.id}/edit`}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 h-7 rounded-md bg-white text-ink-2 border border-line hover:border-brand-300 hover:text-brand-700 transition-colors"
          >
            <Pencil size={13} />
            Edit
          </Link>
          {event.matter && (
            <Link
              href={`/matters/${event.matter.id}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 h-7 rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              Open matter
              <ArrowRight size={13} />
            </Link>
          )}
        </footer>
      </div>
    </>
  );
}

function Row({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-ink-3 pt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
