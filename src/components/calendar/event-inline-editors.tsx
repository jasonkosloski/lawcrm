/** Event Detail Modal — click-to-edit inline field editors. */

"use client";

import { useRef, useState, type ReactNode } from "react";
import { dateOnly, withDefaultEnd, withDefaultStart } from "@/lib/event-schedule";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";

// ── Inline editors ─────────────────────────────────────────────────────

const cellHover = "rounded-sm px-1 -mx-1 hover:bg-paper-2 cursor-text transition-colors";
const inputBase =
  "rounded-sm px-1 -mx-1 border border-brand-300 bg-white text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200";

/** Single-line inline text editor. View → click → input → blur/Enter
 *  commits. Renders a placeholder + dimmed copy when empty. The
 *  `renderDisplay` override lets callers (zoom URL row) swap a
 *  styled link for the plain string in view mode. */
export function InlineText({
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
  /** Return false to reject the value and keep the editor open. */
  onCommit: (v: string) => void | boolean;
  required?: boolean;
  maxLength?: number;
  ariaLabel: string;
  className?: string;
  renderDisplay?: (value: string) => ReactNode;
}) {
  // The input mounts fresh each time editing starts, so its
  // `defaultValue` is always the current `value`; there is no
  // separate draft to keep in sync.
  const [editing, setEditing] = useState(false);

  const commit = (raw: string) => {
    const next = raw;
    if (next === value) {
      setEditing(false);
      return;
    }
    if (required && next.trim().length === 0) {
      // Required field can't be cleared. Revert silently.
      setEditing(false);
      return;
    }
    if (onCommit(next) === false) return;
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        defaultValue={value}
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
          // A key pressed on a link INSIDE the display (the video
          // link) must reach that link, not open the editor.
          if (e.target !== e.currentTarget) return;
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
export function InlineTextarea({
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
        defaultValue={value}
        rows={4}
        maxLength={maxLength}
        aria-label={ariaLabel}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
        className={cn(inputBase, "w-full text-xs resize-y leading-relaxed")}
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
      className={cn(cellHover, "text-xs text-ink leading-relaxed whitespace-pre-wrap")}
    >
      {value}
    </p>
  );
}

/** Tiny native <NativeSelect>-style inline picker. Click to flip into
 *  a select; picking an option with the mouse commits + closes;
 *  Escape cancels. Arrow keys only MOVE the highlighted option
 *  (some browsers fire `change` on every arrow press of a closed
 *  select, which would save a neighbour on the first keystroke);
 *  the keyboard choice commits on Enter or blur. */
export function InlineSelect({
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
  // Option chosen with the keyboard, waiting for Enter / blur.
  const [pending, setPending] = useState<string | null>(null);
  const viaKeys = useRef(false);
  // Set once the picker has been resolved (committed or cancelled) so
  // a blur fired by the select unmounting can't commit a stale choice.
  const settled = useRef(false);

  const finish = (next: string | null) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    setPending(null);
    viaKeys.current = false;
    if (next !== null && next !== value) onCommit(next);
  };

  if (editing) {
    return (
      <NativeSelect
        autoFocus
        defaultValue={value}
        aria-label={ariaLabel}
        onPointerDown={() => {
          viaKeys.current = false;
        }}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (viaKeys.current) {
            setPending(next);
            return;
          }
          finish(next);
        }}
        onBlur={() => finish(pending)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // Cancel the picker only — don't let the Escape
            // bubble to the modal's close handler.
            e.stopPropagation();
            finish(null);
          } else if (e.key === "Enter") {
            e.preventDefault();
            finish(e.currentTarget.value);
          } else if (
            e.key === "ArrowUp" ||
            e.key === "ArrowDown" ||
            e.key === "Home" ||
            e.key === "End" ||
            e.key === "PageUp" ||
            e.key === "PageDown"
          ) {
            viaKeys.current = true;
          }
        }}
        size="sm"
      >
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }

  const label = options.find((o) => o.value === value)?.label ?? value;
  return (
    <button
      type="button"
      onClick={() => {
        settled.current = false;
        setEditing(true);
      }}
      aria-label={`Edit ${ariaLabel}`}
      className={cellHover}
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
export function InlineTimeEditor({
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
  onCommit: (changes: { isAllDay?: boolean; startTime?: string; endTime?: string }) => void;
  displayDate: string;
  displayRange: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draftIsAllDay, setDraftIsAllDay] = useState(isAllDay);
  const [draftStart, setDraftStart] = useState(startTime);
  const [draftEnd, setDraftEnd] = useState(endTime);

  // Seed the working copy from the current props every time the
  // editor opens (the modal also remounts per event id, so a draft
  // can never leak onto another event).
  const open = () => {
    setDraftIsAllDay(isAllDay);
    setDraftStart(startTime);
    setDraftEnd(endTime);
    setEditing(true);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Edit date and time"
        className={cn(cellHover, "flex flex-col leading-tight text-left")}
      >
        <span className="text-xs text-ink font-medium">{displayDate}</span>
        <span className="text-2xs text-ink-3 font-mono">{displayRange}</span>
      </button>
    );
  }

  const save = () => {
    if (draftIsAllDay === isAllDay && draftStart === startTime && draftEnd === endTime) {
      // Nothing changed: close without a pointless write.
      setEditing(false);
      return;
    }
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
  };

  return (
    <div
      className="flex flex-col gap-2 w-full"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Cancel the edit only; the modal stays open and the draft
          // is dropped deliberately, not by a stray close.
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    >
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
              setDraftStart((v) => withDefaultStart(v));
              setDraftEnd((v) => withDefaultEnd(v));
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
            value={draftIsAllDay ? dateOnly(draftStart) : draftStart}
            onChange={(e) =>
              setDraftStart(draftIsAllDay ? `${e.target.value}T00:00` : e.target.value)
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
              setDraftEnd(draftIsAllDay ? `${e.target.value}T00:00` : e.target.value)
            }
            className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
          />
        </label>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <Button size="xs" type="button" onClick={save}>
          <Check size={11} />
          Save
        </Button>
        <button type="button" onClick={cancel} className="text-2xs text-ink-3 hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}
