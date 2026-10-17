/**
 * Application Providers
 *
 * Wraps the app with the context providers every route needs:
 * - TooltipProvider for shadcn tooltips
 *
 * (TanStack Query used to live here; nothing ever consumed it —
 * reads happen in server components and mutations are server
 * actions — so the provider and devtools were removed.)
 *
 * Rendered as a client component so providers that need React
 * context work correctly in the Next.js App Router.
 */

"use client";

import { TooltipProvider } from "@/components/ui/tooltip";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <TooltipProvider>{children}</TooltipProvider>;
}
