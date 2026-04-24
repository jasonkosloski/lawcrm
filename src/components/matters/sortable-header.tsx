/**
 * Sortable Column Header
 *
 * Client-side header cell that updates the URL's `sort` and `dir` params
 * when clicked. The default direction for each field is set in
 * `DEFAULT_DIR_FOR_FIELD` so users get sensible defaults on first click
 * (A-Z for text, largest-first for numbers).
 */

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_SORT, type SortField } from "@/lib/matters-filters";

export function SortableHeader({
  field,
  children,
  align = "left",
}: {
  field: SortField;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // URL state — `sort` param absent = no active sort (default ordering applies).
  const activeField = params.get("sort");
  const activeDir = params.get("dir");
  const isActive = activeField === field;

  // Three-state cycle: click 1 → asc, click 2 → desc, click 3 → clear.
  const onClick = () => {
    const next = new URLSearchParams(params.toString());
    if (!isActive) {
      next.set("sort", field);
      next.set("dir", "asc");
    } else if (activeDir === "asc") {
      next.set("sort", field);
      next.set("dir", "desc");
    } else {
      next.delete("sort");
      next.delete("dir");
    }
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false });
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
