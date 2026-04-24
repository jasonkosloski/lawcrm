/**
 * Reactions Bar — inline strip of emoji reaction pills + an add
 * button at the bottom of a NoteCard.
 *
 * Existing reactions show as pills with a count; clicking a pill
 * toggles the current user's reaction (add / remove). A tiny 😊+
 * popover exposes the curated palette so the user can pick a new
 * emoji without a full picker.
 */

"use client";

import { useState, useTransition } from "react";
import { SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toggleNoteReaction } from "@/app/actions/notes";
import {
  REACTION_EMOJIS,
  type ReactionEmoji,
} from "@/lib/note-constants";
import type { NoteReactionSummary } from "@/lib/queries/matter-detail";

export function ReactionsBar({
  noteId,
  reactions,
}: {
  noteId: string;
  reactions: NoteReactionSummary[];
}) {
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  const toggle = (emoji: ReactionEmoji) => {
    setPickerOpen(false);
    startTransition(async () => {
      const res = await toggleNoteReaction(noteId, emoji);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  if (reactions.length === 0) {
    return (
      <AddReactionButton
        pending={pending}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={toggle}
        compact
      />
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => toggle(r.emoji as ReactionEmoji)}
          disabled={pending}
          aria-pressed={r.userReacted}
          className={cn(
            "inline-flex items-center gap-1 h-6 px-1.5 rounded-full border text-2xs font-mono transition-colors",
            r.userReacted
              ? "bg-brand-soft border-brand-200 text-brand-700"
              : "bg-white border-line text-ink-3 hover:border-brand-300 hover:text-brand-700",
            pending && "opacity-60 cursor-wait"
          )}
          title={r.userReacted ? "Remove your reaction" : "Add your reaction"}
        >
          <span className="text-xs leading-none">{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}
      <AddReactionButton
        pending={pending}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={toggle}
      />
    </div>
  );
}

function AddReactionButton({
  pending,
  open,
  onOpenChange,
  onPick,
  compact,
}: {
  pending: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (e: ReactionEmoji) => void;
  /** When there are no existing reactions, render the button as an
   *  understated ghost "+ React" link instead of a separate pill. */
  compact?: boolean;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        disabled={pending}
        className={cn(
          compact
            ? "inline-flex items-center gap-1 text-2xs text-ink-4 hover:text-brand-700 transition-colors"
            : "inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-line text-ink-4 hover:border-brand-300 hover:text-brand-700 transition-colors",
          pending && "opacity-60 cursor-wait"
        )}
        aria-label="Add a reaction"
        title="Add a reaction"
      >
        <SmilePlus size={compact ? 11 : 12} />
        {compact && <span>React</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1">
        <div className="flex items-center gap-0.5">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-brand-soft text-base leading-none"
              aria-label={`React with ${emoji}`}
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
