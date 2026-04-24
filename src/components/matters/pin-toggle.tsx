/**
 * Pin Toggle
 *
 * A pin/unpin button for the matter detail header. Optimistically flips
 * the icon state on click, then calls the `toggleMatterPin` server
 * action which updates the DB and revalidates the sidebar + list.
 */

"use client";

import { Pin, PinOff } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toggleMatterPin } from "@/app/actions/matter-pins";
import { cn } from "@/lib/utils";

export function PinToggle({
  matterId,
  initialPinned,
}: {
  matterId: string;
  initialPinned: boolean;
}) {
  const [optimisticPinned, setOptimisticPinned] = useOptimistic(initialPinned);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      setOptimisticPinned(!optimisticPinned);
      await toggleMatterPin(matterId);
    });
  };

  const Icon = optimisticPinned ? Pin : PinOff;
  const label = optimisticPinned ? "Unpin matter" : "Pin matter";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={optimisticPinned}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors",
        optimisticPinned
          ? "bg-brand-soft text-brand-700 border-brand-200 hover:bg-brand-50"
          : "bg-white text-ink-3 border-line hover:text-brand-700 hover:border-brand-300",
        pending && "opacity-70"
      )}
    >
      <Icon size={13} className={optimisticPinned ? "fill-brand-500 text-brand-500" : undefined} />
      {optimisticPinned ? "Pinned" : "Pin"}
    </button>
  );
}
