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
 * Read-only mode keeps the original static layout.
 *
 * Dismisses on backdrop click, X button, or Escape — all of which
 * strip `?event=` while preserving the calendar's view + date params.
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
// Client component — event instants render via the centralized
// variants with no TZ override (browser-local after hydration).
import { formatDate } from "@/lib/format-date";
import {
  ArrowRight,
  Calendar,
  Check,
  Eye,
  Link as LinkIcon,
  MapPin,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteCalendarEventAndRedirect,
  updateCalendarEvent,
} from "@/app/actions/calendar-events";
import { updateCalendarEventInitialState } from "@/lib/calendar-event-form";
import {
  EVENT_TYPES,
  EVENT_TYPE_LABEL,
} from "@/lib/constants/calendar-event-type";
import { EmailLink } from "@/components/ui/email-link";
import {
  ATTENDEE_STATUS_LABEL,
  AttendeePicker,
  serializeAttendees,
  type EditableAttendee,
} from "./attendee-picker";
import type {
  CalendarEventDetail,
  EventNote,
  EventTimeEntry,
} from "@/lib/queries/calendar";
import { EventNotesSection } from "./event-notes-section";
import { EventTimeEntriesSection } from "./event-time-entries-section";

// Settable event-type labels are centralized; "deadline" is the
// calendar's pseudo-event for projected deadlines (display-only,
// never settable) so it's added here at the render layer.
const TYPE_LABEL: Record<string, string> = {
  ...EVENT_TYPE_LABEL,
  deadline: "Deadline",
};

// ── Editor state ────────────────────────────────────────────────────────

// `EditableAttendee` + the attendee list editor moved to
// ./attendee-picker.tsx when the standalone create form landed
// (both surfaces share one picker). Re-exported so existing
// importers of the modal's type keep working.
export type { EditableAttendee } from "./attendee-picker";

/** All fields the inline editor manages. Mirrors the action's
 *  schema: when a single field commits, we still build a full
 *  FormData from this state because the action is a whole-row
 *  update. */
type EventEditState = {
  title: string;
  type: string;
  isAllDay: boolean;
  /** Always stored as datetime-local format ("YYYY-MM-DDTHH:mm")
   *  even when isAllDay — the form / FormData branches on the
   *  flag at submission time. */
  startTime: string;
  endTime: string;
  location: string;
  zoomUrl: string;
  description: string;
  attendees: EditableAttendee[];
  /** Per-event visibility override. "default" applies the
   *  resolver's standard rules; "show_details" makes this event
   *  publicly visible in full. */
  visibility: string;
};

/** Convert a Date to the `YYYY-MM-DDTHH:mm` form datetime-local
 *  expects, using local time so the user sees what they entered. */
const toDateTimeInput = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const dateOnly = (v: string): string => v.slice(0, 10);

const buildInitialState = (event: CalendarEventDetail): EventEditState => ({
  title: event.title,
  type: event.type,
  isAllDay: event.isAllDay,
  startTime: toDateTimeInput(event.startTime),
  endTime: toDateTimeInput(event.endTime),
  location: event.location ?? "",
  zoomUrl: event.zoomUrl ?? "",
  description: event.description ?? "",
  visibility: event.visibility,
  attendees: event.attendees.map((a) => ({
    kind: a.userId ? "user" : a.contactId ? "contact" : "new",
    attendeeId: a.id,
    userId: a.userId,
    contactId: a.contactId,
    name: a.name,
    email: a.email ?? "",
    initials: a.userInitials,
    jobTitle: a.userJobTitle,
    contactType: a.contactType,
    status: a.status,
  })),
});

// ── Modal ───────────────────────────────────────────────────────────────

