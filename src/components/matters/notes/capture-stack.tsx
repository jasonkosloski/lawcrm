/**
 * Capture Stack — "Also capture" sibling-record controls for the note
 * composer.
 *
 * Renders:
 *   - A row of [+ Task] [+ Event] [+ Deadline] [+ Time] buttons
 *   - A stack of compact mini-forms, one per capture the user has
 *     queued, each with an X to remove it
 *
 * Captures are local state owned by the parent composer; this
 * component mutates them via callbacks. The parent serializes the
 * stack to a hidden `attachments` JSON field before submit, and the
 * server action creates the note + all sibling records in a single
 * transaction.
 */

"use client";

import { useId } from "react";
import {
  Calendar,
  CircleAlert,
  Clock,
  ListTodo,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CAPTURE_KIND_LABEL,
  DEADLINE_KINDS,
  EVENT_TYPES,
  TASK_PRIORITIES,
  newCapture,
  type CaptureKind,
  type DeadlineCapture,
  type EventCapture,
  type NoteCapture,
  type TaskCapture,
  type TimeCapture,
} from "@/lib/note-constants";

const KIND_ICON: Record<CaptureKind, typeof ListTodo> = {
  task: ListTodo,
  event: Calendar,
  deadline: CircleAlert,
  time: Clock,
};

const CAPTURE_ORDER: CaptureKind[] = ["task", "event", "deadline", "time"];

