/**
 * Date-only field — mirrors the look of `DateTimeField`
 * (matters/captures/primary-fields) but renders an
 * `<input type="date">` and posts a `YYYY-MM-DD` value. Used by the
 * all-day branch of the standalone create form (new-event-form.tsx).
 *
 * The value is a calendar date, not an instant (ADR-012): the server
 * stores it with `parseDateOnly` and no zone is ever applied.
 */

"use client";

export function DateOnlyField({
  name,
  value,
  onChange,
  label,
  error,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-2xs text-ink-3">
      {label}
      <input
        type="date"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
      />
      {error && <span className="text-2xs text-warn">{error}</span>}
    </label>
  );
}
