/**
 * Edit Event Form
 *
 * Standalone form on /calendar/events/[eventId]/edit. Mirrors the
 * field set of EventComposer plus zoomUrl. Saves redirect back to the
 * calendar (or the matter's events tab when matter-linked).
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DateTimeField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import { EVENT_TYPES } from "@/lib/note-constants";
import { updateCalendarEvent } from "@/app/actions/calendar-events";
import {
  updateCalendarEventInitialState,
  type UpdateCalendarEventFormState,
} from "@/lib/calendar-event-form";

export type EditableEvent = {
  id: string;
  title: string;
  type: string;
  startTime: Date;
  endTime: Date;
  location: string | null;
  zoomUrl: string | null;
  description: string | null;
  matterId: string | null;
};

/** Convert a Date to the local `YYYY-MM-DDTHH:mm` format datetime-local expects. */
const toDateTimeInput = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

export function EditEventForm({ event }: { event: EditableEvent }) {
  const router = useRouter();
  const action = updateCalendarEvent.bind(null, event.id);
  const [state, formAction, isPending] = useActionState<
    UpdateCalendarEventFormState,
    FormData
  >(action, updateCalendarEventInitialState);

  const [title, setTitle] = useState(event.title);
  const [type, setType] = useState(event.type);
  const [startTime, setStartTime] = useState(toDateTimeInput(event.startTime));
  const [endTime, setEndTime] = useState(toDateTimeInput(event.endTime));
  const [location, setLocation] = useState(event.location ?? "");
  const [zoomUrl, setZoomUrl] = useState(event.zoomUrl ?? "");
  const [description, setDescription] = useState(event.description ?? "");

  // After save, bounce back to the matter's events tab (if matter-linked)
  // or the calendar.
  useEffect(() => {
    if (state.status === "ok") {
      router.push(
        event.matterId ? `/matters/${event.matterId}/events` : "/calendar"
      );
    }
  }, [state.status, router, event.matterId]);

  const errs = state.errors ?? {};

  const backHref = event.matterId
    ? `/matters/${event.matterId}/events`
    : "/calendar";

  return (
    <div className="max-w-xl flex flex-col gap-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-brand-700 w-fit"
      >
        <ArrowLeft size={12} />
        {event.matterId ? "Back to matter events" : "Back to calendar"}
      </Link>

      <form action={formAction} className="flex flex-col gap-3">
        <TextField
          name="title"
          value={title}
          onChange={setTitle}
          placeholder="Event title (hearing, deposition, meeting…)"
          error={errs.title?.[0]}
          autoFocus
        />

        <div className="grid grid-cols-2 gap-2">
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
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <SelectField
            name="type"
            value={type}
            onChange={setType}
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
        </div>

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
          placeholder="Details (optional)"
          rows={4}
          error={errs.description?.[0]}
        />

        <div className="flex items-center justify-end gap-2">
          <Link
            href={backHref}
            className="text-xs text-ink-3 hover:text-ink px-3 py-1.5"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
