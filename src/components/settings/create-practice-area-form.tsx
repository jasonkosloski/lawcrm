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

import { useActionState, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { createPracticeArea } from "@/app/actions/practice-areas";
import {
  OriginatingDocField,
  RequiredFieldsGroup,
} from "@/components/settings/practice-area-form-parts";
import { MatterNameTemplateField } from "@/components/settings/matter-name-template-field";
import { DEFAULT_MATTER_NAME_TEMPLATE } from "@/lib/matter-name-template";
import {
  practiceAreaInitialState,
  type PracticeAreaFormState,
} from "@/lib/practice-area-constants";
import { Field, inputClass } from "@/components/ui/field";

const DEFAULT_COLOR = "#2563a8";

export function CreatePracticeAreaForm({
  firmTemplate,
}: {
  firmTemplate?: string;
}) {
  const [state, formAction, isPending] = useActionState<
    PracticeAreaFormState,
    FormData
  >(createPracticeArea, practiceAreaInitialState);

  const vals = state.values ?? {};
  const errs = state.errors ?? {};

  // React 19 resets a <form action={fn}> after every submission,
  // including one that returns a validation error - which reverted the
  // SOL checkbox (so a name collision then re-created the area without
  // SOL tracking). Submit through onSubmit + startTransition instead
  // (no automatic reset) with controlled fields. A successful create
  // redirects away, so nothing needs resetting.
  const [, startTransition] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };

  const [name, setName] = useState<string>(vals.name ?? "");
  const [label, setLabel] = useState<string>(vals.label ?? "");
  const [hasSol, setHasSol] = useState(false);
  const [color, setColor] = useState<string>(vals.color ?? DEFAULT_COLOR);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-start">
        <Field label="Name" htmlFor="name" error={errs.name}>
          <input
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="§1983, Employment/CADA, Guardianships…"
            className={inputClass(!!errs.name)}
          />
        </Field>

        <Field label="Label" htmlFor="label" error={errs.label} hint="Optional — longer label for sidebar">
          <input
            id="label"
            name="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="§1983 · Civil rights"
            className={inputClass(!!errs.label)}
          />
        </Field>

        <Field label="Color" htmlFor="color" error={errs.color}>
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
              className={cn(inputClass(!!errs.color), "font-mono w-[94px]")}
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
              "inline-flex items-center h-8 px-3 rounded-md text-xs font-medium bg-brand-700 hover:bg-brand-900 text-white",
              "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            {isPending ? "Adding…" : "Add area"}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          name="hasStatuteOfLimitations"
          checked={hasSol}
          onChange={(e) => setHasSol(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-line"
        />
        <span className="text-2xs text-ink-2">
          Track statute of limitations on matters in this area
        </span>
      </label>

      <MatterNameTemplateField
        defaultValue=""
        placeholder={firmTemplate ?? DEFAULT_MATTER_NAME_TEMPLATE}
        practiceAreaName={name.trim() || undefined}
        hint="Optional. Leave blank to use the firm's template."
        error={errs.matterNameTemplate}
      />

      <OriginatingDocField
        defaultValue={vals.originatingDocLabel ?? ""}
        error={errs.originatingDocLabel}
      />

      <RequiredFieldsGroup tracksSol={hasSol} error={errs.requiredMatterFields} />

      <div className="text-2xs text-ink-4">
        New areas start with the default 10-stage lifecycle (Intake →
        Closed). Rename, reorder, or replace them on the detail page.
      </div>
    </form>
  );
}
