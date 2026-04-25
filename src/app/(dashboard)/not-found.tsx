/**
 * Dashboard 404
 *
 * Renders inside the AppShell so the user keeps the sidebar +
 * topbar context after hitting a missing matter / lead / contact /
 * deadline / etc. Server pages that call `notFound()` from a `[id]`
 * route end up here.
 */

import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardNotFound() {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-xl mx-auto mt-12">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-paper-2 text-ink-3 flex items-center justify-center shrink-0">
                <FileQuestion size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-display font-medium text-ink mb-1">
                  Not found.
                </h1>
                <p className="text-sm text-ink-3 leading-relaxed mb-4">
                  This page doesn&apos;t exist — or the matter, lead, or
                  contact you tried to open has been deleted or moved.
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" render={<Link href="/" />}>
                    <Home />
                    Back to dashboard
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href="/matters" />}
                  >
                    Browse matters
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
