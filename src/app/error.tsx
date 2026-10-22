/**
 * Root Error Boundary
 *
 * Wraps everything below the root layout that has no closer boundary:
 * the (dashboard) layout/AppShell itself (sidebar queries, timer),
 * /login, and /print/*. Unlike `global-error.tsx` it renders INSIDE
 * the root layout, so fonts, Tailwind and Providers are still present
 * and a transient DB error no longer replaces the whole document with
 * an unstyled page.
 */

"use client";

import { ErrorCard } from "@/components/layout/error-card";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <ErrorCard error={error} retry={retry} label="Root error boundary caught:" />
    </div>
  );
}
