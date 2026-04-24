/**
 * Statute of Limitations card — prominent on the matter Overview
 * when the practice area has hasStatuteOfLimitations=true.
 *
 * Shows the deadline, days remaining, and a manual satisfied toggle
 * (the button the user flips when the complaint has been filed /
 * notice served / etc). Color coding escalates as the deadline
 * approaches:
 *   - Satisfied → ok/muted
 *   - > 60 days → neutral
 *   - 31–60    → caution
 *   - 0–30     → warn
 *   - past due → urgent (warn + emphasis)
 *
 * TODO (automation): auto-flip satisfied when a matching filing
 * document is linked + verified. For now it's manual.
 */

"use client";

import { useOptimistic, useTransition } from "react";
import { CheckCircle2, Circle, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { setMatterSolSatisfied } from "@/app/actions/matters";

export type StatuteOfLimitationsCardProps = {
  matterId: string;
  date: Date | null;
  satisfied: boolean;
  satisfiedAt: Date | null;
  notes: string | null;
};

const ONE_DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  const aMid = new Date(a);
  aMid.setHours(0, 0, 0, 0);
  const bMid = new Date(b);
  bMid.setHours(0, 0, 0, 0);
  return Math.round((bMid.getTime() - aMid.getTime()) / ONE_DAY);
}

function formatFullDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function StatuteOfLimitationsCard({
  matterId,
  date,
  satisfied,
  satisfiedAt,
  notes,
}: StatuteOfLimitationsCardProps) {
  const [optimisticSatisfied, setOptimisticSatisfied] =
    useOptimistic(satisfied);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      setOptimisticSatisfied(!optimisticSatisfied);
      const res = await setMatterSolSatisfied(matterId, !optimisticSatisfied);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  // No date set yet — gentle prompt instead of countdown chrome.
  if (!date) {
    return (
      <Card className="border-warn-border bg-warn-soft/20">
        <CardContent className="px-4 py-3 flex items-center gap-3">
          <TriangleAlert size={16} className="text-warn shrink-0" />
          <div className="flex-1 min-w-0 text-xs text-ink-2">
            <div className="font-medium text-ink">
              No statute-of-limitations date set
            </div>
            <div className="text-2xs text-ink-3">
              This practice area tracks SOL — add the deadline via
              Matter → Edit.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  const days = daysBetween(now, date);
  const past = days < 0;

  // Tone: satisfied dominates; otherwise escalate by days.
  const tone: "ok" | "neutral" | "caution" | "warn" | "urgent" =
    optimisticSatisfied
      ? "ok"
      : past
        ? "urgent"
        : days <= 30
          ? "warn"
          : days <= 60
            ? "caution"
            : "neutral";

  const toneClasses = {
    ok: "border-line bg-ok-soft/30",
    neutral: "border-line bg-paper-2/40",
    caution: "border-brand-200 bg-brand-soft/40",
    warn: "border-warn-border bg-warn-soft/40",
    urgent: "border-warn-border bg-warn-soft",
  }[tone];

  const labelText = optimisticSatisfied
    ? "Satisfied"
    : past
      ? `${Math.abs(days)} days overdue`
      : days === 0
        ? "Due today"
        : `${days} days remaining`;

  const labelTone = {
    ok: "text-ok",
    neutral: "text-ink-2",
    caution: "text-brand-700",
    warn: "text-warn",
    urgent: "text-warn font-semibold",
  }[tone];

  return (
    <Card className={cn("transition-colors", toneClasses)}>
      <CardContent className="px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Statute of limitations
          </div>
          {pending && (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-4">
              <Loader2 size={10} className="animate-spin" />
              updating…
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className={cn("text-sm font-semibold", labelTone)}>
              {labelText}
            </div>
            <div className="text-2xs text-ink-3 font-mono">
              {formatFullDate(date)}
            </div>
          </div>

          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            aria-pressed={optimisticSatisfied}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border transition-colors shrink-0",
              optimisticSatisfied
                ? "bg-ok-soft text-ok border-line hover:border-ok"
                : "bg-white text-ink-2 border-line hover:border-brand-300 hover:text-brand-700",
              pending && "opacity-60 cursor-wait"
            )}
          >
            {optimisticSatisfied ? (
              <CheckCircle2 size={13} className="text-ok" />
            ) : (
              <Circle size={13} />
            )}
            {optimisticSatisfied ? "Satisfied" : "Mark satisfied"}
          </button>
        </div>

        {optimisticSatisfied && satisfiedAt && (
          <div className="text-2xs text-ink-4">
            Marked satisfied {formatFullDate(satisfiedAt)}
          </div>
        )}

        {notes && (
          <div className="text-2xs text-ink-3 leading-relaxed pt-1 border-t border-line/50">
            {notes}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
