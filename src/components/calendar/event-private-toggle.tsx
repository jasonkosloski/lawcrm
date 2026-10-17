/**
 * "Private event" checkbox shared by the event create surfaces and the
 * event detail modal (ADR-037).
 *
 * Private is the explicit per-event "hide this" choice: only the
 * creator sees details; everyone else (invitees and the matter team
 * included) sees a "Busy" block for the time range. It beats the
 * creator's show-details profile default and the per-event
 * "show details" toggle (the two are mutually exclusive: the parent
 * clears one when the other is checked). Google sync pushes it as a
 * Google-private event.
 */

"use client";

export function EventPrivateToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-ink-3 select-none cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 rounded border-line"
      />
      <span>
        <span className="text-ink">Private event</span>
        <span className="block text-2xs text-ink-4 leading-relaxed mt-0.5">
          Only you see the details. Everyone else, including invitees and
          the matter team, sees &ldquo;Busy&rdquo; for this time.
        </span>
      </span>
    </label>
  );
}
