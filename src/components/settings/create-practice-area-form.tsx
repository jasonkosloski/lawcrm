/**
 * Create Practice Area form — inline on the settings list page.
 *
 * Collapsed to a single-row grid (name, optional label, color,
 * submit) so adding a new area stays a lightweight action. On submit,
 * the server action seeds the default 10-stage lifecycle and
 * redirects to the new area's detail page where the admin can
 * customize the stages.
 */

"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/utils";
import { createPracticeArea } from "@/app/actions/practice-areas";
import {
  practiceAreaInitialState,
  type PracticeAreaFormState,
} from "@/lib/practice-area-constants";

const DEFAULT_COLOR = "#2563a8";

export function CreatePracticeAreaForm() {
  const [state, formAction, isPending] = useActionState<
    PracticeAreaFormState,
    FormData
  >(createPracticeArea, practiceAreaInitialState);

  const vals = state.values ?? {};
  const errs = state.errors ?? {};

  const [color, setColor] = useState<string>(vals.color ?? DEFAULT_COLOR);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-start">
        <Field label="Name" error={errs.name}>
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={vals.name ?? ""}
            required
            placeholder="§1983, Employment/CADA, Guardianships…"
            className={inputCls(!!errs.name)}
          />
        </Field>

        <Field label="Label" error={errs.label} hint="Optional — longer label for sidebar">
          <input
            id="label"
            name="label"
            type="text"
            defaultValue={vals.label ?? ""}
            placeholder="§1983 · Civil rights"
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

        <div className="flex flex-col">
          <span className="text-xs font-medium text-ink-2 mb-1 invisible">
            submit
          </span>
          <button
            type="submit"
            disabled={isPending}
            className={cn(
              "inline-flex items-center h-8 px-3 rounded-md text-xs font-medium bg-brand-500 text-white",
              "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            {isPending ? "Adding…" : "Add area"}
          </button>
        </div>
      </div>

      <div className="text-2xs text-ink-4">
        New areas start with the default 10-stage lifecycle (Intake →
        Closed). Rename, reorder, or replace them on the detail page.
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
