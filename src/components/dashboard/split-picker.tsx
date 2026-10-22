"use client";

import { DASHBOARD_SPLITS, SPLIT_SPANS, type DashboardSplit } from "@/lib/dashboard-prefs";
import { cn } from "@/lib/utils";

/** "8/4" -> "8 / 4" (accessible name and visible label). */
export const splitLabel = (s: DashboardSplit) => s.replaceAll("/", " / ");

/**
 * Radiogroup choosing the column split. Each option draws a tiny
 * proportional preview of its columns. Arrow keys move the selection.
 */
export function SplitPicker({
  value,
  onChange,
}: {
  value: DashboardSplit;
  onChange: (split: DashboardSplit) => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const n = DASHBOARD_SPLITS.length;
    const next = DASHBOARD_SPLITS[(i + step + n) % n];
    onChange(next);
    const group = e.currentTarget.parentElement;
    requestAnimationFrame(() =>
      group?.querySelectorAll<HTMLElement>('[role="radio"]')[(i + step + n) % n]?.focus(),
    );
  };

  return (
    <div role="radiogroup" aria-label="Column layout" className="flex items-center gap-1">
      {DASHBOARD_SPLITS.map((split, i) => {
        const checked = split === value;
        return (
          <button
            key={split}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={splitLabel(split)}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(split)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "flex h-7 w-14 items-stretch gap-0.5 rounded-md border p-1 transition-colors",
              checked
                ? "border-brand-300 bg-paper-2"
                : "border-line-2 bg-white hover:border-brand-300",
            )}
          >
            {SPLIT_SPANS[split].map((span, c) => (
              <span
                key={c}
                style={{ flexGrow: span }}
                className={cn("rounded-sm", checked ? "bg-ink-3" : "bg-line-2")}
              />
            ))}
          </button>
        );
      })}
    </div>
  );
}
