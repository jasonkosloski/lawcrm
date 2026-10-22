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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { inputClass, textareaClass } from "@/components/ui/field";

export function TextField({
  name,
  value,
  onChange,
  placeholder,
  error,
  autoFocus,
  className,
  maxLength,
  ariaLabel,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  autoFocus?: boolean;
  className?: string;
  /** Cheap client-side guard matching the server schema's cap. */
  maxLength?: number;
  /** Persistent accessible name - a placeholder vanishes once the
   *  field is filled, so fields that must stay identifiable (To / Cc
   *  / Subject) pass one. */
  ariaLabel?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <input
        name={name}
        type="text"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        className={inputClass(!!error)}
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
        className={inputClass(!!error)}
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
        className={inputClass(!!error)}
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
  ariaLabel,
  capitalize = true,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  /** Accessible name ("Priority", "Deadline kind", …). Pass it from
   *  every caller: a bare <select> reads as just "combo box". */
  ariaLabel?: string;
  /** Capitalize option text (right for enum labels like "high");
   *  turn off for free-form text such as email addresses. */
  capitalize?: boolean;
}) {
  return (
    <NativeSelect
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={cn(capitalize && "[&_select]:capitalize")}
    >
      {options.map((o) => (
        <NativeSelectOption key={o.value} value={o.value}>
          {o.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function TextareaField({
  name,
  value,
  onChange,
  placeholder,
  rows = 3,
  error,
  maxLength,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  error?: string;
  maxLength?: number;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <textarea
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className={cn(textareaClass(!!error), "leading-relaxed resize-y font-sans")}
      />
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}
