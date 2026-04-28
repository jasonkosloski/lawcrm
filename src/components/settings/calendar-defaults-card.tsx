/**
 * Calendar Defaults Card — toggles for the two auto-attendee
 * behaviors. Renders in two scopes:
 *
 *   - Firm: two simple checkboxes (on / off).
 *   - Matter: two tri-state radio groups (inherit / on / off)
 *     with the firm value surfaced as the inherit hint.
 *
 * The shared component lets both surfaces stay visually
 * consistent and keeps the wire format aligned with the actions
 * in `app/actions/calendar-defaults.ts`.
 */

"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  updateFirmCalendarDefaults,
  updateMatterCalendarDefaults,
} from "@/app/actions/calendar-defaults";

const initial = { status: "idle" as const };

// ── Firm scope ─────────────────────────────────────────────────────────

export function FirmCalendarDefaultsCard({
  current,
  canEdit,
}: {
  current: {
    autoAddTeamToNewEvents: boolean;
    autoAddTeamToUpcomingEvents: boolean;
  };
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateFirmCalendarDefaults,
    initial
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Calendar defaults
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-xs text-ink-3 mb-3 leading-relaxed">
          Firm-wide defaults for who lands on a calendar event
          automatically. Each matter can override these on its
          own edit page.
        </p>
        <form action={formAction} className="flex flex-col gap-2">
          <FirmToggle
            name="autoAddTeamToNewEvents"
            defaultChecked={current.autoAddTeamToNewEvents}
            disabled={!canEdit}
            label="Auto-add matter team to new events"
            hint="Every team member on a matter is added as an attendee when a new event is created on that matter."
          />
          <FirmToggle
            name="autoAddTeamToUpcomingEvents"
            defaultChecked={current.autoAddTeamToUpcomingEvents}
            disabled={!canEdit}
            label="Auto-add new team members to upcoming events"
            hint="When someone joins a matter team, they're added as an attendee on every upcoming event the matter already has scheduled."
          />
          {canEdit && (
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-line">
              {state.status === "ok" && (
                <span className="text-2xs text-ok">Saved.</span>
              )}
              {state.status === "error" && (
                <span className="text-2xs text-warn">
                  {state.error ?? "Couldn't save."}
                </span>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={pending}
                className="ml-auto"
              >
                {pending ? "Saving…" : "Save defaults"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function FirmToggle({
  name,
  defaultChecked,
  disabled,
  label,
  hint,
}: {
  name: string;
  defaultChecked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2 text-xs select-none rounded-md p-2 -mx-2",
        !disabled && "hover:bg-paper-2"
      )}
    >
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="h-3.5 w-3.5 mt-0.5 rounded border-line"
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-ink font-medium">{label}</span>
        <span className="text-2xs text-ink-3 leading-relaxed">{hint}</span>
      </div>
    </label>
  );
}

// ── Matter scope ───────────────────────────────────────────────────────

export function MatterCalendarDefaultsCard({
  matterId,
  current,
  firmDefaults,
  canEdit,
}: {
  matterId: string;
  /** null = inherit from firm. */
  current: {
    autoAddTeamToNewEvents: boolean | null;
    autoAddTeamToUpcomingEvents: boolean | null;
  };
  /** Surfaced as the inherit-hint copy so the user knows what
   *  "inherit" actually means. */
  firmDefaults: {
    autoAddTeamToNewEvents: boolean;
    autoAddTeamToUpcomingEvents: boolean;
  };
  canEdit: boolean;
}) {
  const action = updateMatterCalendarDefaults.bind(null, matterId);
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Calendar defaults
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-xs text-ink-3 mb-3 leading-relaxed">
          Per-matter override of the firm-wide auto-attendee
          rules. &ldquo;Inherit&rdquo; falls back to the firm
          setting; the other two pin this matter regardless of
          what the firm changes later.
        </p>
        <form action={formAction} className="flex flex-col gap-3">
          <MatterTriToggle
            name="autoAddTeamToNewEvents"
            current={current.autoAddTeamToNewEvents}
            firmValue={firmDefaults.autoAddTeamToNewEvents}
            disabled={!canEdit}
            label="Auto-add matter team to new events"
            hint="Adds every active team member as an attendee when a new event is created on this matter."
          />
          <MatterTriToggle
            name="autoAddTeamToUpcomingEvents"
            current={current.autoAddTeamToUpcomingEvents}
            firmValue={firmDefaults.autoAddTeamToUpcomingEvents}
            disabled={!canEdit}
            label="Auto-add new team members to upcoming events"
            hint="When someone joins this matter's team, attaches them as an attendee on every upcoming event."
          />
          {canEdit && (
            <div className="flex items-center justify-between pt-2 border-t border-line">
              {state.status === "ok" && (
                <span className="text-2xs text-ok">Saved.</span>
              )}
              {state.status === "error" && (
                <span className="text-2xs text-warn">
                  {state.error ?? "Couldn't save."}
                </span>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={pending}
                className="ml-auto"
              >
                {pending ? "Saving…" : "Save defaults"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function MatterTriToggle({
  name,
  current,
  firmValue,
  disabled,
  label,
  hint,
}: {
  name: string;
  current: boolean | null;
  firmValue: boolean;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  // null → "inherit"; true → "true"; false → "false"
  const defaultValue =
    current === null ? "inherit" : current ? "true" : "false";

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-1">
      <legend className="text-xs text-ink font-medium">{label}</legend>
      <span className="text-2xs text-ink-3 leading-relaxed mb-1">{hint}</span>
      <div className="flex flex-col gap-1">
        {[
          {
            value: "inherit",
            label: `Inherit firm default (currently ${firmValue ? "ON" : "OFF"})`,
          },
          { value: "true", label: "Always ON for this matter" },
          { value: "false", label: "Always OFF for this matter" },
        ].map((opt) => (
          <label
            key={opt.value}
            className="inline-flex items-center gap-2 text-xs text-ink-2 select-none"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              defaultChecked={defaultValue === opt.value}
              className="h-3.5 w-3.5"
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
