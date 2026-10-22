/**
 * A compose/reply field row with a PERSISTENT visible label (the same
 * `w-10 font-mono uppercase` style as the From row). Placeholders
 * vanish once a field is filled, which left To and Cc
 * indistinguishable on a privileged email; the label stays.
 */

import type { ReactNode } from "react";

export function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs font-medium text-ink-3 shrink-0 w-10">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/** Implicit form submission (Enter in a single-line input) must not
 *  send an email - a sent message can't be recalled. Attach to the
 *  composer `<form onKeyDown>`; the editor (contenteditable) and the
 *  buttons are unaffected. */
export function blockEnterSubmit(e: React.KeyboardEvent<HTMLFormElement>): void {
  if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
    e.preventDefault();
  }
}
