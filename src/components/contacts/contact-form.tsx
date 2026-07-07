/**
 * Shared Contact Form
 *
 * Used by both /contacts/new and /contacts/[id]/edit. Caller provides
 * the bound action (create or update) so this component only deals
 * with field state + presentation.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import {
  CONTACT_TYPES,
  CONTACT_TYPE_LABEL,
} from "@/lib/contact-constants";
import {
  contactFormInitialState,
  type ContactFormState,
} from "@/lib/contact-form";

export type ContactFormValues = {
  name: string;
  type: string;
  email: string;
  phone: string;
  organization: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

const EMPTY_VALUES: ContactFormValues = {
  name: "",
  type: "other",
  email: "",
  phone: "",
  organization: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  notes: "",
};

export function ContactForm({
  action,
  initial,
  submitLabel,
  /** Where to send the user on Cancel + after a successful update. */
  backHref,
  /** When true, the action redirects on success (create flow); the
   *  form just stays mounted while the navigation happens. When false
   *  (edit flow), the page navigates to backHref on success. */
  redirectsOnSuccess,
}: {
  action: (
    prev: ContactFormState,
    formData: FormData
  ) => Promise<ContactFormState>;
  initial?: Partial<ContactFormValues>;
  submitLabel: string;
  backHref: string;
  redirectsOnSuccess: boolean;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    ContactFormState,
    FormData
  >(action, contactFormInitialState);

  const [v, setV] = useState<ContactFormValues>({
    ...EMPTY_VALUES,
    ...initial,
  });

  const set = <K extends keyof ContactFormValues>(
    key: K,
    val: ContactFormValues[K]
  ) => setV((prev) => ({ ...prev, [key]: val }));

  // Edit-flow success → bounce back.
  useEffect(() => {
    if (!redirectsOnSuccess && state.status === "ok") {
      router.push(backHref);
    }
  }, [state.status, redirectsOnSuccess, router, backHref]);

  const errs = state.errors ?? {};
  const formError = errs._form?.[0];

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-brand-700 w-fit"
      >
        <ArrowLeft size={12} />
        Back
      </Link>

      <form action={formAction} className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <TextField
            name="name"
            value={v.name}
            onChange={(x) => set("name", x)}
            placeholder="Full name"
            error={errs.name?.[0]}
            autoFocus
          />
          <SelectField
            name="type"
            value={v.type}
            onChange={(x) => set("type", x)}
            options={CONTACT_TYPES.map((t) => ({
              value: t,
              label: CONTACT_TYPE_LABEL[t],
            }))}
          />
        </div>

        <TextField
          name="organization"
          value={v.organization}
          onChange={(x) => set("organization", x)}
          placeholder="Organization / firm (optional)"
          error={errs.organization?.[0]}
        />

        <div className="grid grid-cols-2 gap-2">
          <TextField
            name="email"
            value={v.email}
            onChange={(x) => set("email", x)}
            placeholder="email@example.com"
            error={errs.email?.[0]}
          />
          <TextField
            name="phone"
            value={v.phone}
            onChange={(x) => set("phone", x)}
            placeholder="(555) 555-5555"
            error={errs.phone?.[0]}
          />
        </div>

        <TextField
          name="address"
          value={v.address}
          onChange={(x) => set("address", x)}
          placeholder="Street address (optional)"
          error={errs.address?.[0]}
        />

        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <TextField
            name="city"
            value={v.city}
            onChange={(x) => set("city", x)}
            placeholder="City"
            error={errs.city?.[0]}
          />
          <TextField
            name="state"
            value={v.state}
            onChange={(x) => set("state", x)}
            placeholder="State"
            error={errs.state?.[0]}
            className="w-20"
          />
          <TextField
            name="zip"
            value={v.zip}
            onChange={(x) => set("zip", x)}
            placeholder="ZIP"
            error={errs.zip?.[0]}
            className="w-24"
          />
        </div>

        {/* Conflict status intentionally not editable here — manual
            changes require a justification and go through the
            detail-page control so they hit the audit log. */}

        <TextareaField
          name="notes"
          value={v.notes}
          onChange={(x) => set("notes", x)}
          placeholder="Notes (optional — internal only)"
          rows={4}
          error={errs.notes?.[0]}
        />

        {formError && (
          <div className="text-xs text-warn px-3 py-2 rounded-md bg-warn-soft border border-warn-border">
            {formError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Link
            href={backHref}
            className="text-xs text-ink-3 hover:text-ink px-3 py-1.5"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
