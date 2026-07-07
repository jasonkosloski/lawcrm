/**
 * New Event Form — the standalone full-page create at
 * /calendar/events/new (linked from the calendar toolbar's
 * "New event"; the docked quick composer remains the lightweight
 * secondary path).
 *
 * Mirrors the edit surface's capabilities: title / type /
 * start–end / all-day (with the same reseed-on-toggle behavior as
 * EditEventForm), location, video URL, description, MATTER picker
 * (searchable, optional — matterless events are personal),
 * attendee picker (the same users + contacts + new-contact
 * autocomplete the detail modal uses, via ./attendee-picker), and
 * the visibility toggle.
 *
 * Submits through `createCalendarEvent` (gated on events.create).
 * The server auto-adds the creator as a firm attendee when the
 * posted list doesn't already include them, so an empty attendee
 * list is fine. On success we land on `/calendar?event=<id>` so
 * the new event opens in the detail modal for immediate review.
 *
 * Recurrence is deliberately absent — it needs an RRULE
 * data-model decision (schema change) and is tracked in
 * FEATURES.md as the remaining piece of event-create v2.
 */

"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Briefcase, Pin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DateTimeField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import { EVENT_TYPES, nextHourDateTimeString } from "@/lib/note-constants";
import { createCalendarEvent } from "@/app/actions/calendar-events";
import {
  createCalendarEventInitialState,
  type CreateCalendarEventState,
} from "@/lib/calendar-event-form";
import type { FilingMatterOption } from "@/lib/queries/communication";
import { DateOnlyField } from "./edit-event-form";
import {
  AttendeePicker,
  serializeAttendees,
  type EditableAttendee,
} from "./attendee-picker";

/** Strip a YYYY-MM-DDTHH:mm value down to just the date half. */
const dateOnly = (v: string): string => v.slice(0, 10);

/** Reseed helpers for the all-day → timed toggle — same 9am/10am
 *  defaults as EditEventForm / the matter event composer. */
const withDefaultStart = (v: string): string =>
  v.length === 10 || v.endsWith("T00:00") ? `${dateOnly(v)}T09:00` : v;
const withDefaultEnd = (v: string): string =>
  v.length === 10 || v.endsWith("T00:00") ? `${dateOnly(v)}T10:00` : v;

