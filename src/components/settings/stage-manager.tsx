/**
 * Stage Manager — list + reorder + inline rename for the stages of
 * one practice area.
 *
 * Each stage row is its own form for save-in-place (name + terminal
 * flag). Up/down/archive are icon buttons that fire server actions
 * immediately via useTransition. A compact "add stage" form sits at
 * the bottom of the list.
 *
 * Archive is soft-delete: a stage with active matters can't be
 * archived (the server action rejects with an error surfaced via
 * a toast). Archived stages render muted below active ones.
 */

"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyError } from "@/lib/feedback";
import {
  createStage,
  moveStage,
  setStageActive,
  updateStage,
} from "@/app/actions/practice-areas";
import {
  stageInitialState,
  type StageFormState,
} from "@/lib/practice-area-constants";
import { inputClass } from "@/components/ui/field";

export type StageManagerStage = {
  id: string;
  name: string;
  order: number;
  isTerminal: boolean;
  isActive: boolean;
  matterCount: number;
};

export function StageManager({
  practiceAreaId,
  stages,
}: {
  practiceAreaId: string;
  stages: StageManagerStage[];
}) {
  const active = stages.filter((s) => s.isActive);
  const archived = stages.filter((s) => !s.isActive);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 px-2 pb-1.5 text-2xs font-medium text-ink-4 border-b border-line">
          <span className="w-12" />
          <span>Name</span>
          <span className="text-center">Terminal</span>
          <span className="text-right w-14">Matters</span>
          <span className="w-7" />
        </div>
        {active.length === 0 ? (
          <div className="text-xs text-ink-4 py-3 text-center">
            No active stages — add one below to enable this area.
          </div>
        ) : (
          active.map((s, idx) => (
            <StageRow
              key={s.id}
              stage={s}
              canMoveUp={idx > 0}
              canMoveDown={idx < active.length - 1}
            />
          ))
        )}
      </div>

      <AddStageForm practiceAreaId={practiceAreaId} />

      {archived.length > 0 && (
        <div className="pt-3 border-t border-line flex flex-col">
          <div className="text-2xs font-medium text-ink-3 mb-1">
            Archived ({archived.length})
          </div>
          {archived.map((s) => (
            <StageRow key={s.id} stage={s} canMoveUp={false} canMoveDown={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function StageRow({
  stage,
  canMoveUp,
  canMoveDown,
}: {
  stage: StageManagerStage;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const boundUpdate = updateStage.bind(null, stage.id);
  const [state, formAction, isPending] = useActionState<
    StageFormState,
    FormData
  >(boundUpdate, stageInitialState);

  const [, startTransition] = useTransition();

  const move = (direction: "up" | "down") => {
    startTransition(async () => {
      await moveStage(stage.id, direction);
    });
  };

  const toggleActive = () => {
    if (stage.isActive && stage.matterCount > 0) {
      notifyError(
        `Cannot archive — ${stage.matterCount} active matter${stage.matterCount === 1 ? "" : "s"} still sit in "${stage.name}". Move them to a different stage first.`
      );
      return;
    }
    startTransition(async () => {
      const res = await setStageActive(stage.id, !stage.isActive);
      if (!res.ok && res.error) notifyError(res.error);
    });
  };

  const errs = state.errors ?? {};

  // React 19 resets a <form action={fn}> after every submission,
  // including one returning a validation error, which reverted the
  // terminal checkbox (and the name) to the stored row. Submit via
  // onSubmit + startTransition with controlled fields so a failed
  // save keeps what the user typed.
  const [name, setName] = useState(stage.name);
  const [isTerminal, setIsTerminal] = useState(stage.isTerminal);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        "grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 px-2 py-1.5 border-b border-line last:border-b-0",
        !stage.isActive && "opacity-70"
      )}
    >
      {/* Reorder */}
      <div className="flex gap-0.5 w-12">
        {stage.isActive ? (
          <>
            <IconButton
              onClick={() => move("up")}
              disabled={!canMoveUp || isPending}
              label="Move up"
            >
              <ArrowUp size={12} />
            </IconButton>
            <IconButton
              onClick={() => move("down")}
              disabled={!canMoveDown || isPending}
              label="Move down"
            >
              <ArrowDown size={12} />
            </IconButton>
          </>
        ) : (
          <span className="text-2xs font-mono text-ink-4 pl-1">#{stage.order + 1}</span>
        )}
      </div>

      {/* Name */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <input
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-label={`Stage name (${stage.name})`}
          disabled={!stage.isActive}
          className={cn(inputClass(!!errs.name, "xs"), "w-full disabled:bg-paper-2 disabled:cursor-not-allowed")}
        />
        {errs.name && errs.name.length > 0 && (
          <div className="text-2xs text-warn">{errs.name[0]}</div>
        )}
      </div>

      {/* Terminal */}
      <label className="flex items-center justify-center cursor-pointer select-none px-2">
        <input
          type="checkbox"
          name="isTerminal"
          checked={isTerminal}
          onChange={(e) => setIsTerminal(e.target.checked)}
          aria-label={`${stage.name} is terminal`}
          disabled={!stage.isActive}
          className="w-3.5 h-3.5 rounded border-line"
        />
      </label>

      {/* Matter count */}
      <span className="text-2xs font-mono text-ink-4 text-right w-14 shrink-0">
        {stage.matterCount}
      </span>

      {/* Row-level actions */}
      <div className="flex items-center gap-0.5">
        {stage.isActive && (
          <button
            type="submit"
            disabled={isPending}
            className={cn(
              "inline-flex items-center justify-center w-7 h-7 rounded-md",
              state.status === "ok"
                ? "text-ok"
                : "text-ink-3 hover:text-brand-700 hover:bg-brand-soft",
              "transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            )}
            title={state.status === "ok" ? "Saved" : "Save changes"}
          >
            <Check size={13} />
          </button>
        )}
        <IconButton
          onClick={toggleActive}
          label={stage.isActive ? "Archive" : "Restore"}
        >
          {stage.isActive ? (
            <Archive size={12} />
          ) : (
            <ArchiveRestore size={12} />
          )}
        </IconButton>
      </div>
    </form>
  );
}

function AddStageForm({ practiceAreaId }: { practiceAreaId: string }) {
  const boundCreate = createStage.bind(null, practiceAreaId);
  const [state, formAction, isPending] = useActionState<
    StageFormState,
    FormData
  >(boundCreate, stageInitialState);

  const errs = state.errors ?? {};
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [isTerminal, setIsTerminal] = useState(false);

  // Submit via onSubmit + startTransition (no automatic React 19 form
  // reset) so a validation error keeps the typed name and the terminal
  // checkbox.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };

  // Clear the inputs after a successful add so the row is ready for
  // another stage. Adjusting state while rendering (keyed on the state
  // OBJECT, not the status string) so back-to-back successful adds
  // each clear; the action returns a fresh object per call.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.status === "ok") {
      setName("");
      setIsTerminal(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-2 py-1.5 rounded-md border border-dashed border-line"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <input
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-label="New stage name"
          placeholder="New stage name (e.g. Mediation)"
          className={cn(inputClass(!!errs.name, "xs"), "w-full")}
        />
        {errs.name && errs.name.length > 0 && (
          <div className="text-2xs text-warn">{errs.name[0]}</div>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-2xs text-ink-2 cursor-pointer select-none px-1">
        <input
          type="checkbox"
          name="isTerminal"
          checked={isTerminal}
          onChange={(e) => setIsTerminal(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-line"
        />
        terminal
      </label>

      <button
        type="submit"
        disabled={isPending}
        className={cn(
          "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium bg-brand-700 hover:bg-brand-900 text-white",
          "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        )}
      >
        <Plus size={12} />
        {isPending ? "Adding…" : "Add stage"}
      </button>
    </form>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      // Always type="button" — these render inside the StageRow
      // <form>, and a default (submit) type would fire the rename
      // action on every move/archive click.
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3",
        "hover:text-brand-700 hover:bg-brand-soft transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      )}
    >
      {children}
    </button>
  );
}
