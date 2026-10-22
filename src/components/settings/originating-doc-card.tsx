/**
 * "Require originating document" switch (Settings -> Firm). Admin only;
 * the page does not render this for anyone else. The setting applies to
 * new matters only, so the card also shows how many open matters have
 * no signed agreement on file today.
 */

"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setRequireOriginatingDoc } from "@/app/actions/firm";
import { notifyError } from "@/lib/feedback";

export function OriginatingDocCard({
  current,
  missingCount,
}: {
  current: boolean;
  missingCount: number;
}) {
  const [on, setOn] = useState(current);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    const prev = on;
    setOn(next);
    startTransition(async () => {
      try {
        await setRequireOriginatingDoc(next);
      } catch (e) {
        setOn(prev);
        notifyError(e instanceof Error ? e.message : "Couldn't save the setting.");
      }
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Originating document</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <label className="inline-flex items-center gap-2 text-xs text-ink-2 select-none">
          <input
            type="checkbox"
            checked={on}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span>Require originating document</span>
        </label>
        <p className="text-2xs text-ink-3 mt-2 leading-relaxed">
          When on, a matter needs a signed fee agreement (or the label set on its practice area)
          before it can be created or converted from a lead. This applies to new matters only;
          existing matters are not affected.
        </p>
        <div className="mt-3 pt-3 border-t border-line text-xs text-ink-2">
          {missingCount === 0 ? (
            <span className="text-ok">Every open matter has a signed originating document.</span>
          ) : (
            <span>
              {missingCount} open {missingCount === 1 ? "matter" : "matters"} without a signed
              originating document on file.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