export function NewEventForm({
  matters,
}: {
  /** Open matters for the picker — pinned first (same option rows
   *  the email filing picker uses). Server-fetched by the page. */
  matters: FilingMatterOption[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    CreateCalendarEventState,
    FormData
  >(createCalendarEvent, createCalendarEventInitialState);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<(typeof EVENT_TYPES)[number]>("meeting");
  const [isAllDay, setIsAllDay] = useState(false);
  const [startTime, setStartTime] = useState(nextHourDateTimeString());
  const [endTime, setEndTime] = useState(nextHourDateTimeString(1));
  const [location, setLocation] = useState("");
  const [zoomUrl, setZoomUrl] = useState("");
  const [description, setDescription] = useState("");
  const [matterId, setMatterId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<EditableAttendee[]>([]);
  const [showDetails, setShowDetails] = useState(false);

  const toggleAllDay = (next: boolean) => {
    setIsAllDay(next);
    // Reseed times when toggling back to timed so the user doesn't
    // see midnight inputs the moment they uncheck.
    if (!next) {
      setStartTime((v) => withDefaultStart(v));
      setEndTime((v) => withDefaultEnd(v));
    }
  };

  useEffect(() => {
    if (state.status === "ok" && state.eventId) {
      // Land on the calendar with the fresh event's detail modal
      // open — instant confirmation the create took, plus a place
      // to keep editing (notes, time entries) without hunting for
      // the chip.
      router.push(`/calendar?event=${state.eventId}`);
    }
  }, [state.status, state.eventId, router]);

  const errs = state.errors ?? {};

  return (
    <div className="max-w-xl flex flex-col gap-4">
      <Link
        href="/calendar"
        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-brand-700 w-fit"
      >
        <ArrowLeft size={12} />
        Back to calendar
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
            onChange={(e) => toggleAllDay(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line"
          />
          All day
        </label>

        {isAllDay ? (
          <div className="grid grid-cols-2 gap-2">
            <DateOnlyField
              name="startTime"
              value={dateOnly(startTime)}
              onChange={(d) => setStartTime(`${d}T00:00`)}
              label="Start date"
              error={errs.startTime?.[0]}
            />
            <DateOnlyField
              name="endTime"
              value={dateOnly(endTime)}
              onChange={(d) => setEndTime(`${d}T00:00`)}
              label="End date"
              error={errs.endTime?.[0]}
            />
          </div>
        ) : (
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
        )}

        <div className="grid grid-cols-[auto_1fr] gap-2">
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
        </div>

        <TextField
          name="zoomUrl"
          value={zoomUrl}
          onChange={setZoomUrl}
          placeholder="Zoom / video URL (optional)"
          error={errs.zoomUrl?.[0]}
        />

        {/* Matter — optional. Matterless events are personal
            (visibility resolver treats them as the creator's);
            picking a matter scopes the event to the matter team. */}
        <div className="flex flex-col gap-1.5">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Matter
          </div>
          <MatterSelect
            options={matters}
            value={matterId}
            onChange={setMatterId}
          />
          <input type="hidden" name="matterId" value={matterId ?? ""} />
          {errs.matterId?.[0] && (
            <span className="text-2xs text-warn">{errs.matterId[0]}</span>
          )}
        </div>

        {/* Attendees — same picker as the detail modal (firm users
            + contacts + new-contact branch). The server auto-adds
            YOU as an attendee if the list doesn't include you, so
            leaving this empty is fine. */}
        <div className="flex flex-col gap-1.5">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Attendees
          </div>
          <AttendeePicker value={attendees} onCommit={setAttendees} />
          <input
            type="hidden"
            name="attendees"
            value={serializeAttendees(attendees)}
          />
          <span className="text-2xs text-ink-4">
            You&apos;ll be added automatically if you don&apos;t include
            yourself.
          </span>
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

        {/* Visibility — same semantics as the quick composer /
            modal toggle. */}
        <input
          type="hidden"
          name="visibility"
          value={showDetails ? "show_details" : "default"}
        />
        <label className="flex items-start gap-2 text-xs text-ink-3 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={showDetails}
            onChange={(e) => setShowDetails(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-line"
          />
          <span>
            <span className="text-ink">
              Show details to everyone in the firm
            </span>
            <span className="block text-2xs text-ink-4 leading-relaxed mt-0.5">
              Off: only invited attendees and the matter team see details.
              Others see &ldquo;Busy.&rdquo;
            </span>
          </span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
          <Link
            href="/calendar"
            className="text-xs text-ink-3 hover:text-ink px-3 py-1.5"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create event"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Searchable matter combobox. Client-side filter over the
 * server-fetched open-matter options (same "small enough to
 * filter locally" call the email FileToMatterPicker makes),
 * pinned matters first. Selection renders as a chip with a
 * clear button; the parent owns the value + hidden input.
 */
function MatterSelect({
  options,
  value,
  onChange,
}: {
  options: FilingMatterOption[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = value ? options.find((m) => m.id === value) ?? null : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.area.toLowerCase().includes(q)
    );
  }, [query, options]);

  // Close on outside click — same pattern as the attendee
  // autocomplete's dropdown.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (selected) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-line bg-paper-2 text-xs w-fit max-w-full">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: selected.color }}
        />
        <span className="text-ink truncate">{selected.name}</span>
        <span className="text-2xs font-mono text-ink-4 shrink-0">
          · {selected.area}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear matter"
          className="text-ink-4 hover:text-warn shrink-0"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (open) e.stopPropagation();
              setOpen(false);
            }
          }}
          placeholder="Search matters — or leave empty for a personal event"
          aria-label="Search matters"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="h-8 w-full pl-7 pr-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
        />
      </div>

      {open && (
        <ul
          role="listbox"
          aria-label="Matter options"
          className="absolute left-0 right-0 mt-1 z-50 max-h-64 overflow-y-auto rounded-md border border-line bg-white shadow-md"
        >
          {filtered.length === 0 ? (
            <li className="text-2xs text-ink-4 italic px-2.5 py-2">
              No matters match.
            </li>
          ) : (
            filtered.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left text-ink hover:bg-paper-2 transition-colors"
                >
                  <Briefcase size={11} className="text-ink-4 shrink-0" />
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: m.color }}
                  />
                  <span className="flex-1 truncate">{m.name}</span>
                  <span className="text-2xs font-mono text-ink-4 shrink-0">
                    {m.area}
                  </span>
                  {m.isPinned && (
                    <Pin
                      size={10}
                      className="text-ink-4 shrink-0"
                      aria-label="Pinned"
                    />
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
