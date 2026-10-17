/**
 * Application Providers
 *
 * Root slot for app-wide client context providers. There are none right
 * now: the TanStack React Query client and the shadcn TooltipProvider that
 * used to live here had no consumers (no useQuery/useMutation, no Tooltip)
 * but shipped in every route's client bundle, so they were removed. Add a
 * provider here only together with its first consumer.
 */

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <>{children}</>;
}
