/**
 * Profile Edit Form — current user edits their own row.
 *
 * Editable: name, initials, phone, bar number, avatar URL, time zone,
 * default event visibility.
 * Identity / governance fields (email, role, admin status, active
 * state) are surfaced read-only on the surrounding page so the user
 * sees them but can't change them — those flow through admin
 * governance on /settings/team.
 *
 * Initials force-uppercase as the user types so the avatar fallback
 * stays consistent with the seed/admin-set values.
 *
 * Submission is dispatched manually (not `<form action>`): React 19
 * resets every uncontrolled field after a form action settles — error
 * or not — which would wipe the user's edits on a validation error.
 * Fields also read the echoed `state.values` as a second line of
 * defence.
 */

"use client";

import { useActionState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateProfileAction } from "@/app/actions/profile";
import {
  profileInitialState,
  type ProfileFormState,
} from "@/lib/profile-form";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { inputClass, labelClass } from "@/components/ui/field";

export type EditableProfile = {
  name: string;
  initials: string;
  phone: string | null;
  barNumber: string | null;
  avatarUrl: string | null;
  timeZone: string;
  /** "default" — only attendees / matter team / a per-event
   *  "show details" toggle unlock event details. "show_details" —
   *  every event you create (past and future) is visible firm-wide;
   *  the per-event toggle can only ADD visibility, not hide an event
   *  (there is no per-event "private" value — see
   *  canViewEventDetails in src/lib/calendar-visibility.ts). */
  defaultEventVisibility: string;
};

/// IANA zone names — small starter list of US zones plus the
/// most common global ones. Free string in the schema so a firm
/// admin can add unusual zones via a future custom-list setting.
const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain — no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "UTC", label: "UTC" },
];

export function ProfileEditForm({ profile }: { profile: EditableProfile }) {
  const [state, formAction, isPending] = useActionState<
    ProfileFormState,
    FormData
  >(updateProfileAction, profileInitialState);

  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  const errs = state.errors ?? {};
  const vals = state.values ?? {};
  // A stored zone outside TIMEZONE_OPTIONS (set by a script, or a
  // future browser-inferred default) must stay selectable — a native
  // select with no matching option silently shows (and re-saves) the
  // first one.
  const currentZone = vals.timeZone ?? profile.timeZone;
  const zoneOptions = TIMEZONE_OPTIONS.some((tz) => tz.value === currentZone)
    ? TIMEZONE_OPTIONS
    : [...TIMEZONE_OPTIONS, { value: currentZone, label: currentZone }];
  const visibility =
    vals.defaultEventVisibility ?? profile.defaultEventVisibility;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Display name" name="name" required error={errs.name?.[0]}>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={vals.name ?? profile.name}
            className={inputClass(!!errs.name, "md")}
          />
        </Field>
        <Field
          label="Initials"
          name="initials"
          required
          error={errs.initials?.[0]}
          hint="Used in avatar circles across the app."
        >
          <input
            id="initials"
            name="initials"
            type="text"
            required
            maxLength={3}
            defaultValue={vals.initials ?? profile.initials}
            className={cn(inputClass(!!errs.initials, "md"), "uppercase font-mono")}
          />
        </Field>
        <Field label="Phone" name="phone" error={errs.phone?.[0]}>
          <input
            id="phone"
            name="phone"
            type="tel"
            maxLength={40}
            defaultValue={vals.phone ?? profile.phone ?? ""}
            placeholder="(555) 555-5555"
            className={inputClass(!!errs.phone, "md")}
          />
        </Field>
        <Field
          label="Bar number"
          name="barNumber"
          error={errs.barNumber?.[0]}
          hint="State bar number — attorneys only."
        >
          <input
            id="barNumber"
            name="barNumber"
            type="text"
            maxLength={40}
            defaultValue={vals.barNumber ?? profile.barNumber ?? ""}
            className={inputClass(!!errs.barNumber, "md")}
          />
        </Field>
        <Field
          label="Avatar URL"
          name="avatarUrl"
          error={errs.avatarUrl?.[0]}
          hint="Optional — leave blank to fall back to your initials."
          className="sm:col-span-2"
        >
          <input
            id="avatarUrl"
            name="avatarUrl"
            type="url"
            defaultValue={vals.avatarUrl ?? profile.avatarUrl ?? ""}
            placeholder="https://example.com/me.jpg"
            className={inputClass(!!errs.avatarUrl, "md")}
          />
        </Field>
        <Field
          label="Time zone"
          name="timeZone"
          error={errs.timeZone?.[0]}
          hint="Used for dashboard agenda, deadlines countdown, and timeline timestamps."
          className="sm:col-span-2"
        >
          <NativeSelect
            id="timeZone"
            name="timeZone"
            defaultValue={currentZone}
            className="w-full"
            aria-invalid={!!errs.timeZone || undefined}
          >
            {zoneOptions.map((tz) => (
              <NativeSelectOption key={tz.value} value={tz.value}>
                {tz.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Default event visibility"
          name="defaultEventVisibility"
          error={errs.defaultEventVisibility?.[0]}
          hint="How your events show up to firm-mates who aren't on the matter team or invited as attendees. This applies to ALL of your events, past and future. A per-event &ldquo;Private event&rdquo; setting always wins, so you can still hide a single event."
          className="sm:col-span-2"
          group
        >
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 text-xs text-ink cursor-pointer">
              <input
                type="radio"
                name="defaultEventVisibility"
                value="default"
                defaultChecked={visibility !== "show_details"}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Private by default</span>
                <span className="block text-3xs text-ink-4 leading-relaxed">
                  Others see only an &ldquo;Unavailable&rdquo; block during your event time. Matter team and invited attendees still see full detail.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-ink cursor-pointer">
              <input
                type="radio"
                name="defaultEventVisibility"
                value="show_details"
                defaultChecked={visibility === "show_details"}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Show details to everyone in the firm</span>
                <span className="block text-3xs text-ink-4 leading-relaxed">
                  Every event you create is visible firm-wide with full detail, including events already on your calendar. Switching back to private hides them again.
                </span>
              </span>
            </label>
          </div>
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-line">
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-9 px-4 rounded-md text-sm font-medium",
            "bg-brand-700 text-white hover:bg-brand-900 transition-colors",
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

function Field({
  label,
  name,
  hint,
  error,
  required,
  className,
  group,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** Radio group: render a fieldset + legend instead of a label that
   *  points at an id no single control owns. */
  group?: boolean;
  children: React.ReactNode;
}) {
  const marker = required ? <span className="text-warn ml-1">*</span> : null;
  const footer = (
    <>
      {hint && !error && (
        <span className="text-3xs text-ink-4 leading-relaxed">{hint}</span>
      )}
      {error && <span className="text-2xs text-warn">{error}</span>}
    </>
  );
  if (group) {
    return (
      <fieldset
        className={cn("flex flex-col gap-1 border-0 p-0 m-0 min-w-0", className)}
      >
        <legend className={cn(labelClass, "p-0 mb-1")}>
          {label}
          {marker}
        </legend>
        {children}
        {footer}
      </fieldset>
    );
  }
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={name} className={labelClass}>
        {label}
        {marker}
      </label>
      {children}
      {footer}
    </div>
  );
}

