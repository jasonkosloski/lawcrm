/**
 * Stage Changer
 *
 * Two views in one card:
 *  1. A horizontal stepper — dots connected by lines, labels beneath —
 *     that shows where the matter is in the case lifecycle at a
 *     glance. Stages before the current one are filled (ok), the
 *     current is highlighted (brand ring), and future stages are
 *     hollow. Read-only, deliberately legible, designed so it can
 *     later double as the "your case is here" indicator in a
 *     client portal.
 *  2. A "Change stage" button that opens a popover listing every
 *     stage; selecting one commits the change. Two deliberate
 *     clicks — opening the picker signals intent, the second click
 *     is the commit — so a misclick on the overview doesn't
 *     accidentally move the matter out of (say) Discovery.
 *
 * Stages are passed in as props so the component stays area-aware:
 * each matter's lifecycle is whatever the firm configured for its
 * practice area. Terminal stages (`isTerminal`) render muted on the
 * stepper and labeled "terminal" in the popover.
 *
 * Uses `useOptimistic` so both the stepper and subtitle update
 * instantly; `revalidatePath` in the action refreshes the rest of
 * the layout (TopBar subtitle chip, sidebar counts, matters list).
 *
 * `canEdit` (server-resolved `matters.edit` — the key
 * `updateMatterStage` enforces) hides the "Change stage" control for
 * users who'd only get a refusal; the stepper stays visible to all.
 * Possible refinement: separate keys for moving stage forward vs.
 * backward, if the firm ever wants that split.
 */

"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { confirmAction, notifyError } from "@/lib/feedback";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateMatterStage } from "@/app/actions/matters";

export type StageOption = {
  id: string;
  name: string;
  order: number;
  isTerminal: boolean;
  /** False for an archived stage. The matter page includes the matter's
   *  own stage even when archived (so the stepper can still show where
   *  it sits); such a stage is shown but never offered as a move target.
   *  Omitted = active. */
  isActive?: boolean;
};

/** One dot on the stepper. Usually a stage; several terminal stages
 *  collapse into one combined end step. */
export type StepperStep = {
  key: string;
  label: string;
  /** Hover text (the outcomes, for a combined step). */
  title: string;
  isTerminal: boolean;
  isArchived: boolean;
};

/** Label for the combined end step while the matter is still open. */
export const COMBINED_TERMINAL_LABEL = "Closed";

/**
 * The stepper's dots. When an area has two or more terminal stages
 * (e.g. Dismissed / Convicted / Acquitted), they collapse into ONE
 * final step so the graphic doesn't sprawl: labelled with the actual
 * outcome once the matter is in one of them, otherwise "Closed"
 * (hover lists the outcomes). The Change-stage menu still lists every
 * stage. One terminal stage (or none) renders exactly as configured.
 */
export function stepperSteps(
  stages: readonly StageOption[],
  currentStageId: string
): { steps: StepperStep[]; currentIndex: number } {
  const terminal = stages.filter((s) => s.isTerminal);
  const asStep = (s: StageOption): StepperStep => ({
    key: s.id,
    label: s.name,
    title: s.name,
    isTerminal: s.isTerminal,
    isArchived: s.isActive === false,
  });
  if (terminal.length < 2) {
    return {
      steps: stages.map(asStep),
      currentIndex: stages.findIndex((s) => s.id === currentStageId),
    };
  }
  const open = stages.filter((s) => !s.isTerminal);
  const currentTerminal = terminal.find((s) => s.id === currentStageId);
  const steps: StepperStep[] = [
    ...open.map(asStep),
    {
      key: "__terminal__",
      label: currentTerminal?.name ?? COMBINED_TERMINAL_LABEL,
      title: `Ends as: ${terminal.map((s) => s.name).join(" / ")}`,
      isTerminal: true,
      isArchived: currentTerminal?.isActive === false,
    },
  ];
  const openIndex = open.findIndex((s) => s.id === currentStageId);
  return {
    steps,
    currentIndex: currentTerminal ? steps.length - 1 : openIndex,
  };
}

