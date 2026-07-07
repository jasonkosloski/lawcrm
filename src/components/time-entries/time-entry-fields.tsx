/**
 * Shared time-entry v2 field primitives, used by every composer that
 * writes a TimeEntry (matter Time-tab composer, log-time-on-entity
 * dialog, edit dialog, stop-timer dialog):
 *
 *   - UtbmsCodeSelect — UTBMS code picker over the catalog in
 *     `src/lib/time-entry-constants.ts` (A100 activity set + L100
 *     litigation task set), grouped via <optgroup>. Optional field;
 *     posts "" when unset.
 *
 *   - DurationFields — the duration input with two modes:
 *       "hours"  — decimal-hours text input (the original behavior)
 *       "range"  — start–end time pair that computes decimal hours
 *     Either way the parent owns a single `hours` string state and
 *     the form posts exactly one `hours` value (visible input in
 *     hours mode, hidden input in range mode), so no server action
 *     needed schema changes for the range mode. The third duration
 *     source — timer-elapsed — is just a prefill of `hours` by the
 *     stop-timer dialog; it isn't a mode here.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  UTBMS_ACTIVITY_CODES,
  UTBMS_LITIGATION_TASK_CODES,
  computeHoursFromTimeRange,
} from "@/lib/time-entry-constants";

export function UtbmsCodeSelect({
  value,
  onChange,
  name = "utbmsCode",
  error,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  name?: string;
  error?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="UTBMS code"
        className={cn(
          "h-8 px-2 rounded-md border bg-white text-xs",
          value ? "text-ink" : "text-ink-4",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          error ? "border-warn" : "border-line"
        )}
      >
        <option value="">UTBMS code (optional)</option>
        <optgroup label="Activity (A100)">
          {UTBMS_ACTIVITY_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Litigation task (L100–L500)">
          {UTBMS_LITIGATION_TASK_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.label}
            </option>
          ))}
        </optgroup>
      </select>
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}

type DurationMode = "hours" | "range";

export function DurationFields({
  hours,
  onHoursChange,
  error,
  autoFocus,
  className,
}: {
  /** Parent-owned decimal-hours string — the single source of truth
   *  that gets posted as `hours` in both modes. */
  hours: string;
  onHoursChange: (v: string) => void;
  error?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [mode, setMode] = useState<DurationMode>("hours");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // Recompute hours whenever either end of the range moves. An
  // incomplete/invalid range clears hours (rather than keeping a
  // stale value) so the Save gate reflects what will actually post.
  const applyRange = (s: string, e: string) => {
    setStart(s);
    setEnd(e);
    const computed = computeHoursFromTimeRange(s, e);
    onHoursChange(computed !== null ? String(computed) : "");
  };

  const modeButton = (m: DurationMode, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (m === mode) return;
        setMode(m);
        // Entering range mode: recompute from whatever range is set
        // (usually empty → clears hours until times are picked).
        if (m === "range") {
          const computed = computeHoursFromTimeRange(start, end);
          onHoursChange(computed !== null ? String(computed) : "");
        }
      }}
      className={cn(
        "px-1.5 h-5 rounded text-2xs leading-none transition-colors",
        m === mode
          ? "bg-brand-soft text-brand-700 font-medium"
          : "text-ink-4 hover:text-ink-2"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <div className="flex items-center gap-1">
        {mode === "hours" ? (
          <input
            name="hours"
            type="text"
            value={hours}
            onChange={(e) => onHoursChange(e.target.value)}
            placeholder="Hrs"
            autoFocus={autoFocus}
            className={cn(
              "h-8 w-16 px-2.5 rounded-md border bg-white text-xs text-ink font-mono",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4 placeholder:font-sans",
              error ? "border-warn" : "border-line"
            )}
          />
        ) : (
          <>
            {/* Range mode still posts a single `hours` value. */}
            <input type="hidden" name="hours" value={hours} />
            <input
              type="time"
              value={start}
              onChange={(e) => applyRange(e.target.value, end)}
              aria-label="Start time"
              className={cn(
                "h-8 px-1.5 rounded-md border bg-white text-xs text-ink",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                error ? "border-warn" : "border-line"
              )}
            />
            <span className="text-2xs text-ink-4">–</span>
            <input
              type="time"
              value={end}
              onChange={(e) => applyRange(start, e.target.value)}
              aria-label="End time"
              className={cn(
                "h-8 px-1.5 rounded-md border bg-white text-xs text-ink",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                error ? "border-warn" : "border-line"
              )}
            />
            <span
              className="text-2xs font-mono text-ink-3 whitespace-nowrap"
              data-testid="range-computed-hours"
            >
              {hours ? `= ${hours} h` : "= —"}
            </span>
          </>
        )}
        <div className="flex items-center gap-0.5 ml-1">
          {modeButton("hours", "hrs")}
          {modeButton("range", "start–end")}
        </div>
      </div>
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}
