/**
 * Dashboard Error Boundary
 *
 * Catches uncaught errors thrown anywhere inside the dashboard route
 * group (matters, intake, calendar, settings, etc.) so the user sees
 * a friendly card instead of a stack trace. The sidebar + topbar
 * stay rendered because this lives inside `(dashboard)/layout.tsx`.
 *
 * Errors fed to this boundary include any thrown server-component
 * fetch (e.g. a Prisma query), so this is the safety net for the
 * "page 500s with a stack trace" failure mode flagged in FEATURES.md.
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the dev console for now; replace with a real
    // observability sink (Sentry / Logtail / etc.) when one is wired.
    console.error("Dashboard error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-xl mx-auto mt-12">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-warn-soft text-warn flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-display font-medium text-ink mb-1">
                  Something broke loading this page.
                </h1>
                <p className="text-sm text-ink-3 leading-relaxed mb-4">
                  An unexpected error stopped this view from rendering. Try
                  reloading — if it keeps happening, the details below help
                  pin down the cause.
                </p>

                {error.message && (
                  <div className="mb-4 rounded-md border border-line bg-paper-2/40 px-3 py-2">
                    <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1">
                      Error
                    </div>
                    <code className="text-xs text-ink font-mono break-all">
                      {error.message}
                    </code>
                    {error.digest && (
                      <div className="text-2xs font-mono text-ink-4 mt-1">
                        digest: {error.digest}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button onClick={reset} size="sm">
                    <RotateCcw />
                    Try again
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href="/" />}
                  >
                    <Home />
                    Back to dashboard
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
