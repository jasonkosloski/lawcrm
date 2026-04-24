/**
 * Sidebar Navigation
 *
 * Fixed 240px sidebar with the Kosloski Law brand tile, grouped navigation
 * (primary, practice areas, pinned matters, firm admin), and a user
 * status strip at the bottom.
 *
 * Receives live data from `AppShell` as props:
 *  - currentUser (logged-in attorney)
 *  - badge counts (open matters, unread email, active leads, hours today)
 *  - pinned matters (user's pinned list)
 *  - practice-area counts (matters per area, excluding archived/closed)
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { SidebarData } from "@/lib/queries/sidebar";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: React.ElementType;
  badge?: string;
  dotColor?: string;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

/** Determines if a nav item is active based on the current pathname. */
function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  // For ?area=… links, compare just the pathname portion; otherwise an
  // area link matches /matters and lights up unexpectedly.
  const bareHref = href.split("?")[0];
  if (href.includes("?")) return false;
  return pathname.startsWith(bareHref);
}

/** Format small numeric badges. Returns undefined when the count is zero
 *  so the badge is omitted entirely. */
const numBadge = (n: number): string | undefined =>
  n > 0 ? n.toString() : undefined;

export function SidebarNav({ data }: { data: SidebarData }) {
  const pathname = usePathname();

  const sections: NavSection[] = [
    {
      items: [
        { id: "dashboard", label: "Today", href: "/", icon: Home },
        {
          id: "matters",
          label: "Matters",
          href: "/matters",
          icon: Gavel,
          badge: numBadge(data.openMatterCount),
        },
        {
          id: "intake",
          label: "Intake",
          href: "/intake",
          icon: Inbox,
          badge: numBadge(data.activeLeadCount),
        },
        {
          id: "email",
          label: "Email",
          href: "/email",
          icon: Mail,
          badge: numBadge(data.unreadEmailCount),
        },
        { id: "calendar", label: "Calendar", href: "/calendar", icon: Calendar },
        {
          id: "time",
          label: "Time",
          href: "/time",
          icon: Clock,
          badge: data.hoursToday > 0 ? `${data.hoursToday.toFixed(1)}h` : undefined,
        },
        { id: "billing", label: "Billing", href: "/billing", icon: DollarSign },
      ],
    },
    {
      label: "Practice areas",
      items: data.areaCounts.map((a) => ({
        id: `area-${a.area}`,
        label: a.label,
        href: `/matters?area=${encodeURIComponent(a.area)}`,
        badge: a.count.toString(),
        dotColor: a.color,
      })),
    },
    // Only render the Pinned section when at least one matter is pinned.
    ...(data.pinnedMatters.length > 0
      ? [
          {
            label: "Pinned matters",
            items: data.pinnedMatters.map((m) => ({
              id: `matter-${m.id}`,
              label: m.name,
              href: `/matters/${m.id}`,
              dotColor: m.color,
            })),
          },
        ]
      : []),
    {
      label: "Firm",
      items: [
        { id: "reports", label: "Reports", href: "/reports", icon: BarChart3 },
        { id: "automations", label: "Automations", href: "/automations", icon: Zap },
        { id: "settings", label: "Settings", href: "/settings", icon: Settings },
      ],
    },
  ];

  const user = data.currentUser;

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
            className="flex items-center justify-center w-6 h-6 rounded-md text-white font-display text-sm font-semibold"
            style={{
              background:
                "linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))",
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
          className="inline-block px-1.5 h-4 leading-[14px] border border-line-2 rounded text-2xs font-mono text-brand-700 bg-white cursor-pointer hover:border-brand-300 transition-colors"
          style={{ borderBottomWidth: 2 }}
          title="Command palette (⌘K)"
        >
          ⌘K
        </button>
      </div>

      {/* ── Navigation groups ────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-1.5 pb-2.5 scrollbar-thin">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div className="px-2.5 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-4">
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
                      "flex items-center gap-2 px-2.5 py-[5px] rounded-md text-xs transition-all duration-100 cursor-pointer",
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
                          ...(active
                            ? { boxShadow: "0 0 0 2px rgba(255,255,255,.35)" }
                            : {}),
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
                          "ml-auto text-2xs font-mono font-medium px-1.5 py-px rounded-lg",
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
            <AvatarFallback className="text-2xs font-semibold bg-[#efe3d9] text-ink-2">
              {user?.initials ?? "??"}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-medium truncate">
              {user?.name ?? "Not signed in"}
            </span>
            <span className="text-2xs text-ink-4">
              {user?.role ? `${user.role} · partner` : "—"}
            </span>
          </div>
          <span className="relative">
            <Bell size={14} className="text-ink-3" />
            <span className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full bg-danger border-[1.5px] border-white" />
          </span>
        </div>

        {/* ── Sync status bar ──────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3.5 h-[26px] px-3.5 text-2xs font-mono text-ink-3 border-t"
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
