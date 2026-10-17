/**
 * Edit Practice Area form — area metadata only (name, label, color).
 * Stages are managed separately in the StageManager. Saves in place
 * with a "saved" toast via the form state; on rename, the sidebar +
 * matter pickers pick up the new name via the server action's
 * `revalidatePath`.
 */

"use client";

import { useActionState, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updatePracticeArea } from "@/app/actions/practice-areas";
import {
  Field,
  inputCls,
} from "@/components/settings/practice-area-form-parts";
import { unpackStatuteDays } from "@/lib/sol";
import {
  practiceAreaInitialState,
  type PracticeAreaFormState,
} from "@/lib/practice-area-constants";
import {
  BILLING_MODES,
  BILLING_MODE_DESCRIPTION,
  BILLING_MODE_LABEL,
  type BillingMode,
} from "@/lib/billing-mode-constants";

export function EditPracticeAreaForm({
  area,
}: {
  area: {
    id: string;
    name: string;
    label: string | null;
    color: string;
    hasStatuteOfLimitations: boolean;
    statutePeriodDays: number | null;
    statuteSourceCitation: string | null;
    defaultBillingMode: string;
  };
}) {
  const boundAction = updatePracticeArea.bind(null, area.id);
  const [state, formAction, isPending] = useActionState<
    PracticeAreaFormState,
    FormData
  >(boundAction, practiceAreaInitialState);

  const errs = state.errors ?? {};

  // React 19 resets a <form action={fn}> after every submission —
  // including one that returns a validation error — which used to
  // revert the SOL period, citation and checkbox to the stored row
  // while the name kept the user's text (fixing the name and saving
  // then persisted the OLD period). So the form submits through
  // onSubmit + startTransition instead: no automatic form reset, and
  // the fields (controlled below) keep exactly what the user typed
  // until a successful save revalidates the page.
  const [, startTransition] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };
  const period = unpackStatuteDays(area.statutePeriodDays);
  const [name, setName] = useState(area.name);
  const [label, setLabel] = useState(area.label ?? "");
  const [color, setColor] = useState<string>(area.color);
  const [hasSol, setHasSol] = useState(area.hasStatuteOfLimitations);
  const [years, setYears] = useState(period.years ? String(period.years) : "");
  const [months, setMonths] = useState(
    period.months ? String(period.months) : ""
  );
  const [days, setDays] = useState(period.days ? String(period.days) : "");
  const [citation, setCitation] = useState(area.statuteSourceCitation ?? "");
  const [billingMode, setBillingMode] = useState<string>(
    area.defaultBillingMode
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-start">
        <Field label="Name" htmlFor="name" error={errs.name}>
          <input
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputCls(!!errs.name)}
          />
        </Field>

        <Field label="Label" htmlFor="label" error={errs.label} hint="Sidebar/reports label">
          <input
            id="label"
            name="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputCls(!!errs.label)}
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
              className={cn(inputCls(!!errs.color), "font-mono w-[94px]")}
              pattern="^#[0-9a-fA-F]{6}$"
            />
          </div>
        </Field>
      </div>

      <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
        <input
          type="checkbox"
          name="hasStatuteOfLimitations"
          checked={hasSol}
          onChange={(e) => setHasSol(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-line mt-0.5"
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-ink-2">
            Track statute of limitations
          </span>
          <span className="text-2xs text-ink-4 leading-relaxed">
            When on, matters in this area get an SOL date + satisfied
            flag on the matter forms and a prominent countdown card on
            the Overview tab. Turning it off only stops new SOL dates
            from being computed: existing matters keep their SOL dates
            and SOL deadlines, and this area keeps its saved period and
            citation in case you turn tracking back on.
          </span>
        </div>
      </label>

      {/* Statute period editor. Only relevant when the SOL toggle
          above is on; we render unconditionally and the action
          ignores the values (keeping the stored ones) when the toggle
          is off. Pre-fills from
          the area's stored total days, unpacked back into y/m/d so
          the lawyer sees the same shape they typed last time. */}
      <fieldset className="flex flex-col gap-2 px-3 py-2.5 rounded-md border border-line bg-paper-2/30">
        <legend className="px-1 text-2xs font-mono uppercase tracking-wider text-ink-4">
          Statute period (auto-computes Matter SOL date from incident)
        </legend>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Years" htmlFor="statuteYears">
            <input
              id="statuteYears"
              type="number"
              name="statuteYears"
              min={0}
              value={years}
              onChange={(e) => setYears(e.target.value)}
              className={inputCls(false)}
            />
          </Field>
          <Field label="Months" htmlFor="statuteMonths">
            <input
              id="statuteMonths"
              type="number"
              name="statuteMonths"
              min={0}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              className={inputCls(false)}
            />
          </Field>
          <Field label="Days" htmlFor="statuteDays">
            <input
              id="statuteDays"
              type="number"
              name="statuteDays"
              min={0}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={inputCls(false)}
            />
          </Field>
        </div>
        <Field
          label="Source citation"
          htmlFor="statuteSourceCitation"
          hint="e.g. C.R.S. § 13-80-102 — surfaces on the SOL card so attorneys can verify against the statute"
        >
          <input
            id="statuteSourceCitation"
            name="statuteSourceCitation"
            type="text"
            value={citation}
            onChange={(e) => setCitation(e.target.value)}
            maxLength={120}
            className={inputCls(false)}
          />
        </Field>
        <p className="text-2xs text-ink-4 leading-relaxed">
          The period is stored as total days = years × 365 + months × 30
          + days. Months are therefore approximate: a statute written in
          calendar months (e.g. &ldquo;3 months&rdquo;) can end one or
          two days earlier than the computed date. For month-based
          periods, verify the computed SOL date against the statute and
          override it on the matter when it differs.
        </p>
      </fieldset>

      {/* Default billing mode — snapshots onto each new matter on
          create. Per-matter override happens on the matter edit
          form, so changing this here only affects future matters. */}
      <Field
        label="Default billing mode"
        htmlFor="defaultBillingMode"
        error={errs.defaultBillingMode}
        hint={
          BILLING_MODE_DESCRIPTION[billingMode as BillingMode]
        }
      >
        <select
          id="defaultBillingMode"
          name="defaultBillingMode"
          value={billingMode}
          onChange={(e) => setBillingMode(e.target.value)}
          className={cn(inputCls(!!errs.defaultBillingMode), "max-w-xs")}
        >
          {BILLING_MODES.map((m) => (
            <option key={m} value={m}>
              {BILLING_MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </Field>

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
