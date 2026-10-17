/**
 * Pin Toggle
 *
 * A pin/unpin button for the matter detail header. Optimistically flips
 * the icon state on click, then calls `setMatterPin` with the state the
 * user clicked toward (idempotent, so a stale view in another tab can't
 * invert the intent) which updates the DB and revalidates the sidebar +
 * list. A failure drops the optimistic flip and tells the user.
 */

"use client";

import { Pin, PinOff } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { setMatterPin } from "@/app/actions/matter-pins";
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
    const target = !optimisticPinned;
    startTransition(async () => {
      setOptimisticPinned(target);
      try {
        const res = await setMatterPin(matterId, target);
        // The optimistic value falls back to the (unchanged) prop when
        // the transition ends, so a refusal needs no manual revert.
        if (!res.ok) alert(res.error ?? "Couldn't update the pin.");
      } catch {
        alert("Couldn't update the pin. Please try again.");
      }
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
