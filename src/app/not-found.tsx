/**
 * Root 404
 *
 * Safety net for URLs that match no route at all (a mistyped path or
 * a stale bookmark). Those never reach `(dashboard)/not-found.tsx`
 * because no dashboard segment matched, so without this file Next
 * renders its bare default 404. Renders inside the root layout (fonts,
 * Tailwind, Providers), not the AppShell.
 */

import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function RootNotFound() {
  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-xl mx-auto mt-12">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-paper-2 text-ink-3 flex items-center justify-center shrink-0">
                <FileQuestion size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-display font-medium text-ink mb-1">
                  Page not found.
                </h1>
                <p className="text-sm text-ink-3 leading-relaxed mb-4">
                  There is nothing at this address. It may have been moved or
                  mistyped.
                </p>
                <Button size="sm" render={<Link href="/" />}>
                  <Home />
                  Back to dashboard
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
