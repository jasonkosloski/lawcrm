/**
 * Stage Changer
 *
 * Two-step stage transition on the matter Overview tab. The current
 * stage is rendered as a static chip next to a "Change stage" button;
 * clicking the button opens a popover listing every lifecycle stage,
 * and clicking one of those rows commits the change. Two deliberate
 * clicks — opening the picker signals intent, the second click is
 * the commit — so a misclick on the overview doesn't accidentally
 * move the matter out of (say) Discovery.
 *
 * Uses `useOptimistic` so the chip + subtitle update instantly;
 * `revalidatePath` in the action refreshes the rest of the layout
 * (TopBar subtitle chip, sidebar counts, matters list).
 *
 * TODO (auth): hide the "Change stage" button for users without
 * permission once RBAC lands. Firm administrators should be able to
 * configure which roles can move stage forward vs. backward.
 */

"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);

  const currentIndex = STAGES.indexOf(
    optimisticStage as (typeof STAGES)[number]
  );
  const isTerminalCurrent = TERMINAL_STAGES.has(optimisticStage);

  const transitionTo = (stage: string) => {
    if (stage === optimisticStage) {
      setOpen(false);
      return;
    }
    setOpen(false);
    startTransition(async () => {
      setOptimisticStage(stage);
      await updateMatterStage(matterId, stage);
    });
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col gap-1">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Stage
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center text-2xs font-medium px-2.5 py-1 rounded-full border",
              isTerminalCurrent
                ? "bg-paper-2 text-ink-2 border-line"
                : "bg-brand-500 text-white border-brand-500"
            )}
          >
            {optimisticStage}
          </span>
          {pending && (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-4">
              <Loader2 size={10} className="animate-spin" />
              updating…
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium",
              "bg-white text-ink-2 border border-line",
              "hover:border-brand-300 hover:text-brand-700 transition-colors",
              "disabled:opacity-60 disabled:cursor-wait"
            )}
          >
            Change stage
            <ChevronDown size={13} />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 p-1.5">
            <div className="px-2 pt-1 pb-2 text-2xs font-mono uppercase tracking-wider text-ink-4 border-b border-line mb-1">
              Move matter to…
            </div>
            <ul className="flex flex-col">
              {STAGES.map((stage, idx) => {
                const isCurrent = stage === optimisticStage;
                const isPassed =
                  currentIndex >= 0 && idx < currentIndex && !isCurrent;
                const isTerminal = TERMINAL_STAGES.has(stage);

                return (
                  <li key={stage}>
                    <button
                      type="button"
                      disabled={isCurrent}
                      onClick={() => transitionTo(stage)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors",
                        isCurrent
                          ? "bg-brand-soft text-brand-700 cursor-default"
                          : "text-ink hover:bg-paper-2"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center justify-center w-4 h-4 shrink-0",
                          isPassed ? "text-ok" : "text-ink-4"
                        )}
                      >
                        {isCurrent ? (
                          <span className="w-2 h-2 rounded-full bg-brand-500" />
                        ) : isPassed ? (
                          <Check size={12} />
                        ) : null}
                      </span>
                      <span className="flex-1">{stage}</span>
                      {isTerminal && !isCurrent && (
                        <span className="text-2xs text-ink-4">terminal</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="px-2 pt-2 pb-1 mt-1 border-t border-line text-2xs text-ink-4 leading-relaxed">
              Pick any stage — forward or backward — to move the matter.
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
