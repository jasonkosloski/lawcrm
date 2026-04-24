/**
 * Shared primary-form field primitives used by every Capture composer.
 *
 * These aren't the world's fanciest inputs — they're the compact
 * text/date/select/textarea styles that match the rest of the app at
 * our text-xs baseline. Each one wires name + value + onChange + an
 * inline error message so parents don't have to repeat the boilerplate.
 */

"use client";

import { cn } from "@/lib/utils";

export function TextField({
  name,
  value,
  onChange,
  placeholder,
  error,
  autoFocus,
  className,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <input
        name={name}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn(
          "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          "placeholder:text-ink-4",
          error ? "border-warn" : "border-line"
        )}
      />
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}

export function DateField({
  name,
  value,
  onChange,
  placeholder,
  error,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <input
        name={name}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder ?? "Date"}
        className={cn(
          "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          error ? "border-warn" : "border-line"
        )}
      />
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}

export function DateTimeField({
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
    <div className="flex flex-col gap-0.5">
      <label className="text-2xs text-ink-4">{label}</label>
      <input
        name={name}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          error ? "border-warn" : "border-line"
        )}
      />
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}

export function SelectField({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 px-2 rounded-md border border-line bg-white text-xs text-ink capitalize",
        "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
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

export function TextareaField({
  name,
  value,
  onChange,
  placeholder,
  rows = 3,
  error,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <textarea
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(
          "px-2.5 py-1.5 rounded-md border bg-white text-xs text-ink leading-relaxed",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          "placeholder:text-ink-4 resize-y font-sans",
          error ? "border-warn" : "border-line"
        )}
      />
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}
