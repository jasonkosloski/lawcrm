/**
 * Lock chip for a restricted intake or matter (ADR-049). Only people
 * who can see the record ever see this, so it tells them the record
 * is walled off from the rest of the firm.
 */

import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function RestrictedBadge({ title }: { title?: string }) {
  return (
    <Badge
      variant="warn"
      title={title ?? "Restricted: only its team can see this"}
    >
      <Lock size={10} aria-hidden />
      Restricted
    </Badge>
  );
}
