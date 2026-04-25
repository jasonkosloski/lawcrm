/**
 * Firm Edit Form — admin-only.
 *
 * Single-pane edit for the firm profile. The page renders this for
 * admins; non-admins see the read-only view instead. Fields are
 * grouped: Identity (name, short name, established, EIN, website,
 * logo) → Contact (phone, email) → Address (lines, city, state,
 * zip, country).
 *
 * Saved-state UX: the action toggles status="ok" on success; we
 * surface a brief "Saved" pill that fades after a few seconds (no
 * timer for now — just lives until the next mutation).
 */

"use client";

import { useActionState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateFirmAction } from "@/app/actions/firm";
import {
  firmInitialState,
  type FirmFormState,
} from "@/lib/firm-form";
import type { FirmProfile } from "@/lib/firm";

export function FirmEditForm({ firm }: { firm: FirmProfile }) {
  const [state, formAction, isPending] = useActionState<
    FirmFormState,
    FormData
  >(updateFirmAction, firmInitialState);

  const errs = state.errors ?? {};

  // Format the establishedAt date as YYYY-MM-DD for <input type="date">.
  const establishedDateValue = firm.establishedAt
    ? `${firm.establishedAt.getFullYear()}-${String(firm.establishedAt.getMonth() + 1).padStart(2, "0")}-${String(firm.establishedAt.getDate()).padStart(2, "0")}`
    : "";

  return (
    <form action={formAction} className="flex flex-col gap-6 max-w-2xl">
      <SectionHeader label="Identity" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Firm name" name="name" required error={errs.name?.[0]}>
          <input
            name="name"
            type="text"
            required
            defaultValue={firm.name}
            className={inputClass(!!errs.name)}
          />
        </Field>
        <Field label="Short name (optional)" name="shortName" hint="Used in places where the legal name is overkill.">
          <input
            name="shortName"
            type="text"
            defaultValue={firm.shortName ?? ""}
            placeholder={firm.name}
            className={inputClass(!!errs.shortName)}
          />
        </Field>
        <Field label="EIN" name="ein" hint="Federal tax ID — appears on invoices.">
          <input
            name="ein"
            type="text"
            defaultValue={firm.ein ?? ""}
            placeholder="xx-xxxxxxx"
            className={inputClass(!!errs.ein)}
          />
        </Field>
        <Field label="Established" name="establishedAt">
          <input
            name="establishedAt"
            type="date"
            defaultValue={establishedDateValue}
            className={inputClass(!!errs.establishedAt)}
          />
        </Field>
        <Field label="Website" name="website" error={errs.website?.[0]} className="col-span-2">
          <input
            name="website"
            type="url"
            defaultValue={firm.website ?? ""}
            placeholder="https://example.com"
            className={inputClass(!!errs.website)}
          />
        </Field>
      </div>

      <SectionHeader label="Contact" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" name="phone">
          <input
            name="phone"
            type="tel"
            defaultValue={firm.phone ?? ""}
            placeholder="(555) 555-5555"
            className={inputClass(!!errs.phone)}
          />
        </Field>
        <Field label="Email" name="email" error={errs.email?.[0]}>
          <input
            name="email"
            type="email"
            defaultValue={firm.email ?? ""}
            placeholder="info@example.com"
            className={inputClass(!!errs.email)}
          />
        </Field>
      </div>

      <SectionHeader label="Address" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Address line 1" name="addressLine1" className="col-span-2">
          <input
            name="addressLine1"
            type="text"
            defaultValue={firm.addressLine1 ?? ""}
            className={inputClass(!!errs.addressLine1)}
          />
        </Field>
        <Field label="Address line 2 (optional)" name="addressLine2" className="col-span-2">
          <input
            name="addressLine2"
            type="text"
            defaultValue={firm.addressLine2 ?? ""}
            placeholder="Suite, floor, etc."
            className={inputClass(!!errs.addressLine2)}
          />
        </Field>
        <Field label="City" name="city">
          <input
            name="city"
            type="text"
            defaultValue={firm.city ?? ""}
            className={inputClass(!!errs.city)}
          />
        </Field>
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <Field label="State" name="state">
            <input
              name="state"
              type="text"
              defaultValue={firm.state ?? ""}
              maxLength={20}
              className={inputClass(!!errs.state)}
            />
          </Field>
          <Field label="ZIP" name="zip">
            <input
              name="zip"
              type="text"
              defaultValue={firm.zip ?? ""}
              className={inputClass(!!errs.zip)}
            />
          </Field>
        </div>
        <Field label="Country" name="country" className="col-span-2">
          <input
            name="country"
            type="text"
            required
            defaultValue={firm.country}
            className={inputClass(!!errs.country)}
          />
        </Field>
      </div>

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
        {state.status === "error" && !state.errors && (
          <span className="inline-flex items-center gap-1.5 text-2xs text-warn">
            <TriangleAlert size={12} />
            Couldn’t save — check the highlighted fields.
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

function Field({
  label,
  name,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={name}
        className="text-2xs font-mono uppercase tracking-wider text-ink-4"
      >
        {label}
        {required && <span className="text-warn ml-1">*</span>}
      </label>
      {children}
      {hint && !error && (
        <span className="text-[10px] text-ink-4 leading-relaxed">{hint}</span>
      )}
      {error && <span className="text-2xs text-warn">{error}</span>}
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return cn(
    "h-9 px-3 rounded-md border bg-white text-xs text-ink",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );
}
