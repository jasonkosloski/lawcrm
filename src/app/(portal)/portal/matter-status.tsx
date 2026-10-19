/** Open / Closed pill for a portal matter (closed = archived). */

import { cn } from "@/lib/utils";

export function MatterStatus({ closed }: { closed: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        closed
          ? "border-line bg-paper-2 text-ink-3"
          : "border-[#a4d4bc] bg-ok-soft text-ok"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          closed ? "bg-ink-4" : "bg-ok"
        )}
      />
      {closed ? "Closed" : "Open"}
    </span>
  );
}