export function EventDetailModal({
  event,
  notes,
  timeEntries,
  canEdit = false,
}: {
  event: CalendarEventDetail;
  notes: EventNote[];
  timeEntries: EventTimeEntry[];
  /** When true, every editable property becomes click-to-edit.
   *  The page resolves this from `events.edit` permission and
   *  passes it through; the action server-side gates again, so
   *  flipping this client-side doesn't bypass anything. */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [deletePending, startDelete] = useTransition();
  const [savePending, startSave] = useTransition();
  const [committed, setCommitted] = useState<EventEditState>(() =>
    buildInitialState(event)
  );
  const [error, setError] = useState<string | null>(null);

  // Re-sync local state whenever a fresh `event` prop lands —
  // either the user opened a different event without unmounting,
  // or the router.refresh() after a save delivered the committed
  // row back. The latter matters: server-assigned ids and display
  // extras only exist on the re-read (a picker-added attendee
  // flips kind:"new" → "contact" here; without the re-seed every
  // later whole-row commit would re-send it down the
  // create-Contact path, and edits landed by other users would be
  // clobbered). Skipped mid-save so a refresh can't overwrite the
  // optimistic merge — the transition settling re-runs the effect
  // via the `savePending` dep. Open inline editors are unaffected;
  // they hold their own draft state while editing.
  const lastEventIdRef = useRef(event.id);
  useEffect(() => {
    if (savePending) return;
    setCommitted(buildInitialState(event));
    if (lastEventIdRef.current !== event.id) {
      lastEventIdRef.current = event.id;
      setError(null);
    }
  }, [event, savePending]);

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
      // All-day uses date-only ("YYYY-MM-DD"); timed uses the
      // full datetime-local. The action's parser branches on
      // the isAllDay flag.
      fd.set(
        "startTime",
        next.isAllDay ? dateOnly(next.startTime) : next.startTime
      );
      fd.set(
        "endTime",
        next.isAllDay ? dateOnly(next.endTime) : next.endTime
      );
      fd.set("location", next.location);
      fd.set("zoomUrl", next.zoomUrl);
      fd.set("description", next.description);
      fd.set("visibility", next.visibility);
      // Strip the display-only fields (initials / jobTitle /
      // contactType / status / attendeeId) so the wire format
      // matches the action's zod schema. Display extras flow back
      // in when the re-sync effect re-seeds from the refreshed
      // `event` prop after this save settles.
      fd.set("attendees", serializeAttendees(next.attendees));
      startSave(async () => {
        const res = await updateCalendarEvent(
          event.id,
          updateCalendarEventInitialState,
          fd
        );
        if (res.status === "error") {
          // Pull the first error message we can find — field-level
          // first, then the action's own error key.
          const first =
            Object.values(res.errors ?? {}).flat().find(Boolean) ??
            "Couldn't save change.";
          setError(first);
          setCommitted(previous);
        } else {
          // Refresh to pull the freshly-committed event back in
          // (matter linkage, attendees with new ids, etc.) —
          // doesn't visibly flash thanks to the suspense
          // boundary on the page.
          router.refresh();
        }
      });
    },
    [committed, event.id, router]
  );

  const onDelete = () => {
    if (
      !confirm(
        `Delete this event?\n\n"${committed.title}"\n\nThis can't be undone.`
      )
    ) {
      return;
    }
    startDelete(async () => {
      await deleteCalendarEventAndRedirect(event.id);
    });
  };

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

  // Derived display strings for the read-only branches.
  const startsAndEnds = committed.isAllDay
    ? "All day"
    : isSameDay(new Date(committed.startTime), new Date(committed.endTime))
      ? `${formatDate(new Date(committed.startTime), "time")} – ${formatDate(new Date(committed.endTime), "time")}`
      : `${formatDate(new Date(committed.startTime), "datetime")} – ${formatDate(new Date(committed.endTime), "datetime")}`;
  const dateLabel = formatDate(new Date(committed.startTime), "full_long");

  // Busy-only view: viewer is allowed to see this slot is taken
  // but not what's on it. Render a minimal modal — time + the
  // single line "Busy" — so the click-on-busy-block behavior is
  // predictable but no detail leaks.
  if (!event.viewerCanSeeDetails) {
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
          aria-label="Busy"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(92vw,400px)] rounded-xl shadow-2xl ring-1 ring-black/5 border border-line bg-white flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-100"
        >
          <header className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-line">
            <div className="w-1 self-stretch rounded-full shrink-0 bg-ink-3" />
            <div className="flex-1 min-w-0">
              <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1">
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
      </>
    );
  }

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
        aria-label={committed.title}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(92vw,560px)] max-h-[85vh] rounded-xl shadow-2xl ring-1 ring-black/5 border border-line bg-white flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-100"
      >
        {/* Header with color bar */}
        <header className="flex items-start gap-4 px-5 pt-5 pb-4 border-b border-line relative">
          <div
            className="w-1 self-stretch rounded-full shrink-0"
            style={{ background: event.color }}
          />
          <div className="flex-1 min-w-0">
            {/* Type — click-to-edit dropdown when canEdit. */}
            <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1">
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
            <div className="text-2xs text-warn bg-warn-soft border border-warn-border rounded-md px-2.5 py-1.5">
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
                onCommit={(v) => commit({ zoomUrl: v })}
                maxLength={500}
                ariaLabel="Video URL"
                renderDisplay={
                  committed.zoomUrl
                    ? (val) => (
                        <a
                          href={val}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-xs text-brand-700 hover:underline truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Join video call
                        </a>
                      )
                    : undefined
                }
              />
            </Row>
          ) : (
            committed.zoomUrl && (
              <Row icon={<Video size={14} />}>
                <a
                  href={committed.zoomUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-brand-700 hover:underline truncate"
                >
                  Join video call
                </a>
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

          {/* Visibility toggle — editor-only. Defaults to
              "default" (resolver applies standard rules:
              creator + attendees + matter team see details;
              everyone else sees Busy). Flipping to "Show
              details to everyone" makes this specific event
              publicly visible regardless of relationship —
              use sparingly. */}
          {canEdit && (
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
                    (otherwise only attendees + matter team see
                    details — others see &ldquo;Busy&rdquo;)
                  </span>
                </span>
              </label>
            </Row>
          )}

          {/* Description */}
          {(canEdit || committed.description) && (
            <div className="pt-3 border-t border-line">
              <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1.5">
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
          {(canEdit || committed.attendees.length > 0) && (
            <div className="pt-3 border-t border-line">
              <div className="flex items-center gap-2 text-2xs font-mono uppercase tracking-wider text-ink-4 mb-2">
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
          )}

          {/* Notes attached to this event */}
          <EventNotesSection
            eventId={event.id}
            matterId={event.matter?.id ?? null}
            matterName={event.matter?.name ?? null}
            notes={notes}
          />

          {/* Time entries attached to this event */}
          <EventTimeEntriesSection
            eventId={event.id}
            matterId={event.matter?.id ?? null}
            entries={timeEntries}
          />
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0 bg-paper-2/30">
          {canEdit && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deletePending}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 h-7 rounded-md bg-white text-warn border border-line hover:border-warn-border hover:bg-warn-soft transition-colors disabled:opacity-50 mr-auto"
            >
              <Trash2 size={13} />
              {deletePending ? "Deleting…" : "Delete"}
            </button>
          )}
          {canEdit && savePending && (
            <span className="text-2xs font-mono text-ink-4 mr-auto">
              Saving…
            </span>
          )}
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

// ── Layout helpers ──────────────────────────────────────────────────────

function Row({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
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

// ── Inline editors ─────────────────────────────────────────────────────

const cellHover =
  "rounded-sm px-1 -mx-1 hover:bg-paper-2 cursor-text transition-colors";
const inputBase =
  "rounded-sm px-1 -mx-1 border border-brand-300 bg-white text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200";

/** Single-line inline text editor. View → click → input → blur/Enter
 *  commits. Renders a placeholder + dimmed copy when empty. The
 *  `renderDisplay` override lets callers (zoom URL row) swap a
 *  styled link for the plain string in view mode. */
function InlineText({
  value,
  placeholder,
  onCommit,
  required = false,
  maxLength,
  ariaLabel,
  className,
  renderDisplay,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  required?: boolean;
  maxLength?: number;
  ariaLabel: string;
  className?: string;
  renderDisplay?: (value: string) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Keep draft in sync with value when not actively editing —
  // prevents a stale draft from clobbering the next edit cycle
  // after an external commit.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = (raw: string) => {
    const next = raw;
    if (next === value) {
      setEditing(false);
      return;
    }
    if (required && next.trim().length === 0) {
      // Required field can't be cleared. Revert silently.
      setDraft(value);
      setEditing(false);
      return;
    }
    onCommit(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        defaultValue={draft}
        maxLength={maxLength}
        aria-label={ariaLabel}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            // Escape here means "cancel this edit" — stop it
            // before the modal's window handler closes the
            // whole modal.
            e.stopPropagation();
            setEditing(false);
          }
        }}
        className={cn(inputBase, "w-full text-xs", className)}
      />
    );
  }

  if (value === "" && !required) {
    // Empty optional field renders a "+ add ..." placeholder
    // button so the click target is obvious.
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${ariaLabel}`}
        className="text-xs text-ink-4 italic hover:text-ink-3 transition-colors"
      >
        {placeholder ?? "+ add"}
      </button>
    );
  }

  if (renderDisplay) {
    // Caller provided a custom view — wrap it in a clickable
    // span. The custom display itself can swallow clicks (e.g.,
    // the zoom-link href) via stopPropagation.
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={cn(cellHover, "inline-block max-w-full")}
      >
        {renderDisplay(value)}
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(cellHover, "inline-block max-w-full text-xs text-ink", className)}
    >
      {value}
    </span>
  );
}

/** Multi-line inline textarea. Renders the value as wrapped text
 *  in view mode; click → grows to a textarea with auto-focus +
 *  auto-select. Enter inserts a newline; Cmd/Ctrl+Enter commits. */
function InlineTextarea({
  value,
  placeholder,
  onCommit,
  maxLength,
  ariaLabel,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  maxLength?: number;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = (raw: string) => {
    if (raw === value) {
      setEditing(false);
      return;
    }
    onCommit(raw);
    setEditing(false);
  };

  if (editing) {
    return (
      <textarea
        autoFocus
        defaultValue={draft}
        rows={4}
        maxLength={maxLength}
        aria-label={ariaLabel}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.metaKey || e.ctrlKey)
          ) {
            e.preventDefault();
            commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            // Cancel the edit only — don't let the Escape
            // bubble to the modal's close handler.
            e.stopPropagation();
            setEditing(false);
          }
        }}
        className={cn(
          inputBase,
          "w-full text-xs resize-y leading-relaxed"
        )}
      />
    );
  }

  if (!value) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${ariaLabel}`}
        className="text-xs text-ink-4 italic hover:text-ink-3 transition-colors"
      >
        {placeholder ?? "+ add"}
      </button>
    );
  }

  return (
    <p
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(
        cellHover,
        "text-xs text-ink leading-relaxed whitespace-pre-wrap"
      )}
    >
      {value}
    </p>
  );
}

