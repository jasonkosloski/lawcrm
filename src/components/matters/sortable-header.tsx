/**
 * Sortable Column Header
 *
 * Client-side header cell that updates the URL's `sort` and `dir` params
 * when clicked. Each header runs a three-state cycle on its own field:
 * first click sorts ascending, second descending, third clears the sort
 * (the page's default ordering applies again). Every field starts
 * ascending — there is no per-field default direction.
 *
 * `SortableHead` is the `<th>` wrapper that also publishes `aria-sort`
 * (the attribute belongs on the column header, not the button inside).
 */

"use client";

import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortField } from "@/lib/matters-filters";
import { TableHead } from "@/components/ui/table";
import { useUrlParams } from "@/hooks/use-url-params";

export function SortableHeader({
  field,
  children,
  align = "left",
}: {
  field: SortField;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const { searchParams, setParams, pending } = useUrlParams();

  // URL state — `sort` param absent = no active sort (default ordering applies).
  const activeField = searchParams.get("sort");
  const activeDir = searchParams.get("dir");
  const isActive = activeField === field;

  const onClick = () => {
    // Decide from the latest params (including a click still in flight),
    // not the committed render, so rapid clicks advance the cycle.
    setParams((next) => {
      if (next.get("sort") !== field) {
        next.set("sort", field);
        next.set("dir", "asc");
      } else if (next.get("dir") === "asc") {
        next.set("dir", "desc");
      } else {
        next.delete("sort");
        next.delete("dir");
      }
    });
  };

  const Icon = !isActive ? ArrowUpDown : activeDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium transition-colors",
        align === "right" && "justify-end w-full",
        isActive ? "text-brand-700" : "text-ink-2 hover:text-brand-700",
        pending && "opacity-70"
      )}
    >
      {children}
      <Icon size={11} className={isActive ? "opacity-100" : "opacity-40"} />
    </button>
  );
}

/** A table `<th>` hosting a SortableHeader, with `aria-sort` set from
 *  the URL so assistive tech announces the active sort. */
export function SortableHead({
  field,
  children,
  align = "left",
  className,
}: {
  field: SortField;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const isActive = searchParams.get("sort") === field;
  const ariaSort = !isActive
    ? "none"
    : searchParams.get("dir") === "asc"
      ? "ascending"
      : "descending";
  return (
    <TableHead className={className} aria-sort={ariaSort}>
      <SortableHeader field={field} align={align}>
        {children}
      </SortableHeader>
    </TableHead>
  );
}
