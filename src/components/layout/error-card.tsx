/**
 * ErrorCard — the friendly "something broke" card shared by the
 * route-level error boundaries ((dashboard)/error.tsx and the root
 * app/error.tsx).
 *
 * "Try again" calls Next 16's `retry()`, which re-fetches the
 * segment's server payload and re-renders. `reset()` only clears the
 * boundary state and re-renders the SAME cached RSC payload, so a
 * server-render failure (a Prisma pool timeout, say) would re-throw
 * immediately and the card would reappear forever.
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorDetails } from "@/lib/error-details";

export function ErrorCard({
  error,
  retry,
  label,
}: {
  error: unknown;
  retry: () => void;
  /** Console prefix, e.g. "Dashboard error boundary caught:". */
  label: string;
}) {
  useEffect(() => {
    // Surface to the dev console for now; replace with a real
    // observability sink (Sentry / Logtail / etc.) when one is wired.
    console.error(label, error);
  }, [error, label]);

  const { message, digest } = errorDetails(error);

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
                  again — if it keeps happening, the details below help pin
                  down the cause.
                </p>

                {(message || digest) && (
                  <div className="mb-4 rounded-md border border-line bg-paper-2/40 px-3 py-2">
                    <div className="text-2xs font-medium text-ink-3 mb-1">
                      Error
                    </div>
                    {message && (
                      <code className="text-xs text-ink font-mono break-all">
                        {message}
                      </code>
                    )}
                    {digest && (
                      <div className="text-2xs font-mono text-ink-4 mt-1">
                        digest: {digest}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button onClick={() => retry()} size="sm">
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
