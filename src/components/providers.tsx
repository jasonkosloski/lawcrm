/**
 * Application Providers
 *
 * Wraps the app with all required context providers:
 * - TanStack React Query for server state management
 * - TooltipProvider for shadcn tooltips
 *
 * This component is rendered as a client component so that providers
 * requiring React context work correctly in the Next.js App Router.
 */

"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TooltipProvider } from "@/components/ui/tooltip";
import { makeQueryClient } from "@/lib/query-client";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  /**
   * Create the QueryClient once per component mount. Using useState ensures
   * the client persists across re-renders but is unique per SSR request.
   */
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
      </TooltipProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
