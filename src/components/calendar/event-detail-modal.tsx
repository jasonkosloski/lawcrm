/**
 * Event Detail Modal
 *
 * Google-calendar-style popover that opens when the user clicks an
 * event anywhere in the calendar. Driven by `?event=<id>` in the URL
 * so refresh and back-button just work.
 *
 * When `canEdit=true`, every editable property is its own click
 * target: click the value → it flips to an input (or a small
 * inline form for time + all-day) → blur or Enter commits → server
 * action `updateCalendarEvent` is called with the whole-row state
 * (the action is a full-row upsert, so each commit submits the
 * current values for every field).
 *
 * Schedule wire format (ADR-012): timed boundaries are datetime-local
 * wall-clock strings in the user's PROFILE zone (`useUserTimeZone`,
 * identical on the server render and after hydration); all-day
 * boundaries are date-only keys read in UTC. Nothing here uses the
 * browser's zone or local Date getters.
 *
 * Read-only mode keeps the original static layout.
 *
 * Dismisses on backdrop click, X button, or Escape — all of which
 * strip `?event=` while preserving the calendar's view + date params.
 * The shell traps focus, focuses itself on open and restores focus to
 * the opener on close.
 */

"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUserTimeZone } from "@/components/user-time-zone";
import {
  normalizeVideoUrl,
  toScheduleWire,
  videoHref,
} from "@/lib/event-schedule";
import {
  ArrowRight,
  Calendar,
  Link as LinkIcon,
  MapPin,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/app/actions/calendar-events";
import { updateCalendarEventInitialState } from "@/lib/calendar-event-form";
import { confirmAction } from "@/lib/feedback";
import {
  EVENT_TYPES,
  EVENT_TYPE_LABEL,
} from "@/lib/constants/calendar-event-type";
import { serializeAttendees } from "./attendee-picker";
import type {
  CalendarEventDetail,
  EventNote,
  EventTimeEntry,
} from "@/lib/queries/calendar";
import { EventNotesSection } from "./event-notes-section";
import { EventShareSection } from "./event-share-section";
import type { EventPortalShareProp } from "@/lib/queries/portal-status";
import { EventTimeEntriesSection } from "./event-time-entries-section";
import {
  Row,
  describeSchedule,
  buildInitialState,
  type EventEditState,
} from "./event-detail-helpers";
import { ModalShell } from "./event-modal-shell";
import {
  InlineText,
  InlineTextarea,
  InlineSelect,
  InlineTimeEditor,
} from "./event-inline-editors";
import {
  BusyEventView,
  EventVisibilityRow,
  EventAttendeesSection,
} from "./event-detail-sections";
import { Button } from "@/components/ui/button";

// Settable event-type labels are centralized; "deadline" is the
// calendar's pseudo-event for projected deadlines (display-only,
// never settable) so it's added here at the render layer.
const TYPE_LABEL: Record<string, string> = {
  ...EVENT_TYPE_LABEL,
  deadline: "Deadline",
};

// ── Modal ───────────────────────────────────────────────────────────────

export type EventDetailModalProps = {
  event: CalendarEventDetail;
  notes: EventNote[];
  timeEntries: EventTimeEntry[];
  /** When true, every editable property becomes click-to-edit.
   *  The page resolves this from `events.edit` permission and
   *  passes it through; the action server-side gates again, so
   *  flipping this client-side doesn't bypass anything. */
  canEdit?: boolean;
  /** Whether to offer Delete (the action gates on `events.delete`
   *  plus the creator / personal-event rules). Defaults to
   *  `canEdit` for callers that haven't resolved it separately;
   *  a denied delete now reports its reason instead of failing
   *  silently. */
  canDelete?: boolean;
  /** Client-portal share control. Omitted for lead events and when
   *  the viewer lacks portal.view. */
  portalShare?: EventPortalShareProp;
};

/** Keyed by event id so opening a different event (agenda link,
 *  back/forward) remounts with fresh editor state. Without it an
 *  open time-editor draft from event A could be Saved onto event B. */
export function EventDetailModal(props: EventDetailModalProps) {
  return <EventDetailModalInner key={props.event.id} {...props} />;
}

function EventDetailModalInner({
  event,
  notes,
  timeEntries,
  canEdit = false,
  canDelete,
  portalShare,
}: EventDetailModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tz = useUserTimeZone();
  const [deletePending, startDelete] = useTransition();
  // Set once the delete succeeded: the transition settles while the
  // redirect is still navigating, and a second click would re-run the
  // action and flash "Event not found".
  const [deleted, setDeleted] = useState(false);
  const [savePending, startSave] = useTransition();
  const [committed, setCommitted] = useState<EventEditState>(() =>
    buildInitialState(event, tz)
  );
  const [error, setError] = useState<string | null>(null);

  // Re-sync local state whenever a fresh `event` prop lands: the
  // action's revalidation delivers the committed row back inside the
  // save transition. That matters: server-assigned ids and display
  // extras only exist on the re-read (a picker-added attendee flips
  // kind:"new" -> "contact" here; without the re-seed every later
  // whole-row commit would re-send it down the create-Contact path,
  // and edits landed by other users would be clobbered). Skipped
  // mid-save so a refresh can't overwrite the optimistic merge; once
  // the transition settles the still-unseeded prop re-seeds. Done
  // during render (stored-previous-prop pattern), not in an effect.
  // Open inline editors are unaffected; they hold their own drafts.
  const [seededFrom, setSeededFrom] = useState(event);
  if (!savePending && seededFrom !== event) {
    setSeededFrom(event);
    setCommitted(buildInitialState(event, tz));
  }

  /** Commit a partial update: merges into committed state, builds
   *  full FormData (whole-row action), fires the update. On
   *  rejection, reverts the local state and surfaces the error. */
  const commit = useCallback(
    (changes: Partial<EventEditState>) => {
      setError(null);
      const previous = committed;
      const next = { ...committed, ...changes };
      setCommitted(next);
      const fd = new FormData();
      fd.set("title", next.title);
      fd.set("type", next.type);
      if (next.isAllDay) fd.set("isAllDay", "on");
      // All-day uses the date-only key ("YYYY-MM-DD"); timed uses
      // the datetime-local wall clock in the user's profile zone.
      // The action's parser branches on the isAllDay flag.
      fd.set("startTime", toScheduleWire(next.startTime, next.isAllDay));
      fd.set("endTime", toScheduleWire(next.endTime, next.isAllDay));
      fd.set("location", next.location);
      fd.set("zoomUrl", next.zoomUrl);
      fd.set("description", next.description);
      fd.set("visibility", next.visibility);
      // Strip the display-only fields (initials / jobTitle /
      // contactType / status / attendeeId) so the wire format
      // matches the action's zod schema. Display extras flow back
      // in when the re-sync above re-seeds from the revalidated
      // `event` prop after this save settles.
      fd.set("attendees", serializeAttendees(next.attendees));
      startSave(async () => {
        const res = await updateCalendarEvent(
          event.id,
          updateCalendarEventInitialState,
          fd
        );
        if (res.status === "error") {
          // Pull the first error message we can find: field-level
          // first, then the action's own error key.
          const first =
            Object.values(res.errors ?? {}).flat().find(Boolean) ??
            "Couldn't save change.";
          setError(first);
          setCommitted(previous);
        }
        // No router.refresh(): the action revalidates the calendar
        // (and matter) paths, so the fresh row arrives with the
        // action response in this same transition. A second
        // refresh just re-ran every calendar query.
      });
    },
    [committed, event.id]
  );

  // Returns false when the link is invalid so the inline editor stays
  // open with what the user typed instead of discarding it.
  const commitZoomUrl = (raw: string): boolean => {
    const res = normalizeVideoUrl(raw);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    commit({ zoomUrl: res.value });
    return true;
  };

  const onDelete = async () => {
    if (
      !(await confirmAction({
        title: `Delete "${committed.title}"?`,
        description: "This can't be undone.",
        confirmLabel: "Delete event",
        destructive: true,
      }))
    ) {
      return;
    }
    setError(null);
    startDelete(async () => {
      const res = await deleteCalendarEvent(event.id);
      if (!res.ok) {
        // Denied / already deleted: say so instead of flipping the
        // button back with the event still on screen.
        setError(res.error ?? "Couldn't delete this event.");
        return;
      }
      setDeleted(true);
      router.push(
        res.matterId ? `/matters/${res.matterId}/events` : "/calendar"
      );
    });
  };

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("event");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  // Derived display strings. All-day boundaries are date-only values
  // (formatted in UTC, never shifted); timed ones are wall-clock
  // strings in the user's zone, converted back to instants for
  // display in that same zone.
  const { dateLabel, startsAndEnds } = describeSchedule(committed, event, tz);

  // Busy-only view: viewer is allowed to see this slot is taken
  // but not what's on it. Render a minimal modal — time + the
  // single line "Busy" — so the click-on-busy-block behavior is
  // predictable but no detail leaks.
  if (!event.viewerCanSeeDetails) {
    return (
      <BusyEventView
        dateLabel={dateLabel}
        startsAndEnds={startsAndEnds}
        close={close}
      />
    );
  }

  return (
    <ModalShell
      label={committed.title}
      widthClass="w-[min(92vw,560px)] max-h-[85vh]"
      onClose={close}
    >
      <div className="contents">
        {/* Header with color bar */}
        <header className="flex items-start gap-4 px-5 pt-5 pb-4 border-b border-line relative">
          <div
            className="w-1 self-stretch rounded-full shrink-0"
            style={{ background: event.color }}
          />
          <div className="flex-1 min-w-0">
            {/* Type — click-to-edit dropdown when canEdit. */}
            <div className="text-2xs font-medium text-ink-3 mb-1">
              {canEdit ? (
                <InlineSelect
                  value={committed.type}
                  options={EVENT_TYPES.map((t) => ({
                    value: t,
                    label: TYPE_LABEL[t] ?? t,
                  }))}
                  onCommit={(v) => commit({ type: v })}
                  ariaLabel="Event type"
                />
              ) : (
                (TYPE_LABEL[committed.type] ?? committed.type)
              )}
            </div>
            {/* Title — click-to-edit text. */}
            <h2 className="text-lg font-display font-medium text-ink leading-tight">
              {canEdit ? (
                <InlineText
                  value={committed.title}
                  onCommit={(v) => commit({ title: v })}
                  required
                  maxLength={200}
                  ariaLabel="Event title"
                  className="text-lg font-display font-medium"
                />
              ) : (
                committed.title
              )}
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
          {/* Save error — shown above all rows so the user can't
              miss it. Auto-clears on the next successful commit. */}
          {error && (
            <div
              role="alert"
              className="text-2xs text-warn bg-warn-soft border border-warn-border rounded-md px-2.5 py-1.5"
            >
              {error}
            </div>
          )}

          {/* Time + all-day toggle */}
          <Row icon={<Calendar size={14} />}>
            {canEdit ? (
              <InlineTimeEditor
                isAllDay={committed.isAllDay}
                startTime={committed.startTime}
                endTime={committed.endTime}
                onCommit={(changes) => commit(changes)}
                displayDate={dateLabel}
                displayRange={startsAndEnds}
              />
            ) : (
              <div className="flex flex-col leading-tight">
                <span className="text-xs text-ink font-medium">
                  {dateLabel}
                </span>
                <span className="text-2xs text-ink-3 font-mono">
                  {startsAndEnds}
                </span>
              </div>
            )}
          </Row>

          {/* Location */}
          {canEdit ? (
            <Row icon={<MapPin size={14} />}>
              <InlineText
                value={committed.location}
                placeholder="+ add location"
                onCommit={(v) => commit({ location: v })}
                maxLength={200}
                ariaLabel="Location"
              />
            </Row>
          ) : (
            committed.location && (
              <Row icon={<MapPin size={14} />}>
                <span className="text-xs text-ink">{committed.location}</span>
              </Row>
            )
          )}

          {/* Zoom URL */}
          {canEdit ? (
            <Row icon={<Video size={14} />}>
              <InlineText
                value={committed.zoomUrl}
                placeholder="+ add video link"
                onCommit={commitZoomUrl}
                maxLength={500}
                ariaLabel="Video URL"
                renderDisplay={
                  committed.zoomUrl
                    ? (val) => {
                        const href = videoHref(val);
                        // Legacy free-text values that aren't links
                        // render as plain text, not a relative href.
                        return href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs text-brand-700 hover:underline truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Join video call
                          </a>
                        ) : (
                          <span className="text-xs text-ink truncate">
                            {val}
                          </span>
                        );
                      }
                    : undefined
                }
              />
            </Row>
          ) : (
            committed.zoomUrl && (
              <Row icon={<Video size={14} />}>
                {videoHref(committed.zoomUrl) ? (
                  <a
                    href={videoHref(committed.zoomUrl)!}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-brand-700 hover:underline truncate"
                  >
                    Join video call
                  </a>
                ) : (
                  <span className="text-xs text-ink">{committed.zoomUrl}</span>
                )}
              </Row>
            )
          )}

          {/* Matter link — read-only inline; reassign via the
              standalone edit page if needed (matter picker is
              heavyweight). */}
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
          {event.lead && (
            <Row icon={<LinkIcon size={14} />}>
              <Link
                href={`/intake/${event.lead.id}`}
                className="flex items-center gap-2 text-xs text-ink hover:text-brand-700"
              >
                <span className="text-2xs text-ink-4 shrink-0">Intake ·</span>
                <span className="font-medium truncate">{event.lead.name}</span>
              </Link>
            </Row>
          )}

          {/* Visibility toggle — editor-only. "default" lets the
              resolver decide: creator, attendees and the matter
              team always see details; everyone else sees Busy
              UNLESS the creator's profile shares event details
              firm-wide. "Show details to everyone" makes this
              specific event visible in full regardless; "Private"
              is the explicit hide (creator only, ADR-037) and
              wins over both the profile default and show-details. */}
          {canEdit && (
            <EventVisibilityRow committed={committed} commit={commit} />
          )}

          {/* Description */}
          {(canEdit || committed.description) && (
            <div className="pt-3 border-t border-line">
              <div className="text-2xs font-medium text-ink-3 mb-1.5">
                Description
              </div>
              {canEdit ? (
                <InlineTextarea
                  value={committed.description}
                  onCommit={(v) => commit({ description: v })}
                  placeholder="+ add description"
                  maxLength={4000}
                  ariaLabel="Description"
                />
              ) : (
                <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap">
                  {committed.description}
                </p>
              )}
            </div>
          )}

          {/* Attendees */}
          <EventAttendeesSection
            canEdit={canEdit}
            committed={committed}
            event={event}
            commit={commit}
          />

          {portalShare && event.matter && (
            <EventShareSection
              eventId={event.id}
              eventTitle={event.title}
              canShare={portalShare.canShare}
              share={portalShare.share}
            />
          )}

          {/* Notes attached to this event. data-modal-composer: an
              Escape inside these drafts only blurs the field, so a
              half-typed note isn't lost to a stray keypress. */}
          <div data-modal-composer>
            <EventNotesSection
              eventId={event.id}
              matterId={event.matter?.id ?? null}
              matterName={event.matter?.name ?? null}
              notes={notes}
            />
          </div>

          {/* Time entries attached to this event */}
          <div data-modal-composer>
            <EventTimeEntriesSection
              eventId={event.id}
              matterId={event.matter?.id ?? null}
              entries={timeEntries}
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0 bg-paper-2/30">
          {canEdit && (canDelete ?? canEdit) && (
            <Button
              variant="outline"
              size="xs"
              type="button"
              onClick={onDelete}
              disabled={deletePending || deleted}
              className="text-warn hover:border-warn-border hover:bg-warn-soft mr-auto"
            >
              <Trash2 size={13} />
              {deletePending || deleted ? "Deleting…" : "Delete"}
            </Button>
          )}
          {canEdit && savePending && (
            <span className="text-2xs font-mono text-ink-4 mr-auto">
              Saving…
            </span>
          )}
          {event.matter && (
            <Button size="xs" render={<Link href={`/matters/${event.matter.id}`} />}>
              Open matter
              <ArrowRight size={13} />
            </Button>
          )}
          {event.lead && (
            <Button size="xs" render={<Link href={`/intake/${event.lead.id}/events`} />}>
              Open intake
              <ArrowRight size={13} />
            </Button>
          )}
        </footer>
      </div>
    </ModalShell>
  );
}
