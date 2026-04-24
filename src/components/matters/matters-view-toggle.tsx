/**
 * Matters List View Toggle
 *
 * Segmented control that switches between the table and kanban views
 * by writing `?view=...` to the URL. Default view (table) omits the
 * param to keep URLs short.
 */

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Rows3, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_VIEW, type ViewMode } from "@/lib/matters-filters";

const VIEWS: Array<{
  value: ViewMode;
  label: string;
  icon: typeof Rows3;
}> = [
  { value: "table", label: "Table", icon: Rows3 },
  { value: "kanban", label: "Kanban", icon: Columns3 },
];

export function MattersViewToggle({ view }: { view: ViewMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setView = (next: ViewMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_VIEW) params.delete("view");
    else params.set("view", next);
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn(
        "inline-flex items-center rounded-md border border-line bg-white p-0.5",
        pending && "opacity-70"
      )}
    >
      {VIEWS.map((v) => {
        const active = view === v.value;
        const Icon = v.icon;
        return (
          <button
            key={v.value}
            type="button"
            onClick={() => setView(v.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2 rounded text-2xs font-medium transition-colors",
              active
                ? "bg-brand-soft text-brand-700"
                : "text-ink-3 hover:text-brand-700"
            )}
          >
            <Icon size={12} />
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
