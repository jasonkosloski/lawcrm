/**
 * Application Providers
 *
 * Root slot for app-wide client UI. Today: the toast region and the
 * confirmation-dialog host behind src/lib/feedback.ts. Add a provider here
 * only together with its first consumer (unused providers ship in every
 * route's client bundle).
 */

import { ConfirmHost } from "@/components/shared/confirm-host";
import { Toaster } from "@/components/ui/sonner";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <>
      {children}
      <Toaster />
      <ConfirmHost />
    </>
  );
}