/** Tiny native <select>-style inline picker. Click to flip into
 *  a select; change commits + closes; Escape cancels. */
function InlineSelect({
  value,
  options,
  onCommit,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onCommit: (v: string) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={value}
        aria-label={ariaLabel}
        onChange={(e) => {
          const next = e.currentTarget.value;
          setEditing(false);
          if (next !== value) onCommit(next);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // Cancel the picker only — don't let the Escape
            // bubble to the modal's close handler.
            e.stopPropagation();
            setEditing(false);
          }
        }}
        className={cn(inputBase, "text-2xs font-mono uppercase tracking-wider")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const label = options.find((o) => o.value === value)?.label ?? value;
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit ${ariaLabel}`}
      className={cn(cellHover, "uppercase tracking-wider")}
    >
      {label}
    </button>
  );
}

/** Time + all-day editor. View mode shows the same date/range
 *  text as before; click expands an inline form with the all-day
 *  toggle + start/end inputs + Save/Cancel. Save commits all
 *  three at once (the action's whole-row update needs them
 *  together so end-after-start stays consistent). */
function InlineTimeEditor({
  isAllDay,
  startTime,
  endTime,
  onCommit,
  displayDate,
  displayRange,
}: {
  isAllDay: boolean;
  startTime: string;
  endTime: string;
  onCommit: (changes: {
    isAllDay?: boolean;
    startTime?: string;
    endTime?: string;
  }) => void;
  displayDate: string;
  displayRange: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draftIsAllDay, setDraftIsAllDay] = useState(isAllDay);
  const [draftStart, setDraftStart] = useState(startTime);
  const [draftEnd, setDraftEnd] = useState(endTime);

  // Reseed from props when re-opening or after an external update.
  useEffect(() => {
    if (!editing) {
      setDraftIsAllDay(isAllDay);
      setDraftStart(startTime);
      setDraftEnd(endTime);
    }
  }, [isAllDay, startTime, endTime, editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit date and time"
        className={cn(cellHover, "flex flex-col leading-tight text-left")}
      >
        <span className="text-xs text-ink font-medium">{displayDate}</span>
        <span className="text-2xs text-ink-3 font-mono">{displayRange}</span>
      </button>
    );
  }

  const save = () => {
    const changes: {
      isAllDay?: boolean;
      startTime?: string;
      endTime?: string;
    } = {};
    if (draftIsAllDay !== isAllDay) changes.isAllDay = draftIsAllDay;
    // Always send start/end too — the editor may have toggled
    // all-day without changing the strings, but the action
    // needs them together to validate end >= start under the
    // current isAllDay flag.
    changes.startTime = draftStart;
    changes.endTime = draftEnd;
    setEditing(false);
    onCommit(changes);
  };

  const cancel = () => {
    setEditing(false);
    setDraftIsAllDay(isAllDay);
    setDraftStart(startTime);
    setDraftEnd(endTime);
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <label className="inline-flex items-center gap-2 text-2xs text-ink-3 select-none">
        <input
          type="checkbox"
          checked={draftIsAllDay}
          onChange={(e) => {
            const next = e.target.checked;
            setDraftIsAllDay(next);
            if (!next) {
              // Re-toggling to timed: if the times are at midnight
              // (the all-day default), reseed to 9–10am so the
              // user doesn't get confusing 00:00 inputs.
              if (draftStart.endsWith("T00:00"))
                setDraftStart(`${dateOnly(draftStart)}T09:00`);
              if (draftEnd.endsWith("T00:00"))
                setDraftEnd(`${dateOnly(draftEnd)}T10:00`);
            }
          }}
          className="h-3.5 w-3.5 rounded border-line"
        />
        All day
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-2xs text-ink-3">
          {draftIsAllDay ? "Start date" : "Starts"}
          <input
            type={draftIsAllDay ? "date" : "datetime-local"}
            value={
              draftIsAllDay ? dateOnly(draftStart) : draftStart
            }
            onChange={(e) =>
              setDraftStart(
                draftIsAllDay ? `${e.target.value}T00:00` : e.target.value
              )
            }
            className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-2xs text-ink-3">
          {draftIsAllDay ? "End date" : "Ends"}
          <input
            type={draftIsAllDay ? "date" : "datetime-local"}
            value={draftIsAllDay ? dateOnly(draftEnd) : draftEnd}
            onChange={(e) =>
              setDraftEnd(
                draftIsAllDay ? `${e.target.value}T00:00` : e.target.value
              )
            }
            className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
          />
        </label>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={save}
          className="inline-flex items-center gap-1 text-2xs font-medium px-2 h-6 rounded-md bg-brand-500 text-white hover:bg-brand-600"
        >
          <Check size={11} />
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          className="text-2xs text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
