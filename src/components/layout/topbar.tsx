/**
 * Top Bar
 *
 * Page header: an optional context line (a breadcrumb or the page's
 * counts, sentence case), the page title in Fraunces, and the actions.
 * White on the paper ground with one hairline under it; no ornament.
 */

"use client";

import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "@/components/command-palette/command-palette-provider";
import { NotificationBell } from "./notification-bell";
import { useMobileNav } from "./mobile-nav-provider";

interface TopBarProps {
  /** Page title displayed in Fraunces display font. */
  title: string;
  /** Optional context line above the title: a breadcrumb
   *  ("Matters / New") or the page's counts ("10 open · 1 closed"). */
  crumbs?: string;
  /** Content rendered to the right of the title (action buttons, etc.). */
  actions?: React.ReactNode;
  /** Content rendered below the title row (tabs, filters, etc.). */
  below?: React.ReactNode;
  /** Optional subtitle or status chips next to the title. */
  subtitle?: React.ReactNode;
}

export function TopBar({ title, crumbs, actions, below, subtitle }: TopBarProps) {
  const { openPalette } = useCommandPalette();
  const { toggle } = useMobileNav();
  return (
    <div className="flex flex-col shrink-0 bg-card border-b border-line">
      {/* ── Title row ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-3 sm:px-6 min-h-14 py-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Hamburger — visible only below `lg` where the sidebar
              is hidden by default. lg+ users have the persistent
              sidebar so the toggle would be noise. */}
          <button
            onClick={toggle}
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 -ml-1 rounded-md text-ink-2 hover:bg-paper-2 shrink-0"
            title="Open navigation"
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>
          <div className="flex flex-col gap-0.5 min-w-0">
            {crumbs && (
              <div className="text-2xs text-ink-4 truncate tabular-nums">
                {crumbs}
              </div>
            )}
            <div className="flex items-center gap-2.5 min-w-0">
              <h1 className="font-display text-lg sm:text-xl leading-tight font-medium tracking-[-0.015em] text-ink truncate">
                {title}
              </h1>
              {/* Subtitle chips hide below sm — they're contextual
                  decoration, not load-bearing. The crumbs already
                  carry the matter / page name. */}
              <div className="hidden sm:flex items-center gap-2">
                {subtitle}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Search trigger. Below `sm` it collapses to icon-only
              (the ⌘K hint also hides — keyboard users on mobile
              are rare). */}
          <button
            onClick={openPalette}
            className={cn(
              "flex items-center gap-2 h-9 px-2.5 sm:w-52 rounded-md border border-input",
              "bg-white text-ink-4 text-xs hover:text-ink-2 transition-colors"
            )}
            title="Search (⌘K)"
            aria-label="Search"
          >
            <Search size={15} aria-hidden />
            <span className="hidden sm:inline whitespace-nowrap">Search</span>
            <span className="hidden sm:inline ml-auto text-2xs text-ink-4">
              ⌘K
            </span>
          </button>

          {/* Bell sits between Search and per-page actions so it's
              always available without each page passing it. Its state
              comes from the shell-level NotificationBellProvider, so
              it survives navigation (no refetch / badge flicker per
              page); no badge until the first fetch lands. */}
          <NotificationBell />

          {actions}
        </div>
      </div>

      {below}
    </div>
  );
}