export function CaptureStack({
  captures,
  onChange,
  errors,
}: {
  captures: NoteCapture[];
  onChange: (next: NoteCapture[]) => void;
  /** Per-capture field errors keyed by tempId, surfaced inline. */
  errors?: Record<string, Record<string, string[]>>;
}) {
  const idPrefix = useId();
  let localCounter = 0;
  const nextId = () => `cap-${idPrefix}-${++localCounter}-${Date.now()}`;

  const add = (kind: CaptureKind) => {
    onChange([...captures, newCapture(kind, nextId())]);
  };
  const remove = (tempId: string) => {
    onChange(captures.filter((c) => c.tempId !== tempId));
  };
  const update = (tempId: string, patch: Partial<NoteCapture>) => {
    onChange(
      captures.map((c) =>
        c.tempId === tempId ? ({ ...c, ...patch } as NoteCapture) : c
      )
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Also capture
        </span>
        {CAPTURE_ORDER.map((kind) => {
          const Icon = KIND_ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => add(kind)}
              className={cn(
                "inline-flex items-center gap-1 h-6 px-2 rounded-md text-2xs font-medium border transition-colors",
                "bg-white text-ink-2 border-line hover:border-brand-300 hover:text-brand-700"
              )}
            >
              <Plus size={11} />
              <Icon size={11} />
              {CAPTURE_KIND_LABEL[kind]}
            </button>
          );
        })}
      </div>

      {captures.length > 0 && (
        <div className="flex flex-col gap-2">
          {captures.map((cap) => (
            <CaptureCard
              key={cap.tempId}
              capture={cap}
              errors={errors?.[cap.tempId]}
              onUpdate={(patch) => update(cap.tempId, patch)}
              onRemove={() => remove(cap.tempId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── One capture card ────────────────────────────────────────────────────

function CaptureCard({
  capture,
  errors,
  onUpdate,
  onRemove,
}: {
  capture: NoteCapture;
  errors?: Record<string, string[]>;
  onUpdate: (patch: Partial<NoteCapture>) => void;
  onRemove: () => void;
}) {
  const Icon = KIND_ICON[capture.kind];
  return (
    <div className="rounded-md border border-line bg-paper-2/30 p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon size={12} className="text-ink-3 shrink-0" />
        <span className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          {CAPTURE_KIND_LABEL[capture.kind]}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this capture"
          className="ml-auto p-0.5 rounded text-ink-4 hover:text-ink-2"
        >
          <X size={12} />
        </button>
      </div>

      {capture.kind === "task" && (
        <TaskFields
          capture={capture}
          errors={errors}
          onUpdate={(patch) => onUpdate(patch as Partial<TaskCapture>)}
        />
      )}
      {capture.kind === "event" && (
        <EventFields
          capture={capture}
          errors={errors}
          onUpdate={(patch) => onUpdate(patch as Partial<EventCapture>)}
        />
      )}
      {capture.kind === "deadline" && (
        <DeadlineFields
          capture={capture}
          errors={errors}
          onUpdate={(patch) => onUpdate(patch as Partial<DeadlineCapture>)}
        />
      )}
      {capture.kind === "time" && (
        <TimeFields
          capture={capture}
          errors={errors}
          onUpdate={(patch) => onUpdate(patch as Partial<TimeCapture>)}
        />
      )}
    </div>
  );
}

// ── Per-kind field groups ───────────────────────────────────────────────

function TaskFields({
  capture,
  errors,
  onUpdate,
}: {
  capture: TaskCapture;
  errors?: Record<string, string[]>;
  onUpdate: (patch: Partial<TaskCapture>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <TextInput
        placeholder="Task title"
        value={capture.title}
        onChange={(v) => onUpdate({ title: v })}
        error={errors?.title?.[0]}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <DateInput
          value={capture.dueDate}
          onChange={(v) => onUpdate({ dueDate: v })}
          placeholder="Due date (optional)"
          error={errors?.dueDate?.[0]}
        />
        <Select
          value={capture.priority}
          onChange={(v) => onUpdate({ priority: v as TaskCapture["priority"] })}
          options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
        />
      </div>
    </div>
  );
}

function EventFields({
  capture,
  errors,
  onUpdate,
}: {
  capture: EventCapture;
  errors?: Record<string, string[]>;
  onUpdate: (patch: Partial<EventCapture>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <TextInput
        placeholder="Event title"
        value={capture.title}
        onChange={(v) => onUpdate({ title: v })}
        error={errors?.title?.[0]}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <DateTimeInput
          label="Start"
          value={capture.startTime}
          onChange={(v) => onUpdate({ startTime: v })}
          error={errors?.startTime?.[0]}
        />
        <DateTimeInput
          label="End"
          value={capture.endTime}
          onChange={(v) => onUpdate({ endTime: v })}
          error={errors?.endTime?.[0]}
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Select
          value={capture.type}
          onChange={(v) => onUpdate({ type: v as EventCapture["type"] })}
          options={EVENT_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") }))}
        />
        <TextInput
          placeholder="Location (optional)"
          value={capture.location}
          onChange={(v) => onUpdate({ location: v })}
        />
      </div>
    </div>
  );
}

function DeadlineFields({
  capture,
  errors,
  onUpdate,
}: {
  capture: DeadlineCapture;
  errors?: Record<string, string[]>;
  onUpdate: (patch: Partial<DeadlineCapture>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <TextInput
        placeholder="Deadline title"
        value={capture.title}
        onChange={(v) => onUpdate({ title: v })}
        error={errors?.title?.[0]}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <DateInput
          value={capture.dueDate}
          onChange={(v) => onUpdate({ dueDate: v })}
          placeholder="Due date"
          error={errors?.dueDate?.[0]}
        />
        <Select
          value={capture.kind_}
          onChange={(v) => onUpdate({ kind_: v as DeadlineCapture["kind_"] })}
          options={DEADLINE_KINDS.map((k) => ({
            value: k,
            label: k.replace("_", " "),
          }))}
        />
      </div>
      <TextInput
        placeholder="Why this deadline applies (optional)"
        value={capture.description}
        onChange={(v) => onUpdate({ description: v })}
      />
    </div>
  );
}

function TimeFields({
  capture,
  errors,
  onUpdate,
}: {
  capture: TimeCapture;
  errors?: Record<string, string[]>;
  onUpdate: (patch: Partial<TimeCapture>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[auto_auto_1fr] gap-1.5 items-start">
        <DateInput
          value={capture.date}
          onChange={(v) => onUpdate({ date: v })}
          error={errors?.date?.[0]}
        />
        <TextInput
          placeholder="Hours"
          value={capture.hours}
          onChange={(v) => onUpdate({ hours: v })}
          error={errors?.hours?.[0]}
          className="w-20 font-mono"
          inputMode="decimal"
        />
        <TextInput
          placeholder="Activity (e.g. 'Motion to compel · draft')"
          value={capture.activity}
          onChange={(v) => onUpdate({ activity: v })}
          error={errors?.activity?.[0]}
        />
      </div>
      <TextInput
        placeholder="Narrative (optional, client-facing)"
        value={capture.narrative}
        onChange={(v) => onUpdate({ narrative: v })}
      />
    </div>
  );
}

// ── Low-level inputs ────────────────────────────────────────────────────

function TextInput({
  value,
  onChange,
  placeholder,
  error,
  className,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  className?: string;
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={cn(
          "h-7 px-2 rounded-md border bg-white text-xs text-ink w-full",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          "placeholder:text-ink-4",
          error ? "border-warn" : "border-line",
          className
        )}
      />
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}

function DateInput({
  value,
  onChange,
  placeholder,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder ?? "Date"}
        className={cn(
          "h-7 px-2 rounded-md border bg-white text-xs text-ink w-full",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          error ? "border-warn" : "border-line"
        )}
      />
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}

function DateTimeInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          "h-7 px-2 rounded-md border bg-white text-xs text-ink w-full",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          error ? "border-warn" : "border-line"
        )}
      />
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 px-2 rounded-md border border-line bg-white text-xs text-ink",
        "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 capitalize"
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
