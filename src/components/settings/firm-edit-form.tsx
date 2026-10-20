/**
 * Firm Edit Form — admin-only.
 *
 * Single-pane edit for the firm profile. The page renders this for
 * admins; non-admins see the read-only view instead. Fields are
 * grouped: Identity (name, short name, established, EIN, website,
 * logo) → Contact (phone, email) → Address (lines, city, state,
 * zip, country) → Goals (daily hours + monthly billable targets,
 * which drive the dashboard KPIs and the /time day-view goal line).
 *
 * Saved-state UX: the action toggles status="ok" on success; we
 * surface a brief "Saved" pill that lives until the next mutation.
 *
 * Submission is dispatched manually (not `<form action>`) so React 19
 * doesn't reset every field to the saved values after a rejected save
 * (e.g. a goal with two decimals) — the admin keeps their edits and
 * sees the error beside the field.
 */

"use client";

import { useActionState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateFirmAction } from "@/app/actions/firm";
import {
  firmInitialState,
  type FirmFormState,
} from "@/lib/firm-form";
import type { FirmGoals, FirmProfile } from "@/lib/firm";
import { dateOnlyKey } from "@/lib/format-date";
import { MatterNameTemplateField } from "./matter-name-template-field";
import { DEFAULT_MATTER_NAME_TEMPLATE } from "@/lib/matter-name-template";
import { Field, FormErrorBanner, formErrorMessage, inputClass } from "./form-field";

