/**
 * Client portal master switch (Settings -> Firm). The page renders this
 * only for firm.edit_info holders; setPortalEnabled re-checks it.
 */

"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setPortalEnabled } from "@/app/actions/firm";

export function PortalEnabledCard({ current }: { current: boolean }) {
  const [enabled, setEnabled] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setError(null);
    setEnabled(next);
    startTransition(async () => {
      const result = await setPortalEnabled(next);
      if (!result.ok) {
        setEnabled(!next);
        setError(result.error ?? "Couldn't save.");
      }
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Client portal</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <label className="flex items-start gap-2 text-xs select-none">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
            className="h-3.5 w-3.5 mt-0.5 rounded border-line"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-ink font-medium">Client portal enabled</span>
            <span className="text-2xs text-ink-3 leading-relaxed">
              When off, staff cannot send portal invites and clients cannot
              sign in.
            </span>
          </div>
        </label>
        {error && <div className="text-2xs text-warn mt-2">{error}</div>}
      </CardContent>
    </Card>
  );
}
