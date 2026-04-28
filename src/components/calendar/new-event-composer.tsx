/**
 * New Event Composer — used by the calendar page's
 * "+ New event" button.
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
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createCalendarEvent } from "@/app/actions/calendar-events";
import {
  createCalendarEventInitialState,
  type CreateCalendarEventState,
} from "@/lib/calendar-event-form";
import {
  EVENT_TYPES,
  nextHourDateTimeString,
} from "@/lib/note-constants";
import {
  DateTimeField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";

const dateOnly = (v: string): string => v.slice(0, 10);

export function NewEventComposer({
  panelId,
  onClose,
}: {
  /** Reserved — the create-stack passes the panel id so a future
   *  composer can attach captures back to its origin. Unused
   *  today. */
  panelId?: string;
  /** Optional — fired after a successful create so the dock can
   *  collapse the panel automatically. */
  onClose?: () => void;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    CreateCalendarEventState,
    FormData
  >(createCalendarEvent, createCalendarEventInitialState);

  const [title, setTitle] = useState("");
  const [type, setType] =
    useState<(typeof EVENT_TYPES)[number]>("meeting");
  const [isAllDay, setIsAllDay] = useState(false);
  const [startTime, setStartTime] = useState(nextHourDateTimeString());
  const [endTime, setEndTime] = useState(nextHourDateTimeString(1));
  const [location, setLocation] = useState("");
  const [zoomUrl, setZoomUrl] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (state.status === "ok") {
      // Calendar revalidate already happened server-side; refresh
      // here ensures the new event appears immediately on this
      // tab even if the soft-cache held the old snapshot.
      router.refresh();
      onClose?.();
    }
  }, [state.status, router, onClose]);

  const errs = state.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
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
          onChange={(e) => setIsAllDay(e.target.checked)}
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
        onChange={setZoomUrl}
        placeholder="Zoom / video URL (optional)"
        error={errs.zoomUrl?.[0]}
      />

      <TextareaField
        name="description"
        value={description}
        onChange={setDescription}
        placeholder="Notes for yourself (optional)"
        rows={3}
        error={errs.description?.[0]}
      />

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? "Creating…" : "Create event"}
        </Button>
      </div>
    </form>
  );
}