export function FirmEditForm({
  firm,
  goals,
}: {
  firm: FirmProfile;
  goals: FirmGoals;
}) {
  const [state, formAction, isPending] = useActionState<
    FirmFormState,
    FormData
  >(updateFirmAction, firmInitialState);
  const [, startTransition] = useTransition();

  const errs = state.errors ?? {};

  // establishedAt is a date-only value (UTC midnight, ADR-012): the
  // input's YYYY-MM-DD is its UTC calendar day on server and client
  // alike — never a local-zone getter.
  const establishedDateValue = firm.establishedAt
    ? dateOnlyKey(firm.establishedAt)
    : "";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="flex flex-col gap-6 max-w-2xl"
    >
      <SectionHeader label="Identity" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Firm name" required error={errs.name?.[0]}>
          {(c) => (
            <input
              {...c}
              name="name"
              type="text"
              required
              defaultValue={firm.name}
              className={inputClass(!!errs.name, "md")}
            />
          )}
        </Field>
        <Field
          label="Short name (optional)"
          hint="Used in places where the legal name is overkill."
          error={errs.shortName?.[0]}
        >
          {(c) => (
            <input
              {...c}
              name="shortName"
              type="text"
              defaultValue={firm.shortName ?? ""}
              placeholder={firm.name}
              className={inputClass(!!errs.shortName, "md")}
            />
          )}
        </Field>
        <Field
          label="EIN"
          hint="Federal tax ID — appears on invoices."
          error={errs.ein?.[0]}
        >
          {(c) => (
            <input
              {...c}
              name="ein"
              type="text"
              defaultValue={firm.ein ?? ""}
              placeholder="xx-xxxxxxx"
              className={inputClass(!!errs.ein, "md")}
            />
          )}
        </Field>
        <Field label="Established" error={errs.establishedAt?.[0]}>
          {(c) => (
            <input
              {...c}
              name="establishedAt"
              type="date"
              defaultValue={establishedDateValue}
              className={inputClass(!!errs.establishedAt, "md")}
            />
          )}
        </Field>
        <Field
          label="Website"
          error={errs.website?.[0]}
          className="sm:col-span-2"
        >
          {(c) => (
            <input
              {...c}
              name="website"
              type="url"
              defaultValue={firm.website ?? ""}
              placeholder="https://example.com"
              className={inputClass(!!errs.website, "md")}
            />
          )}
        </Field>
      </div>

      <SectionHeader label="Contact" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Phone" error={errs.phone?.[0]}>
          {(c) => (
            <input
              {...c}
              name="phone"
              type="tel"
              defaultValue={firm.phone ?? ""}
              placeholder="(555) 555-5555"
              className={inputClass(!!errs.phone, "md")}
            />
          )}
        </Field>
        <Field label="Email" error={errs.email?.[0]}>
          {(c) => (
            <input
              {...c}
              name="email"
              type="email"
              defaultValue={firm.email ?? ""}
              placeholder="info@example.com"
              className={inputClass(!!errs.email, "md")}
            />
          )}
        </Field>
      </div>

      <SectionHeader label="Address" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Address line 1"
          error={errs.addressLine1?.[0]}
          className="sm:col-span-2"
        >
          {(c) => (
            <input
              {...c}
              name="addressLine1"
              type="text"
              defaultValue={firm.addressLine1 ?? ""}
              className={inputClass(!!errs.addressLine1, "md")}
            />
          )}
        </Field>
        <Field
          label="Address line 2 (optional)"
          error={errs.addressLine2?.[0]}
          className="sm:col-span-2"
        >
          {(c) => (
            <input
              {...c}
              name="addressLine2"
              type="text"
              defaultValue={firm.addressLine2 ?? ""}
              placeholder="Suite, floor, etc."
              className={inputClass(!!errs.addressLine2, "md")}
            />
          )}
        </Field>
        <Field label="City" error={errs.city?.[0]}>
          {(c) => (
            <input
              {...c}
              name="city"
              type="text"
              defaultValue={firm.city ?? ""}
              className={inputClass(!!errs.city, "md")}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State" error={errs.state?.[0]}>
            {(c) => (
              <input
                {...c}
                name="state"
                type="text"
                defaultValue={firm.state ?? ""}
                maxLength={20}
                className={inputClass(!!errs.state, "md")}
              />
            )}
          </Field>
          <Field label="ZIP" error={errs.zip?.[0]}>
            {(c) => (
              <input
                {...c}
                name="zip"
                type="text"
                defaultValue={firm.zip ?? ""}
                className={inputClass(!!errs.zip, "md")}
              />
            )}
          </Field>
        </div>
        <Field
          label="Country"
          error={errs.country?.[0]}
          className="sm:col-span-2"
        >
          {(c) => (
            <input
              {...c}
              name="country"
              type="text"
              required
              defaultValue={firm.country}
              className={inputClass(!!errs.country, "md")}
            />
          )}
        </Field>
      </div>

      <SectionHeader label="Matter names" />
      <MatterNameTemplateField
        defaultValue={firm.matterNameTemplate ?? DEFAULT_MATTER_NAME_TEMPLATE}
        label="Default matter name template"
        hint="Practice areas can override this."
        error={errs.matterNameTemplate}
      />

      <SectionHeader label="Goals" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Daily hours goal"
          required
          error={errs.dailyHoursGoal?.[0]}
          hint="Per-person daily target — dashboard “Hours today” KPI and the Time day view."
        >
          {(c) => (
            <input
              {...c}
              name="dailyHoursGoal"
              type="number"
              required
              min={0.1}
              max={24}
              step={0.1}
              defaultValue={goals.dailyHoursGoal}
              className={inputClass(!!errs.dailyHoursGoal, "md")}
            />
          )}
        </Field>
        <Field
          label="Monthly billable goal"
          required
          error={errs.monthlyBillableGoal?.[0]}
          hint="Firm-wide billable hours per month — the Firm pulse card."
        >
          {(c) => (
            <input
              {...c}
              name="monthlyBillableGoal"
              type="number"
              required
              min={0.1}
              max={744}
              step={0.1}
              defaultValue={goals.monthlyBillableGoal}
              className={inputClass(!!errs.monthlyBillableGoal, "md")}
            />
          )}
        </Field>
      </div>

      <FormErrorBanner
        message={formErrorMessage(
          state,
          "Couldn’t save — check the highlighted fields."
        )}
      />

      <div className="flex items-center gap-3 pt-2 border-t border-line">
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-9 px-4 rounded-md text-sm font-medium",
            "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        {state.status === "ok" && (
          <span className="inline-flex items-center gap-1.5 text-2xs text-ok">
            <CheckCircle2 size={12} />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 -mb-3">
      {label}
    </div>
  );
}
