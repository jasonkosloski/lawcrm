/** Shown on the sign-in pages while Firm.portalEnabled is false. */

import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PortalOff() {
  return (
    <Alert role="status" className="border-line bg-paper px-3 py-3">
      <CircleAlert aria-hidden="true" className="text-ink-3" />
      <AlertTitle>The client portal is not available right now.</AlertTitle>
      <AlertDescription className="text-ink-3">
        If you need something from your legal team, please call or email the office.
      </AlertDescription>
    </Alert>
  );
}
