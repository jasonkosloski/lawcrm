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
 * Star is optimistic (flips instantly, reverts on failure) and sets
 * an explicit state rather than toggling, so a stale row can't invert
 * the click; archive relies on the action's revalidation (plus a
 * router.refresh for the stale-row no-op) to move the row between the
 * Inbox and Archived mailboxes. Failures show a short inline message. Both server actions are mailbox-
 * scoped and push a Gmail label writeback that never breaks the
 * local change (see actions/email-thread-flags.ts).
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { setEmailThreadArchived, setEmailThreadStarred } from "@/app/actions/email-thread-flags";

export function ThreadRowActions({
  threadId,
  isStarred,
  isArchived,
}: {
  threadId: string;
  isStarred: boolean;
  isArchived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    startTransition(async () => {
      try {
        // Idempotent set (not a server-side toggle): the row may be
        // stale (sync changed the flag after render), and a toggle
        // would then invert what the user asked for.
        const res = await setEmailThreadStarred(threadId, next);
        if (res.ok) {
          setStarred(res.isStarred ?? next);
        } else {
          setStarred(!next); // revert — thread not ours / gone
          setError("Couldn't update the star.");
        }
      } catch {
        // Rejected action: revert, and keep it out of the error
        // boundary (which would blank the whole communication page).
        setStarred(!next);
        setError("Couldn't update the star.");
      }
    });
  };

  const onToggleArchive = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setEmailThreadArchived(threadId, !isArchived);
        if (res.ok) {
          // The action no-ops WITHOUT revalidating when the DB already
          // holds the requested state (sync archived it in Gmail after
          // this row rendered) - refresh so a stale row corrects itself.
          router.refresh();
        } else {
          setError("Couldn't update this thread.");
        }
      } catch {
        setError("Couldn't update this thread.");
      }
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
        "focus-within:opacity-100 focus-within:pointer-events-auto",
        // A failed star/archive must stay visible after the pointer
        // leaves, or the user never learns why the star reverted.
        error && "opacity-100 pointer-events-auto",
      )}
    >
      {error && (
        <span role="alert" className="px-1 text-3xs text-warn whitespace-nowrap">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={onToggleStar}
        disabled={pending}
        aria-label={starred ? "Unstar thread" : "Star thread"}
        title={starred ? "Unstar" : "Star"}
        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-brand-tint disabled:opacity-50"
      >
        <Star size={13} className={starred ? "text-warn fill-warn" : "text-ink-3"} />
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
