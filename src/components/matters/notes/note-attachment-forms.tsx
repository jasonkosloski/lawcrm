/**
 * Inline composers for adding a task / deadline / time entry to an
 * existing note. Layout copies the EventTimeEntryComposer / TaskComposer
 * shapes so the inputs feel familiar.
 *
 * Each form posts to its dedicated note-attachment server action,
 * which sets `noteId` on the new row. Parent collapses the form on
 * successful save via the `onSaved` callback.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  addDeadlineToNote,
  addTaskToNote,
  addTimeEntryToNote,
  noteAttachmentInitialState,
  type NoteAttachmentFormState,
} from "@/app/actions/note-attachments";
import {
  DEADLINE_KINDS,
  TASK_PRIORITIES,
  todayDateString,
} from "@/lib/note-constants";

// ── Shared input primitives ────────────────────────────────────────────

const inputClass = cn(
  "h-7 px-2 rounded-md border border-line bg-white text-xs text-ink",
  "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
  "placeholder:text-ink-4"
);

const inputErrorClass = "border-warn";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div className="text-2xs text-warn">{msg}</div>;
}

function FormFooter({
  onCancel,
  isPending,
  hasContent,
  saveLabel,
}: {
  onCancel: () => void;
  isPending: boolean;
  hasContent: boolean;
  saveLabel: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="text-2xs text-ink-3 hover:text-ink-2 px-2"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isPending || !hasContent}
        className={cn(
          "inline-flex items-center h-7 px-3 rounded-md text-xs font-medium bg-brand-500 text-white",
          "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        )}
      >
        {isPending ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}

// ── Task ────────────────────────────────────────────────────────────────

export function AddTaskForm({
  noteId,
  onCancel,
  onSaved,
}: {
  noteId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const action = addTaskToNote.bind(null, noteId);
  const [state, formAction, isPending] = useActionState<
    NoteAttachmentFormState,
    FormData
  >(action, noteAttachmentInitialState);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (state.status === "ok") onSaved();
  }, [state.status, onSaved]);

  const errs = state.errors ?? {};
  const hasContent = title.trim().length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-start">
        <div className="flex flex-col gap-0.5 min-w-0">
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            autoFocus
            className={cn(inputClass, "w-full", errs.title && inputErrorClass)}
          />
          <FieldError msg={errs.title?.[0]} />
        </div>
        <div className="flex flex-col gap-0.5">
          <input
            type="date"
            name="dueDate"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Due date"
            className={cn(inputClass, errs.dueDate && inputErrorClass)}
          />
          <FieldError msg={errs.dueDate?.[0]} />
        </div>
        <select
          name="priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className={cn(inputClass, "capitalize")}
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <textarea
        name="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
        className={cn(
          "px-2 py-1.5 rounded-md border bg-white text-xs text-ink leading-relaxed",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          "placeholder:text-ink-4 resize-y font-sans",
          errs.description ? "border-warn" : "border-line"
        )}
      />

      <FormFooter
        onCancel={onCancel}
        isPending={isPending}
        hasContent={hasContent}
        saveLabel="Add task"
      />
    </form>
  );
}

// ── Deadline ────────────────────────────────────────────────────────────

export function AddDeadlineForm({
  noteId,
  onCancel,
  onSaved,
}: {
  noteId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const action = addDeadlineToNote.bind(null, noteId);
  const [state, formAction, isPending] = useActionState<
    NoteAttachmentFormState,
    FormData
  >(action, noteAttachmentInitialState);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [kind, setKind] = useState<(typeof DEADLINE_KINDS)[number]>("manual");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (state.status === "ok") onSaved();
  }, [state.status, onSaved]);

  const errs = state.errors ?? {};
  const hasContent = title.trim().length > 0 && dueDate.length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-start">
        <div className="flex flex-col gap-0.5 min-w-0">
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Deadline title (e.g. 'CGIA notice due')"
            autoFocus
            className={cn(inputClass, "w-full", errs.title && inputErrorClass)}
          />
          <FieldError msg={errs.title?.[0]} />
        </div>
        <div className="flex flex-col gap-0.5">
          <input
            type="date"
            name="dueDate"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Due date"
            className={cn(inputClass, errs.dueDate && inputErrorClass)}
          />
          <FieldError msg={errs.dueDate?.[0]} />
        </div>
        <select
          name="kind"
          value={kind}
          onChange={(e) =>
            setKind(e.target.value as (typeof DEADLINE_KINDS)[number])
          }
          className={cn(inputClass, "capitalize")}
        >
          {DEADLINE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <textarea
        name="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Why this deadline applies (optional)"
        rows={2}
        className={cn(
          "px-2 py-1.5 rounded-md border bg-white text-xs text-ink leading-relaxed",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          "placeholder:text-ink-4 resize-y font-sans",
          errs.description ? "border-warn" : "border-line"
        )}
      />

      <FormFooter
        onCancel={onCancel}
        isPending={isPending}
        hasContent={hasContent}
        saveLabel="Add deadline"
      />
    </form>
  );
}

// ── Time entry ──────────────────────────────────────────────────────────

export function AddTimeEntryForm({
  noteId,
  onCancel,
  onSaved,
}: {
  noteId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const action = addTimeEntryToNote.bind(null, noteId);
  const [state, formAction, isPending] = useActionState<
    NoteAttachmentFormState,
    FormData
  >(action, noteAttachmentInitialState);

  const [date, setDate] = useState(todayDateString());
  const [hours, setHours] = useState("");
  const [activity, setActivity] = useState("");
  const [narrative, setNarrative] = useState("");
  const [billable, setBillable] = useState(true);
  const [noCharge, setNoCharge] = useState(false);
  const [privileged, setPrivileged] = useState(false);

  useEffect(() => {
    if (state.status === "ok") onSaved();
  }, [state.status, onSaved]);

  const errs = state.errors ?? {};
  const hasContent = hours.trim().length > 0 && activity.trim().length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_auto_1fr] gap-2 items-start">
        <div className="flex flex-col gap-0.5">
          <input
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
            className={cn(inputClass, errs.date && inputErrorClass)}
          />
          <FieldError msg={errs.date?.[0]} />
        </div>
        <div className="flex flex-col gap-0.5">
          <input
            name="hours"
            type="text"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Hrs"
            inputMode="decimal"
            className={cn(
              inputClass,
              "w-20 font-mono",
              errs.hours && inputErrorClass
            )}
          />
          <FieldError msg={errs.hours?.[0]} />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <input
            name="activity"
            type="text"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            placeholder="Activity (e.g. 'Strategy memo · drafting')"
            className={cn(inputClass, "w-full", errs.activity && inputErrorClass)}
          />
          <FieldError msg={errs.activity?.[0]} />
        </div>
      </div>

      <textarea
        name="narrative"
        value={narrative}
        onChange={(e) => setNarrative(e.target.value)}
        placeholder="Narrative (optional, client-facing)"
        rows={2}
        className={cn(
          "px-2 py-1.5 rounded-md border bg-white text-xs text-ink leading-relaxed",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          "placeholder:text-ink-4 resize-y font-sans",
          errs.narrative ? "border-warn" : "border-line"
        )}
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-2xs text-ink-2">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              name="billable"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-line"
            />
            Billable
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              name="noCharge"
              checked={noCharge}
              onChange={(e) => setNoCharge(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-line"
            />
            No charge
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              name="privileged"
              checked={privileged}
              onChange={(e) => setPrivileged(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-line"
            />
            Privileged
          </label>
        </div>

        <FormFooter
          onCancel={onCancel}
          isPending={isPending}
          hasContent={hasContent}
          saveLabel="Log time"
        />
      </div>
    </form>
  );
}
