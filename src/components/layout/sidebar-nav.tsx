/**
 * Sidebar Navigation
 *
 * Fixed 240px sidebar with the Kosloski Law brand tile, grouped navigation
 * (WORK, PEOPLE, FINANCE, ADMIN), practice area shortcuts, pinned matters,
 * and a user status strip at the bottom.
 *
 * Design tokens: warm paper gradient background, blue-500 active state,
 * #eaf0f5 hover, badges in mono with blue-50 bg.
 */

"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Home,
  Gavel,
  Inbox,
  Mail,
  Calendar,
  Clock,
  DollarSign,
  BarChart3,
  Zap,
  Settings,
  Bell,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/** Navigation item configuration. */
interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: React.ElementType;
  badge?: string;
  dotColor?: string;
}

/** Section header + items grouping. */
interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * Main navigation sections. IDs match route segments.
 * Badges will eventually be driven by real-time data.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { id: "dashboard", label: "Today", href: "/", icon: Home },
      { id: "matters", label: "Matters", href: "/matters", icon: Gavel, badge: "34" },
      { id: "intake", label: "Intake", href: "/intake", icon: Inbox, badge: "23" },
      { id: "email", label: "Email", href: "/email", icon: Mail, badge: "12" },
      { id: "calendar", label: "Calendar", href: "/calendar", icon: Calendar },
      { id: "time", label: "Time", href: "/time", icon: Clock, badge: "47.2h" },
      { id: "billing", label: "Billing", href: "/billing", icon: DollarSign },
    ],
  },
  {
    label: "Practice areas",
    items: [
      { id: "area-1983", label: "§1983 / Civil rights", href: "/matters?area=1983", badge: "18", dotColor: "var(--color-area-1983)" },
      { id: "area-cada", label: "Employment · CADA", href: "/matters?area=cada", badge: "6", dotColor: "var(--color-area-employment)" },
      { id: "area-fha", label: "Housing · FHA", href: "/matters?area=fha", badge: "4", dotColor: "var(--color-area-housing)" },
      { id: "area-criminal", label: "Criminal (flat)", href: "/matters?area=criminal", badge: "3", dotColor: "var(--color-area-criminal)" },
      { id: "area-class", label: "Class actions", href: "/matters?area=class", badge: "2", dotColor: "var(--color-area-class)" },
    ],
  },
  {
    label: "Pinned matters",
    items: [
      { id: "matter-alvarez", label: "Alvarez v. Aurora PD", href: "/matters/alvarez", dotColor: "var(--color-area-1983)" },
      { id: "matter-williams", label: "Williams v. Denver", href: "/matters/williams", dotColor: "var(--color-area-1983)" },
      { id: "matter-aurora", label: "In re: Aurora class", href: "/matters/aurora", dotColor: "var(--color-area-class)" },
    ],
  },
  {
    label: "Firm",
    items: [
      { id: "reports", label: "Reports", href: "/reports", icon: BarChart3 },
      { id: "automations", label: "Automations", href: "/automations", icon: Zap, badge: "14" },
      { id: "settings", label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/** Determines if a nav item is active based on the current pathname. */
function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside
      className="flex flex-col w-60 shrink-0 h-full border-r border-line"
      style={{
        background: "linear-gradient(180deg, #f6f5ef 0%, #eef2f5 100%)",
      }}
    >
      {/* ── Firm logo + command palette trigger ──────────────────────────── */}
      <div className="flex items-center justify-between p-3 pb-2">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-6 h-6 rounded-md text-white font-display text-[15px] font-semibold"
            style={{
              background: "linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))",
              boxShadow:
                "0 2px 6px -2px rgba(37,99,168,.55), inset 0 1px 0 rgba(255,255,255,.18)",
              letterSpacing: "-0.04em",
            }}
          >
            k
          </div>
          <span className="font-display text-sm font-medium">Kosloski Law</span>
        </div>
        <button
          className="inline-block px-1.5 h-4 leading-[14px] border border-line-2 rounded text-[10px] font-mono text-brand-700 bg-white cursor-pointer hover:border-brand-300 transition-colors"
          style={{ borderBottomWidth: 2 }}
          title="Command palette (⌘K)"
        >
          ⌘K
        </button>
      </div>

      {/* ── Navigation groups ────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-1.5 pb-2.5 scrollbar-thin">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div className="px-2.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">
                {section.label}
              </div>
            )}
            <div className="flex flex-col gap-px">
              {section.items.map((item) => {
                const active = isActive(item.href, pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-[5px] rounded-md text-[12.5px] transition-all duration-100 cursor-pointer",
                      active
                        ? "bg-brand-500 text-white shadow-[0_1px_0_rgba(0,0,0,.04),inset_0_1px_0_rgba(255,255,255,.12)]"
                        : "text-ink-2 hover:bg-[#eaf0f5] hover:text-brand-700"
                    )}
                  >
                    {item.dotColor && (
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{
                          background: item.dotColor,
                          ...(active ? { boxShadow: "0 0 0 2px rgba(255,255,255,.35)" } : {}),
                        }}
                      />
                    )}
                    {Icon && (
                      <span
                        className={cn(
                          "w-4 h-4 shrink-0 flex items-center justify-center",
                          active ? "text-white" : "text-ink-3"
                        )}
                      >
                        <Icon size={14} />
                      </span>
                    )}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {item.label}
                    </span>
                    {item.badge !== undefined && (
                      <span
                        className={cn(
                          "ml-auto text-[10px] font-mono font-medium px-1.5 py-px rounded-lg",
                          active
                            ? "bg-white/[.18] text-white border border-transparent"
                            : "bg-brand-50 text-brand-700 border border-brand-100"
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── User profile strip ───────────────────────────────────────────── */}
      <div className="border-t border-line">
        <div className="flex items-center gap-2 p-2.5">
          <Avatar className="h-7 w-7 shadow-[0_0_0_2px_var(--color-brand-100)]">
            <AvatarFallback className="text-[11px] font-semibold bg-[#efe3d9] text-ink-2">
              JM
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[11.5px] font-medium truncate">Jane Marsh</span>
            <span className="text-[10.5px] text-ink-4">Attorney · partner</span>
          </div>
          <span className="relative">
            <Bell size={14} className="text-ink-3" />
            <span className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full bg-danger border-[1.5px] border-white" />
          </span>
        </div>

        {/* ── Sync status bar ──────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3.5 h-[26px] px-3.5 text-[10.5px] font-mono text-ink-3 border-t"
          style={{
            background: "#e8ece9",
            borderTopColor: "#d8d3c7",
            color: "#4a5561",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: "var(--color-brand-500)",
              boxShadow: "0 0 0 3px rgba(37,99,168,.18)",
            }}
          />
          synced · 2s ago
          <span className="ml-auto">v1.0</span>
        </div>
      </div>
    </aside>
  );
}
