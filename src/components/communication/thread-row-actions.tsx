/**
 * Thread Row Actions — star toggle + archive/unarchive for one email
 * thread, overlaid on list rows (Email v1.1).
 *
 * The thread lists are server components whose rows are `<Link>`s;
 * interactive controls can't nest inside an anchor, so the caller
 * renders this as a SIBLING of the Link inside a `relative group`
 * `<li>` and this cluster positions itself over the row's right
 * edge. Gmail-style reveal: invisible until the row is hovered (or a
 * button inside is keyboard-focused — opacity, not `hidden`, so the
 * buttons stay tabbable), on a solid chip so it reads over any row
 * background.
 *
 * Star is optimistic (flips instantly, reverts on failure); archive
 * relies on the action's revalidation to move the row between the
 * Inbox and Archived mailboxes. Both server actions are mailbox-
 * scoped and push a Gmail label writeback that never breaks the
 * local change (see actions/email-thread-flags.ts).
 */

"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  setEmailThreadArchived,
  toggleEmailThreadStar,
} from "@/app/actions/email-thread-flags";

export function ThreadRowActions({
  threadId,
  isStarred,
  isArchived,
}: {
  threadId: string;
  isStarred: boolean;
  isArchived: boolean;
}) {
  const [pending, startTransition] = useTransition();

  // Optimistic star with prop re-sync: after the action revalidates,
  // the server prop becomes the source of truth again.
  const [starred, setStarred] = useState(isStarred);
  const [prevProp, setPrevProp] = useState(isStarred);
  if (isStarred !== prevProp) {
    setPrevProp(isStarred);
    setStarred(isStarred);
  }

  const onToggleStar = () => {
    const next = !starred;
    setStarred(next);
    startTransition(async () => {
      const res = await toggleEmailThreadStar(threadId);
      if (!res.ok) setStarred(!next); // revert — thread not ours / gone
    });
  };

  const onToggleArchive = () => {
    startTransition(async () => {
      await setEmailThreadArchived(threadId, !isArchived);
    });
  };

  return (
    <div
      className={cn(
        "absolute right-2 top-1/2 -translate-y-1/2 z-10",
        "flex items-center gap-0.5 rounded-md border border-line bg-white shadow-xs px-0.5 py-0.5",
        // Hover/focus reveal — opacity (not display) keeps the
        // buttons in the tab order for keyboard users.
        "opacity-0 pointer-events-none transition-opacity",
        "group-hover:opacity-100 group-hover:pointer-events-auto",
        "focus-within:opacity-100 focus-within:pointer-events-auto"
      )}
    >
      <button
        type="button"
        onClick={onToggleStar}
        disabled={pending}
        aria-label={starred ? "Unstar thread" : "Star thread"}
        title={starred ? "Unstar" : "Star"}
        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-brand-tint disabled:opacity-50"
      >
        <Star
          size={13}
          className={starred ? "text-warn fill-warn" : "text-ink-3"}
        />
      </button>
      <button
        type="button"
        onClick={onToggleArchive}
        disabled={pending}
        aria-label={isArchived ? "Unarchive thread" : "Archive thread"}
        title={isArchived ? "Move back to inbox" : "Archive"}
        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-brand-tint disabled:opacity-50"
      >
        {isArchived ? (
          <ArchiveRestore size={13} className="text-ink-3" />
        ) : (
          <Archive size={13} className="text-ink-3" />
        )}
      </button>
    </div>
  );
}
