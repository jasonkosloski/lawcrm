/**
 * Stage Changer
 *
 * Pill-strip of the case-lifecycle stages on the matter Overview tab.
 * Click a pill to transition the matter into that stage. Uses
 * `useOptimistic` so the UI updates instantly while the server action
 * runs; `revalidatePath` in the action refreshes the rest of the
 * layout (TopBar subtitle chip, sidebar counts, matters list).
 *
 * TODO (auth): hide / disable pills based on the signed-in user's
 * permissions once RBAC lands. Firm administrators should be able to
 * configure which roles can move stage forward vs. backward.
 */

"use client";

import { useOptimistic, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateMatterStage } from "@/app/actions/matters";

const STAGES = [
  "Intake",
  "Pre-suit",
  "Retained",
  "Discovery",
  "Dispositive",
  "Pretrial",
  "Cert",
  "Trial/Settle",
  "Settled",
  "Closed",
] as const;

const TERMINAL_STAGES = new Set<string>(["Settled", "Closed"]);

export function StageChanger({
  matterId,
  currentStage,
}: {
  matterId: string;
  currentStage: string;
}) {
  const [optimisticStage, setOptimisticStage] = useOptimistic(currentStage);
  const [pending, startTransition] = useTransition();

  const currentIndex = STAGES.indexOf(optimisticStage as (typeof STAGES)[number]);

  const transitionTo = (stage: string) => {
    if (stage === optimisticStage) return;
    startTransition(async () => {
      setOptimisticStage(stage);
      await updateMatterStage(matterId, stage);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Stage
        </div>
        {pending && (
          <span className="inline-flex items-center gap-1 text-2xs text-ink-4">
            <Loader2 size={10} className="animate-spin" />
            updating…
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STAGES.map((stage, idx) => {
          const isCurrent = stage === optimisticStage;
          // "Passed" = stages before the current position in the
          // lifecycle. Shown in a muted-but-completed style so the
          // pipeline reads top-to-bottom at a glance.
          const isPassed =
            currentIndex >= 0 && idx < currentIndex && !isCurrent;
          const isTerminal = TERMINAL_STAGES.has(stage);

          return (
            <button
              key={stage}
              type="button"
              disabled={pending || isCurrent}
              onClick={() => transitionTo(stage)}
              className={cn(
                "inline-flex items-center gap-1 text-2xs font-medium px-2.5 py-1 rounded-full border transition-colors",
                isCurrent
                  ? isTerminal
                    ? "bg-paper-2 text-ink-2 border-line"
                    : "bg-brand-500 text-white border-brand-500"
                  : isPassed
                    ? "bg-ok-soft text-ok border-line hover:border-ok"
                    : "bg-white text-ink-3 border-line hover:border-brand-300 hover:text-brand-700",
                pending && !isCurrent && "opacity-60 cursor-wait"
              )}
            >
              {isPassed && <Check size={10} />}
              {stage}
            </button>
          );
        })}
      </div>

      <div className="text-2xs text-ink-4">
        Click any stage to move the matter. Order matches the case
        lifecycle — left to right. Moving backward is allowed.
      </div>
    </div>
  );
}
