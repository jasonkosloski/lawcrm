/**
 * Top Bar
 *
 * 56px header with breadcrumbs, page title (Fraunces display font),
 * and right-side actions. A 3px brand gradient hairline runs along the
 * top edge per the design spec.
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
  const { openPalette } = useCommandPalette();
  const { toggle } = useMobileNav();
  return (
    <div className="flex flex-col shrink-0 bg-card border-b border-line">
      {/* ── Brand gradient hairline ──────────────────────────────────────── */}
      <div className="brand-gradient-line" />

      {/* ── Title row ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5">
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
              <div className="font-mono text-[10px] text-ink-4 tracking-[0.04em] uppercase truncate">
                {crumbs}
              </div>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <h1
                className="font-display text-base sm:text-xl font-medium tracking-tight truncate"
                style={{ color: "#0f1b2e", letterSpacing: "-0.02em" }}
              >
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
              "flex items-center gap-1.5 h-9 sm:h-7 px-2 sm:px-2.5 rounded-md border border-line-2",
              "bg-white text-ink-3 text-xs hover:border-brand-300 transition-colors"
            )}
            title="Search (⌘K)"
            aria-label="Search"
          >
            <Search size={13} />
            <span className="hidden sm:inline">Search</span>
            <span
              className="hidden sm:inline text-[10px] font-mono text-brand-700 px-1 border border-line-2 rounded bg-white ml-1"
              style={{ borderBottomWidth: 2 }}
            >
              ⌘K
            </span>
          </button>

          {/* Bell sits between Search and per-page actions so it's
              always available without each page passing it. Self-
              fetches its data; falls back to no-badge while loading. */}
          <NotificationBell />

          {actions}
        </div>
      </div>

      {below}
    </div>
  );
}
