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
import { ArrowLeft, X } from "lucide-react";
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
  isAllDay: boolean;
  location: string | null;
  zoomUrl: string | null;
  description: string | null;
  matterId: string | null;
  attendees: Array<{
    id: string;
    name: string;
    email: string | null;
    status: string;
  }>;
};

type AttendeeDraft = { name: string; email: string };

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
  const [isAllDay, setIsAllDay] = useState(event.isAllDay);
  const [startTime, setStartTime] = useState(toDateTimeInput(event.startTime));
  const [endTime, setEndTime] = useState(toDateTimeInput(event.endTime));
  const [location, setLocation] = useState(event.location ?? "");
  const [zoomUrl, setZoomUrl] = useState(event.zoomUrl ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  // Attendees: replace-all on save. Local state mirrors the
  // initial list and tracks adds/removes; a hidden JSON field on
  // the form sends the whole array to the server.
  const [attendees, setAttendees] = useState<AttendeeDraft[]>(
    event.attendees.map((a) => ({ name: a.name, email: a.email ?? "" }))
  );
  const [attendeeName, setAttendeeName] = useState("");
  const [attendeeEmail, setAttendeeEmail] = useState("");

  const addAttendee = () => {
    const name = attendeeName.trim();
    if (!name) return;
    setAttendees((list) => [...list, { name, email: attendeeEmail.trim() }]);
    setAttendeeName("");
    setAttendeeEmail("");
  };
  const removeAttendee = (idx: number) =>
    setAttendees((list) => list.filter((_, i) => i !== idx));

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

        <label className="inline-flex items-center gap-2 text-xs text-ink-3 select-none">
          <input
            type="checkbox"
            name="isAllDay"
            checked={isAllDay}
            onChange={(e) => setIsAllDay(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line"
          />
          All day
          <span className="text-ink-4">
            (the date is what counts; time fields below are ignored)
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <DateTimeField
            name="startTime"
            value={startTime}
            onChange={setStartTime}
            label={isAllDay ? "Start date" : "Starts"}
            error={errs.startTime?.[0]}
          />
          <DateTimeField
            name="endTime"
            value={endTime}
            onChange={setEndTime}
            label={isAllDay ? "End date" : "Ends"}
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

        {/* Attendees — replace-all strategy. The server pulls the
            full list from the hidden JSON below and re-creates the
            CalendarAttendee rows in a transaction. Status defaults
            to "pending" for new entries; existing rows lose their
            current status, which is fine until we wire RSVP. */}
        <div className="flex flex-col gap-1.5">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Attendees
          </div>
          {attendees.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {attendees.map((a, i) => (
                <li
                  key={`${a.name}-${i}`}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-line bg-paper-2 text-2xs"
                >
                  <span className="text-ink">{a.name}</span>
                  {a.email && (
                    <span className="text-ink-4 font-mono">{a.email}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttendee(i)}
                    aria-label={`Remove ${a.name}`}
                    className="text-ink-4 hover:text-warn"
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              type="text"
              value={attendeeName}
              onChange={(e) => setAttendeeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAttendee();
                }
              }}
              placeholder="Name"
              className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white"
            />
            <input
              type="email"
              value={attendeeEmail}
              onChange={(e) => setAttendeeEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAttendee();
                }
              }}
              placeholder="Email (optional)"
              className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addAttendee}
              disabled={!attendeeName.trim()}
            >
              Add
            </Button>
          </div>
          {/* Hidden field — what the server actually reads. */}
          <input
            type="hidden"
            name="attendees"
            value={JSON.stringify(attendees)}
          />
          {errs.attendees?.[0] && (
            <span className="text-2xs text-warn">{errs.attendees[0]}</span>
          )}
        </div>

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
