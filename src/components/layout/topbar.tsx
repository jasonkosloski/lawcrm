/**
 * Top Bar
 *
 * 56px header with breadcrumbs, page title (Fraunces display font),
 * and right-side actions. A 3px brand gradient hairline runs along the
 * top edge per the design spec.
 */

"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface TopBarProps {
  /** Page title displayed in Fraunces display font. */
  title: string;
  /** Optional uppercase breadcrumb text, e.g. "WORK · MATTERS". */
  crumbs?: string;
  /** Content rendered to the right of the title (action buttons, etc.). */
  actions?: React.ReactNode;
  /** Content rendered below the title row (tabs, filters, etc.). */
  below?: React.ReactNode;
  /** Optional subtitle or status chips next to the title. */
  subtitle?: React.ReactNode;
}

export function TopBar({ title, crumbs, actions, below, subtitle }: TopBarProps) {
  return (
    <div className="flex flex-col shrink-0 bg-card border-b border-line">
      {/* ── Brand gradient hairline ──────────────────────────────────────── */}
      <div className="brand-gradient-line" />

      {/* ── Title row ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          {crumbs && (
            <div className="font-mono text-[10px] text-ink-4 tracking-[0.04em] uppercase">
              {crumbs}
            </div>
          )}
          <div className="flex items-center gap-2">
            <h1
              className="font-display text-xl font-medium tracking-tight"
              style={{ color: "#0f1b2e", letterSpacing: "-0.02em" }}
            >
              {title}
            </h1>
            {subtitle}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* ── Global search trigger ──────────────────────────────────── */}
          <button
            className={cn(
              "flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line-2",
              "bg-white text-ink-3 text-xs hover:border-brand-300 transition-colors"
            )}
          >
            <Search size={13} />
            <span>Search</span>
            <span
              className="text-[10px] font-mono text-brand-700 px-1 border border-line-2 rounded bg-white ml-1"
              style={{ borderBottomWidth: 2 }}
            >
              ⌘K
            </span>
          </button>

          {actions}
        </div>
      </div>

      {below}
    </div>
  );
}