export function StageChanger({
  matterId,
  stages,
  currentStageId,
  canEdit,
}: {
  matterId: string;
  stages: StageOption[];
  currentStageId: string;
  canEdit: boolean;
}) {
  const [optimisticStageId, setOptimisticStageId] =
    useOptimistic(currentStageId);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const currentIndex = stages.findIndex((s) => s.id === optimisticStageId);
  const currentStage = stages[currentIndex];
  const isTerminalCurrent = currentStage?.isTerminal ?? false;
  // The stepper may collapse several terminal stages into one dot; the
  // remaining-count follows what the user sees.
  const { steps, currentIndex: stepIndex } = stepperSteps(stages, optimisticStageId);
  const stagesRemaining = stepIndex >= 0 ? steps.length - 1 - stepIndex : 0;

  const transitionTo = (nextId: string) => {
    if (nextId === optimisticStageId) {
      setOpen(false);
      return;
    }
    setOpen(false);
    startTransition(async () => {
      setOptimisticStageId(nextId);
      const res = await updateMatterStage(matterId, nextId);
      if (res.ok) return;
      // Server flagged the transition as unusual (terminal → non-
      // terminal reopen, or backward jump >1). Surface the warning
      // and retry with force=true if the user confirms.
      if (res.requiresConfirmation && res.warning) {
        if (
          await confirmAction({
            title: "Change stage anyway?",
            description: res.warning,
            confirmLabel: "Change stage",
          })
        ) {
          const retry = await updateMatterStage(matterId, nextId, {
            force: true,
          });
          if (!retry.ok) {
            // Revert the optimistic flip — the server still refused.
            setOptimisticStageId(currentStageId);
            notifyError(retry.error ?? "Couldn't change stage.");
          }
        } else {
          // Cancelled — revert optimistic state.
          setOptimisticStageId(currentStageId);
        }
      } else {
        setOptimisticStageId(currentStageId);
        notifyError(res.error ?? "Couldn't change stage.");
      }
    });
  };

  if (stages.length === 0) {
    return (
      <div className="text-2xs text-ink-4">
        No stages configured for this practice area — add stages in
        Settings → Practice areas.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header row ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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

        {canEdit && (
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
                {stages.map((stage, idx) => {
                  const isCurrent = stage.id === optimisticStageId;
                  // Archived stages can't be moved into (the server
                  // refuses); only list one when it is the current one.
                  if (stage.isActive === false && !isCurrent) return null;
                  const isPassed =
                    currentIndex >= 0 && idx < currentIndex && !isCurrent;

                  return (
                    <li key={stage.id}>
                      <button
                        type="button"
                        disabled={isCurrent}
                        onClick={() => transitionTo(stage.id)}
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
                        <span className="flex-1">
                          {stage.name}
                          {stage.isActive === false && " (archived)"}
                        </span>
                        {stage.isTerminal && !isCurrent && (
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
        )}
      </div>

      {/* ── Horizontal stepper ─────────────────────────────────────── */}
      <div className="px-1">
        <div className="flex items-start">
          {steps.map((step, idx) => {
            const isCurrent = idx === stepIndex;
            const isPassed = stepIndex >= 0 && idx < stepIndex;
            const connectorFilled = idx < stepIndex;

            return (
              <div
                key={step.key}
                className="relative flex-1 flex flex-col items-center min-w-0"
              >
                {idx < steps.length - 1 && (
                  <div
                    className={cn(
                      "absolute top-[5px] left-1/2 w-full h-[2px]",
                      connectorFilled ? "bg-ok" : "bg-line"
                    )}
                  />
                )}

                <div
                  className={cn(
                    "relative z-10 w-3 h-3 rounded-full transition-colors",
                    isCurrent
                      ? isTerminalCurrent
                        ? "bg-ink-3 ring-4 ring-paper-2"
                        : "bg-brand-500 ring-4 ring-brand-100"
                      : isPassed
                        ? "bg-ok"
                        : "bg-white border-2 border-line"
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                  title={step.title}
                />

                <div
                  className={cn(
                    "mt-2.5 text-2xs leading-tight text-center px-0.5 break-words",
                    isCurrent
                      ? isTerminalCurrent
                        ? "text-ink-2 font-semibold"
                        : "text-brand-700 font-semibold"
                      : isPassed
                        ? "text-ink-3"
                        : "text-ink-4"
                  )}
                >
                  {step.label}
                  {step.isArchived && " (archived)"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Subtitle ───────────────────────────────────────────────── */}
      <div className="text-2xs text-ink-4 leading-relaxed">
        {isTerminalCurrent ? (
          <>
            Matter is{" "}
            <span className="text-ink-2 font-medium">
              {currentStage?.name}
            </span>
            .
          </>
        ) : (
          <>
            Currently in{" "}
            <span className="text-ink-2 font-medium">
              {currentStage
                ? `${currentStage.name}${currentStage.isActive === false ? " (archived)" : ""}`
                : "a stage that is no longer listed"}
            </span>
            {stagesRemaining > 0 && (
              <>
                {" · "}
                {stagesRemaining} stage{stagesRemaining === 1 ? "" : "s"}{" "}
                remaining
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
