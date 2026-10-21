/**
 * Shared field chrome for the create + edit practice-area forms.
 *
 * `Field` renders a real <label> tied to the control by `htmlFor`, so
 * every input has an accessible name (and clicking the caption focuses
 * it). Callers pass the same `htmlFor` they give the control's `id`.
 */

import { cn } from "@/lib/utils";
import { REQUIRED_MATTER_FIELDS } from "@/lib/matter-required-fields";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error && error.length > 0 && (
        <div className="text-2xs text-warn">{error[0]}</div>
      )}
      {hint && !error?.length && (
        <div className="text-2xs text-ink-4">{hint}</div>
      )}
    </div>
  );
}

export const inputCls = (hasError: boolean): string =>
  cn(
    "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );

/**
 * "Required at creation" checkbox group. Posts `requiredMatterFields`
 * (one entry per checked box) plus the `requiredMatterFieldsPresent`
 * marker the update action needs before it changes the list.
 */
export function RequiredFieldsGroup({
  defaultChecked = [],
  tracksSol = true,
  error,
}: {
  defaultChecked?: readonly string[];
  /** Whether the area tracks the statute of limitations (incident date only applies then). */
  tracksSol?: boolean;
  error?: string[];
}) {
  return (
    <fieldset className="flex flex-col gap-2 px-3 py-2.5 rounded-md border border-line bg-paper-2/30">
      <legend className="px-1 text-2xs font-medium text-ink-3">
        Required at creation
      </legend>
      <input type="hidden" name="requiredMatterFieldsPresent" value="1" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
        {REQUIRED_MATTER_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-0.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                name="requiredMatterFields"
                value={f.key}
                defaultChecked={defaultChecked.includes(f.key)}
                className="w-3.5 h-3.5 rounded border-line"
              />
              <span className="text-xs text-ink-2">{f.label}</span>
            </label>
            {f.key === "incidentDate" && !tracksSol && (
              <span className="pl-[22px] text-2xs text-ink-4">
                Only applies when this area tracks the statute of limitations.
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="text-2xs text-ink-4 leading-relaxed">
        New matters in this area can&rsquo;t be created without these.
        Existing matters aren&rsquo;t affected unless someone clears a value
        they already had.
      </p>
      {error && error.length > 0 && (
        <div className="text-2xs text-warn">{error[0]}</div>
      )}
    </fieldset>
  );
}

/**
 * "Originating document" label (fee agreement, retainer, engagement
 * letter...). Blank falls back to "Fee agreement" wherever it shows.
 */
export function OriginatingDocField({
  defaultValue = "",
  error,
}: {
  defaultValue?: string;
  error?: string[];
}) {
  return (
    <Field
      label="Originating document"
      htmlFor="originatingDocLabel"
      error={error}
      hint="What this area calls the signed document that opens a matter. Leave blank for Fee agreement."
    >
      <input
        id="originatingDocLabel"
        name="originatingDocLabel"
        type="text"
        defaultValue={defaultValue}
        maxLength={80}
        placeholder="Fee agreement"
        className={inputCls(!!error?.length)}
      />
    </Field>
  );
}
