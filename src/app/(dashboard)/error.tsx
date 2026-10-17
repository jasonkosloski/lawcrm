/**
 * Dashboard Error Boundary
 *
 * Catches uncaught errors thrown by a page (or its segment layouts)
 * inside the dashboard route group so the user sees a friendly card
 * instead of a stack trace. This lives INSIDE `(dashboard)/layout.tsx`,
 * so the AppShell sidebar stays rendered; the page's own TopBar does
 * not (pages render their own), which means on mobile this card has
 * no hamburger — the sidebar is reachable from the desktop layout.
 * Errors thrown by the dashboard layout/AppShell itself are not
 * wrapped by this file; they fall through to `src/app/error.tsx`.
 *
 * Errors fed to this boundary include any thrown server-component
 * fetch (e.g. a Prisma query), so this is the safety net for the
 * "page 500s with a stack trace" failure mode flagged in FEATURES.md.
 * "Try again" uses `retry()` (re-fetch + re-render), not `reset()`.
 */

"use client";

import { ErrorCard } from "@/components/layout/error-card";

export default function DashboardError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <ErrorCard
      error={error}
      retry={retry}
      label="Dashboard error boundary caught:"
    />
  );
}
