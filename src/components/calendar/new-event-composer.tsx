/**
 * New Event Composer — the create dock's quick "event" panel
 * (opened by the zap button in NewEventButton; the primary
 * "New event" button goes to the full-page form instead).
 *
 * Creates a calendar event with no required matter — when no
 * matter is set, it's effectively a personal event by virtue
 * of being matter-less. The matter-detail page still routes
 * through its own EventComposer (with sibling captures + team
 * auto-add) since that's the matter-scoped flow.
 *
 * Field set: title, type, all-day, start/end, location, video
 * URL, description. A matter picker can be added here later if
 * we want one place to create both flavors.
 *
 * Schedule wire format (ADR-012): timed events post the
 * datetime-local wall clock in the user's PROFILE zone; all-day
 * events post date-only keys. Defaults and the all-day reseed come
 * from the shared helpers in lib/event-schedule.ts.
 */

"use client";

import { EventPrivateToggle } from "@/components/calendar/event-private-toggle";
import {
  useActionState,
  useEffect,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { createCalendarEvent } from "@/app/actions/calendar-events";
import {
  createCalendarEventInitialState,
  type CreateCalendarEventState,
} from "@/lib/calendar-event-form";
import { EVENT_TYPES } from "@/lib/note-constants";
import {
  dateOnly,
  nextHourInTz,
  normalizeVideoUrl,
  withDefaultEnd,
  withDefaultStart,
} from "@/lib/event-schedule";
import { useUserTimeZone } from "@/components/user-time-zone";
import {
  DateTimeField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";

export function NewEventComposer({
  onClose,
}: {
  /** The create-stack passes the panel id so a future composer
   *  could attach captures back to its origin; unused today, so it
   *  is not declared. */
  panelId?: string;
  /** Optional — fired after a successful create so the dock can
   *  collapse the panel automatically. */
  onClose?: () => void;
}) {
  const tz = useUserTimeZone();
  const [state, formAction, isPending] = useActionState<
    CreateCalendarEventState,
    FormData
  >(createCalendarEvent, createCalendarEventInitialState);
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [type, setType] =
    useState<(typeof EVENT_TYPES)[number]>("meeting");
  const [isAllDay, setIsAllDay] = useState(false);
  const [startTime, setStartTime] = useState(() => nextHourInTz(tz));
  const [endTime, setEndTime] = useState(() => nextHourInTz(tz, 1));
  const [location, setLocation] = useState("");
  const [zoomUrl, setZoomUrl] = useState("");
  const [zoomError, setZoomError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  // Per-event visibility — local UI is a single boolean
  // ("show details to everyone in the firm" / not). Maps to the
  // server's "show_details" / "default" enum on submit.
  const [showDetails, setShowDetails] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);

  useEffect(() => {
    // createCalendarEvent revalidates the calendar / dashboard /
    // matter paths itself, so the new event shows up without a
    // client-side router.refresh().
    if (state.status === "ok") onClose?.();
  }, [state.status, onClose]);

  const toggleAllDay = (next: boolean) => {
    setIsAllDay(next);
    // Back to timed: reseed 9-10am so the user doesn't submit a
    // zero-length midnight event.
    if (!next) {
      setStartTime((v) => withDefaultStart(v));
      setEndTime((v) => withDefaultEnd(v));
    }
  };

  // Dispatch manually (not <form action>) so React 19 doesn't reset
  // every field after a validation error comes back.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const video = normalizeVideoUrl(zoomUrl);
    if (!video.ok) {
      setZoomError(video.error);
      return;
    }
    setZoomError(null);
    fd.set("zoomUrl", video.value);
    startTransition(() => formAction(fd));
  };

  const errs = state.errors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <TextField
        name="title"
        value={title}
        onChange={setTitle}
        placeholder="Event title (block, focus time, lunch…)"
        error={errs.title?.[0]}
        autoFocus
      />

      <label className="inline-flex items-center gap-2 text-xs text-ink-3 select-none">
        <input
          type="checkbox"
          name="isAllDay"
          checked={isAllDay}
          onChange={(e) => toggleAllDay(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-line"
        />
        All day
      </label>

      <div className="grid grid-cols-2 gap-2">
        {isAllDay ? (
          <>
            <label className="flex flex-col gap-1 text-2xs text-ink-3">
              Start date
              <input
                type="date"
                name="startTime"
                value={dateOnly(startTime)}
                onChange={(e) => setStartTime(`${e.target.value}T00:00`)}
                required
                className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
              />
              {errs.startTime?.[0] && (
                <span className="text-2xs text-warn">
                  {errs.startTime[0]}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-2xs text-ink-3">
              End date
              <input
                type="date"
                name="endTime"
                value={dateOnly(endTime)}
                onChange={(e) => setEndTime(`${e.target.value}T00:00`)}
                required
                className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
              />
              {errs.endTime?.[0] && (
                <span className="text-2xs text-warn">{errs.endTime[0]}</span>
              )}
            </label>
          </>
        ) : (
          <>
            <DateTimeField
              name="startTime"
              value={startTime}
              onChange={setStartTime}
              label="Starts"
              error={errs.startTime?.[0]}
            />
            <DateTimeField
              name="endTime"
              value={endTime}
              onChange={setEndTime}
              label="Ends"
              error={errs.endTime?.[0]}
            />
          </>
        )}
      </div>

      <SelectField
        name="type"
        value={type}
        onChange={(v) => setType(v as (typeof EVENT_TYPES)[number])}
        options={EVENT_TYPES.map((t) => ({
          value: t,
          label: t.replace("_", " "),
        }))}
      />

      <TextField
        name="location"
        value={location}
        onChange={setLocation}
        placeholder="Location (optional)"
        error={errs.location?.[0]}
      />

      <TextField
        name="zoomUrl"
        value={zoomUrl}
        onChange={(v) => {
          setZoomUrl(v);
          setZoomError(null);
        }}
        placeholder="Zoom / video URL (optional)"
        error={zoomError ?? errs.zoomUrl?.[0]}
      />

      <TextareaField
        name="description"
        value={description}
        onChange={setDescription}
        placeholder="Notes for yourself (optional)"
        rows={3}
        error={errs.description?.[0]}
      />

      {/* Visibility — toggle flips the per-event override to
          "show_details" so anyone in the firm can see the full
          event. Off means "inherit": attendees and the matter team
          always see details; everyone else follows the creator's
          profile default (Busy unless that is firm-wide). */}
      <input
        type="hidden"
        name="visibility"
        value={isPrivate ? "private" : showDetails ? "show_details" : "default"}
      />
      <label className="flex items-start gap-2 text-xs text-ink-3 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={showDetails}
          onChange={(e) => {
            setShowDetails(e.target.checked);
            if (e.target.checked) setIsPrivate(false);
          }}
          className="mt-0.5 h-3.5 w-3.5 rounded border-line"
        />
        <span>
          <span className="text-ink">Show details to everyone in the firm</span>
          <span className="block text-[10px] text-ink-4 leading-relaxed mt-0.5">
            Off: invited attendees and the matter team always see details;
            others follow your profile default (usually &ldquo;Busy&rdquo;).
          </span>
        </span>
      </label>
      <EventPrivateToggle
        checked={isPrivate}
        onChange={(next) => {
          setIsPrivate(next);
          if (next) setShowDetails(false);
        }}
      />

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
        <Button
          type="submit"
          disabled={isPending || state.status === "ok"}
          size="sm"
        >
          {isPending ? "Creating…" : "Create event"}
        </Button>
      </div>
    </form>
  );
}
