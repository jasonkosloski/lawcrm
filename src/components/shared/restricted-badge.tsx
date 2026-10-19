/**
 * Lock chip for a restricted intake or matter (ADR-049). Only people
 * who can see the record ever see this, so it tells them the record
 * is walled off from the rest of the firm.
 */

import { Lock } from "lucide-react";

export function RestrictedBadge({ title }: { title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full border border-warn-border bg-warn-soft text-warn"
      title={title ?? "Restricted: only its team can see this"}
    >
      <Lock size={10} aria-hidden />
      Restricted
    </span>
  );
}
