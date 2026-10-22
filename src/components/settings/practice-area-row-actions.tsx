/**
 * Practice Area row-level actions — archive/restore + reorder.
 *
 * Stays small: a couple of icon buttons. Archive is blocked server-
 * side when the area still has active matters, so the "archive"
 * button here surfaces the server's error message as a toast.
 */

"use client";

import { useTransition } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyError } from "@/lib/feedback";
import { movePracticeArea, setPracticeAreaActive } from "@/app/actions/practice-areas";
import { areaArchiveBlockedMessage } from "@/lib/practice-area-constants";

export function PracticeAreaRowActions({
  areaId,
  isActive,
  activeMatterCount,
  canMoveUp = true,
  canMoveDown = true,
}: {
  areaId: string;
  isActive: boolean;
  activeMatterCount: number;
  /** False at the top / bottom of the ACTIVE list (computed by the
   *  page) so a boundary click can't silently swap with a hidden
   *  archived neighbour. */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const toggleActive = () => {
    if (isActive && activeMatterCount > 0) {
      notifyError(areaArchiveBlockedMessage(activeMatterCount));
      return;
    }
    startTransition(async () => {
      const res = await setPracticeAreaActive(areaId, !isActive);
      if (!res.ok && res.error) notifyError(res.error);
    });
  };

  const move = (direction: "up" | "down") => {
    startTransition(async () => {
      await movePracticeArea(areaId, direction);
    });
  };

  return (
    <div className="flex items-center gap-0.5">
      {isActive && (
        <>
          <IconButton onClick={() => move("up")} disabled={pending || !canMoveUp} label="Move up">
            <ArrowUp size={13} />
          </IconButton>
          <IconButton
            onClick={() => move("down")}
            disabled={pending || !canMoveDown}
            label="Move down"
          >
            <ArrowDown size={13} />
          </IconButton>
        </>
      )}
      <IconButton
        onClick={toggleActive}
        disabled={pending}
        label={isActive ? "Archive" : "Restore"}
      >
        {isActive ? <Archive size={13} /> : <ArchiveRestore size={13} />}
      </IconButton>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3",
        "hover:text-brand-700 hover:bg-brand-soft transition-colors",
        "disabled:opacity-60 disabled:cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
