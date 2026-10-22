/**
 * Matter Restrict card (ADR-049) on the matter edit page, for
 * `matters.restrict` holders. A restricted matter is visible only to
 * its active case team (plus view-all holders and Admins) even while
 * the firm's matter visibility is Firm-wide.
 */

"use client";

import { useState, useTransition } from "react";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setMatterRestricted } from "@/app/actions/matters";
import { confirmAction } from "@/lib/feedback";
import { FormErrorBanner } from "@/components/ui/field";

export function MatterRestrictCard({
  matterId,
  restricted,
}: {
  matterId: string;
  restricted: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !restricted;
    if (
      !(await confirmAction(
        next
          ? {
              title: "Restrict this matter?",
              description:
                "Only its active case team, people who can view all matters, and Admins will see it and everything on it.",
              confirmLabel: "Restrict",
            }
          : {
              title: "Open this matter to the firm?",
              description: "It follows the firm's matter visibility setting again.",
              confirmLabel: "Open to firm",
            },
      ))
    )
      return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await setMatterRestricted(matterId, next);
        if (!res.ok) setError(res.error ?? "Couldn't update access.");
      } catch {
        setError("Couldn't update access. Please retry.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-ink">Access</div>
        <div className="text-2xs text-ink-4 mt-0.5">
          {restricted
            ? "Restricted: only the case team can see this matter, whatever the firm's visibility setting."
            : "Follows the firm's matter visibility setting."}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggle}
        disabled={pending}
        className="self-start"
      >
        {restricted ? <LockOpen size={12} /> : <Lock size={12} />}
        {restricted ? "Open to firm" : "Restrict to case team"}
      </Button>
      <FormErrorBanner message={error} />
    </div>
  );
}
