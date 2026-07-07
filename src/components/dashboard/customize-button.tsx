/**
 * Dashboard Customize Button
 *
 * Lives in the dashboard topbar. Opens a popover with one row per
 * card — a visibility checkbox plus up/down arrows — grouped by the
 * column the card renders in (main column vs. right rail), since v2
 * ordering only moves cards within their column.
 *
 * UX decisions worth noting:
 *   - Hidden cards STAY in the list and stay orderable. Their slot in
 *     the order is preserved, so re-showing a card puts it back where
 *     the user last ordered it (ordered-while-hidden, not
 *     ordered-on-show).
 *   - Arrows are disabled (not hidden) at the column edges so rows
 *     keep a stable layout.
 *
 * Both controls are optimistic: local state flips first, the server
 * action persists, and state reconciles to the server's canonical
 * answer (or rolls back on failure). The page revalidates after each
 * action so the cards re-render in the new arrangement.
 *
 * The panel body is a separate export (`DashboardCustomizePanel`) so
 * component tests can render it without driving the Popover open.
 */

"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DASHBOARD_CARD_LABELS,
  cardsInColumn,
  moveCardInColumn,
  type DashboardCardKey,
  type DashboardColumn,
  type DashboardPrefs,
} from "@/lib/dashboard-prefs";
import {
  setDashboardCardOrder,
  setDashboardCardVisible,
} from "@/app/actions/dashboard-prefs";

const COLUMN_LABELS: Record<DashboardColumn, string> = {
  main: "Main column",
  rail: "Right rail",
};

export function DashboardCustomizeButton({
  initialPrefs,
}: {
  initialPrefs: DashboardPrefs;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line-2 bg-white text-ink-3 text-xs hover:border-brand-300 transition-colors"
          >
            <Settings2 size={13} />
            <span>Customize</span>
          </button>
        }
      />
      <PopoverContent align="end" className="w-64">
        <DashboardCustomizePanel initialPrefs={initialPrefs} />
      </PopoverContent>
    </Popover>
  );
}

/** The popover body — exported separately for direct testing. */
export function DashboardCustomizePanel({
  initialPrefs,
}: {
  initialPrefs: DashboardPrefs;
}) {
  const [visibility, setVisibility] = useState(initialPrefs.visible);
  const [order, setOrder] = useState(initialPrefs.order);
  const [, startTransition] = useTransition();

  const toggle = (key: DashboardCardKey, checked: boolean) => {
    // Optimistic — flip locally first so the checkbox feels instant.
    setVisibility((prev) => ({ ...prev, [key]: checked }));
    startTransition(async () => {
      try {
        const next = await setDashboardCardVisible(key, checked);
        setVisibility(next);
      } catch {
        // Roll back on failure.
        setVisibility((prev) => ({ ...prev, [key]: !checked }));
      }
    });
  };

  const move = (key: DashboardCardKey, direction: "up" | "down") => {
    const next = moveCardInColumn(order, key, direction);
    if (!next) return; // already at the column edge
    const prev = order;
    // Optimistic — reorder locally first so the row jumps instantly.
    setOrder(next);
    startTransition(async () => {
      try {
        const saved = await setDashboardCardOrder(next);
        setOrder(saved);
      } catch {
        // Roll back on failure.
        setOrder(prev);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {(["main", "rail"] as const).map((column) => {
        const keys = cardsInColumn(order, column);
        return (
          <div key={column} className="flex flex-col gap-0.5">
            <div className="text-2xs font-semibold uppercase tracking-wider text-ink-3 px-1 pb-1">
              {COLUMN_LABELS[column]}
            </div>
            {keys.map((key, i) => (
              <div
                key={key}
                className="flex items-center gap-2.5 px-1.5 py-1 rounded-md hover:bg-paper-2"
              >
                <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer py-0.5">
                  <Checkbox
                    checked={visibility[key]}
                    onCheckedChange={(checked) => toggle(key, checked)}
                  />
                  <span className="text-xs text-ink truncate">
                    {DASHBOARD_CARD_LABELS[key]}
                  </span>
                </label>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    aria-label={`Move ${DASHBOARD_CARD_LABELS[key]} up`}
                    disabled={i === 0}
                    onClick={() => move(key, "up")}
                    className="w-5 h-5 flex items-center justify-center rounded text-ink-4 hover:text-ink hover:bg-paper-2 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${DASHBOARD_CARD_LABELS[key]} down`}
                    disabled={i === keys.length - 1}
                    onClick={() => move(key, "down")}
                    className="w-5 h-5 flex items-center justify-center rounded text-ink-4 hover:text-ink hover:bg-paper-2 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
