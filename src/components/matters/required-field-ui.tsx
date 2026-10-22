"use client";

/**
 * UI shared by the new- and edit-matter forms for per-area required fields:
 * the "Required for {area}" hint helpers, the Venue field wrapper, and the
 * focus handling after a failed client-side required check.
 */

import type { ReactNode } from "react";
import { REQUIRED_FIELD_INPUT_NAME, type RequiredMatterField } from "@/lib/matter-required-fields";

export function useRequiredHints(
  areaName: string | undefined,
  requiredKeys: readonly RequiredMatterField[],
) {
  const isRequired = (k: RequiredMatterField) => requiredKeys.includes(k);
  const requiredHint = areaName ? `Required for ${areaName}` : "";
  const reqHint = (k: RequiredMatterField, extra?: string) =>
    isRequired(k) ? (extra ? `${requiredHint}. ${extra}` : requiredHint) : extra;
  return { isRequired, requiredHint, reqHint };
}

/** Label + hint around a VenueCombobox (which renders its own error text). */
export function VenueField({
  required,
  requiredHint,
  error,
  children,
}: {
  required: boolean;
  requiredHint: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-2">
        Venue
        {required && <span className="text-warn ml-0.5">*</span>}
      </span>
      {children}
      {!error && (
        <div className="text-2xs text-ink-4">
          {required ? requiredHint : "The court or jurisdiction the case is in."}
        </div>
      )}
    </div>
  );
}

/** The visible, focusable control for a required field (null if none). */
function focusTarget(form: HTMLFormElement, key: RequiredMatterField): HTMLElement | null {
  if (key === "venue") {
    return form.querySelector<HTMLElement>('[aria-label="Venue"]');
  }
  const name = REQUIRED_FIELD_INPUT_NAME[key];
  // Client is a select on the edit form; on the new form clientId is hidden
  // and the visible control is the picker's text input.
  const selector =
    key === "client"
      ? `[name="${name}"]:not([type="hidden"]), [name="newClientName"]`
      : `[name="${name}"]:not([type="hidden"])`;
  return form.querySelector<HTMLElement>(selector);
}

/** Focus (and scroll to) the missing field that is earliest in the page. */
export function focusFirstInvalid(form: HTMLFormElement, keys: readonly RequiredMatterField[]) {
  const targets = keys
    .map((k) => focusTarget(form, k))
    .filter((el): el is HTMLElement => el !== null);
  targets.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  const first = targets[0];
  if (!first) return;
  first.focus();
  first.scrollIntoView?.({ block: "center" });
}
