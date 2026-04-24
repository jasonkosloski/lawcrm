/**
 * Edit Practice Area form — area metadata only (name, label, color).
 * Stages are managed separately in the StageManager. Saves in place
 * with a "saved" toast via the form state; on rename, the sidebar +
 * matter pickers pick up the new name via the server action's
 * `revalidatePath`.
 */

"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/utils";
import { updatePracticeArea } from "@/app/actions/practice-areas";
import {
  practiceAreaInitialState,
  type PracticeAreaFormState,
} from "@/lib/practice-area-constants";

export function EditPracticeAreaForm({
  area,
}: {
  area: {
    id: string;
    name: string;
    label: string | null;
    color: string;
    hasStatuteOfLimitations: boolean;
  };
}) {
  const boundAction = updatePracticeArea.bind(null, area.id);
  const [state, formAction, isPending] = useActionState<
    PracticeAreaFormState,
    FormData
  >(boundAction, practiceAreaInitialState);

  const vals = state.values ?? {};
  const errs = state.errors ?? {};

  const [color, setColor] = useState<string>(vals.color ?? area.color);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-start">
        <Field label="Name" error={errs.name}>
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={vals.name ?? area.name}
            required
            className={inputCls(!!errs.name)}
          />
        </Field>

        <Field label="Label" error={errs.label} hint="Sidebar/reports label">
          <input
            id="label"
            name="label"
            type="text"
            defaultValue={vals.label ?? area.label ?? ""}
            className={inputCls(!!errs.label)}
          />
        </Field>

        <Field label="Color" error={errs.color}>
          <div className="flex items-center gap-1.5 h-8">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 rounded-md border border-line cursor-pointer bg-white"
              aria-label="Color picker"
            />
            <input
              id="color"
              name="color"
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className={cn(inputCls(!!errs.color), "font-mono w-[94px]")}
              pattern="^#[0-9a-fA-F]{6}$"
            />
          </div>
        </Field>
      </div>

      {/* Uncontrolled — the DOM owns the checkbox state so a stale
          area prop or reset form-state from the action can't revert
          what the user just clicked. `defaultChecked` re-seeds only
          if the component remounts, which is the desired behavior
          after revalidatePath. */}
      <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
        <input
          type="checkbox"
          name="hasStatuteOfLimitations"
          defaultChecked={
            vals.hasStatuteOfLimitations === "on" ||
            (vals.hasStatuteOfLimitations === undefined &&
              area.hasStatuteOfLimitations)
          }
          className="w-3.5 h-3.5 rounded border-line mt-0.5"
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-ink-2">
            Track statute of limitations
          </span>
          <span className="text-2xs text-ink-4 leading-relaxed">
            When on, matters in this area get an SOL date + satisfied
            flag on the matter forms and a prominent countdown card on
            the Overview tab.
          </span>
        </div>
      </label>

      <div className="flex items-center justify-end gap-2">
        {state.status === "ok" && (
          <span className="text-2xs text-ok font-medium">Saved.</span>
        )}
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-8 px-3 rounded-md text-xs font-medium bg-brand-500 text-white",
            "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-2">{label}</span>
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

const inputCls = (hasError: boolean): string =>
  cn(
    "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );
