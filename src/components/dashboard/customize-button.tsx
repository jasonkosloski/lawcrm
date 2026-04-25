/**
 * Dashboard Customize Button
 *
 * Lives in the dashboard topbar. Opens a popover with one checkbox per
 * card. Toggling a checkbox calls the `setDashboardCardVisible` server
 * action and optimistically updates local state so the UI feels instant
 * — the page revalidates after the action completes and the cards
 * appear/disappear on the next paint.
 */

"use client";

import { useState, useTransition } from "react";
import { Settings2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DASHBOARD_CARD_KEYS,
  DASHBOARD_CARD_LABELS,
  type DashboardCardKey,
  type DashboardVisibility,
} from "@/lib/dashboard-prefs";
import { setDashboardCardVisible } from "@/app/actions/dashboard-prefs";

export function DashboardCustomizeButton({
  initialVisibility,
}: {
  initialVisibility: DashboardVisibility;
}) {
  const [visibility, setVisibility] =
    useState<DashboardVisibility>(initialVisibility);
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
        <div className="flex flex-col gap-0.5">
          <div className="text-2xs font-semibold uppercase tracking-wider text-ink-3 px-1 pb-1">
            Show on dashboard
          </div>
          {DASHBOARD_CARD_KEYS.map((key) => (
            <label
              key={key}
              className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-md hover:bg-paper-2 cursor-pointer"
            >
              <Checkbox
                checked={visibility[key]}
                onCheckedChange={(checked) => toggle(key, checked)}
              />
              <span className="text-xs text-ink">
                {DASHBOARD_CARD_LABELS[key]}
              </span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
