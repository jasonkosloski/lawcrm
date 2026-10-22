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
 * Design (UI system v2): the sidebar sits on the page ground behind one
 * hairline; the active item is a neutral pill, not a brand fill. Counts
 * are grey numerals; only queues that need action (unread email, new
 * leads) set theirs in ink. The practice-area group folds away so the
 * column fits a 900px-tall laptop.
 */

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Home,
  Gavel,
  Inbox,
  Mail,
  Calendar,
  Clock,
  BarChart3,
  ChevronRight,
  LogOut,
  Zap,
  Settings,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useCommandPalette } from "@/components/command-palette/command-palette-provider";
import { useClerk } from "@clerk/nextjs";
import type { SidebarData } from "@/lib/queries/sidebar";
import { useMobileNav } from "./mobile-nav-provider";
import { useIsDesktop } from "@/hooks/use-is-desktop";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: React.ElementType;
  badge?: string;
  /** A queue that needs action: its count is set in ink, not grey. */
  queue?: boolean;
  dotColor?: string;
}

interface NavSection {
  label?: string;
  /** localStorage key for a section the user can fold. */
  collapseKey?: string;
  items: NavItem[];
}

const COLLAPSE_EVENT = "sidebar-collapse-change";

function readCollapsed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribeToCollapse(callback: () => void) {
  window.addEventListener(COLLAPSE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Per-browser fold state for a sidebar section (UI_PATTERNS:
 *  per-browser preferences). Server snapshot is "open". */
function useCollapsed(key: string | undefined): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    subscribeToCollapse,
    () => (key ? readCollapsed(key) : false),
    () => false
  );
  const toggle = useCallback(() => {
    if (!key) return;
    try {
      window.localStorage.setItem(key, collapsed ? "0" : "1");
    } catch {
      // Private mode or blocked storage: the fold just doesn't persist.
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, [key, collapsed]);
  return [collapsed, toggle];
}

/**
 * Is this nav item active based on the current URL?
 *
 * - `/` is exact-match only (don't light up for every route).
 * - Plain hrefs (`/matters`, `/matters/<id>`) match on path prefix — this
 *   is how the parent section lights up along with a deeper destination
 *   (e.g. pinned-matter clicks light up both Matters and the matter).
 * - Query-string hrefs (`/matters?area=§1983`) require the path to match
 *   AND every key/value in the href's query string to be present in the
 *   current URL — so a practice-area link lights up when its filter is
 *   active, and coexists with the Matters parent being lit.
 */
function isActive(
  href: string,
  pathname: string,
  searchParams: URLSearchParams
): boolean {
  if (href === "/") return pathname === "/";
  const [hrefPath, hrefQuery] = href.split("?");
  if (!pathname.startsWith(hrefPath)) return false;
  if (!hrefQuery) return true;
  const hrefParams = new URLSearchParams(hrefQuery);
  for (const [key, value] of hrefParams.entries()) {
    if (!searchParams.getAll(key).includes(value)) return false;
  }
  return true;
}

/** Format small numeric badges. Returns undefined when the count is zero
 *  so the badge is omitted entirely. */
const numBadge = (n: number): string | undefined =>
  n > 0 ? n.toString() : undefined;

export function SidebarNav({
  data,
  canViewAutomations = false,
}: {
  data: SidebarData;
  /** Viewer holds `automations.view` (resolved server-side in AppShell). */
  canViewAutomations?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openPalette } = useCommandPalette();
  const { open, close } = useMobileNav();
  const isDesktop = useIsDesktop();

  // Auto-close the mobile drawer when the route changes by any other
  // means (back/forward, programmatic navigation). Watch the pathname
  // (not the full URL) because query-only changes (e.g. ?event=<id>
  // for the modal) shouldn't dismiss the drawer. Taps on the nav links
  // themselves close it directly via onClick below — the pathname
  // effect can't see practice-area links (`/matters?area=…`) or a tap
  // on the page you're already on, since neither changes the pathname.
  useEffect(() => {
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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
          queue: true,
        },
        {
          id: "communication",
          label: "Communication",
          href: "/communication",
          icon: Mail,
          badge: numBadge(data.unreadEmailCount),
          queue: true,
        },
        { id: "calendar", label: "Calendar", href: "/calendar", icon: Calendar },
        { id: "contacts", label: "Contacts", href: "/contacts", icon: Users },
        {
          id: "time",
          label: "Time",
          href: "/time",
          icon: Clock,
          badge: data.hoursToday > 0 ? `${data.hoursToday.toFixed(1)}h` : undefined,
        },
      ],
    },
    {
      label: "Practice areas",
      collapseKey: "sidebar:practice-areas-collapsed",
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
        // Reports is permission-gated (reports.view) — the flag is
        // resolved server-side in getSidebarData and threaded here,
        // same pattern as SettingsNav's `requires`. The /reports
        // page re-checks, so hiding the link is UX, not security.
        ...(data.canViewReports
          ? [{ id: "reports", label: "Reports", href: "/reports", icon: BarChart3 }]
          : []),
        // Automations lives under Settings (ADR-019) and is gated by
        // `automations.view`; the page re-checks, so hiding is UX.
        ...(canViewAutomations
          ? [
              {
                id: "automations",
                label: "Automations",
                href: "/settings/automations",
                icon: Zap,
              },
            ]
          : []),
        { id: "settings", label: "Settings", href: "/settings", icon: Settings },
      ],
    },
  ];

  const user = data.currentUser;

  return (
    <>
      {/* Backdrop for the mobile drawer. Visible only below `lg` and
          only when the drawer is open. Tapping it dismisses the
          drawer. The `aria-hidden` value flips so screen readers
          know whether the backdrop is interactive. */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-ink/40 transition-opacity lg:hidden",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden={!open}
        onClick={close}
      />

      <aside
        className={cn(
          "flex flex-col w-60 shrink-0 h-full border-r border-line bg-paper",
          // Mobile (< lg): fixed-position overlay that slides in
          // from the left when `open`. Sits above the backdrop.
          "fixed inset-y-0 left-0 z-40 transition-transform lg:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
          // lg+: persistent column, no transform.
          "lg:static lg:translate-x-0"
        )}
        // Closed on mobile = translated off-canvas but still in the
        // DOM, so `inert` pulls its links out of the tab order and
        // the a11y tree. Must not apply at lg+ where this same
        // element is the always-visible column — hence the media
        // query instead of a plain `!open`.
        inert={!open && !isDesktop}
      >
      {/* ── Firm mark + command palette trigger ─────────────────────────── */}
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2.5">
          <div
            aria-hidden
            className="flex items-center justify-center w-7 h-7 rounded-md bg-brand-700 text-white font-display text-[15px] font-semibold tracking-tight"
          >
            k
          </div>
          <span className="font-display text-[15px] font-medium text-ink">
            Kosloski Law
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={openPalette}
            className="hidden lg:inline-flex items-center h-6 px-1.5 rounded border border-line bg-white text-2xs text-ink-4 hover:text-ink hover:border-input transition-colors"
            title="Search and commands (⌘K)"
            aria-label="Search and commands"
          >
            ⌘K
          </button>
          {/* Close button — mobile drawer only. lg+ users never
              see it because the sidebar isn't a drawer there. */}
          <button
            onClick={close}
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-3 hover:text-ink hover:bg-paper-2"
            title="Close navigation"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Navigation groups ────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        {sections.map((section, si) => (
          <NavGroup
            key={si}
            section={section}
            pathname={pathname}
            searchParams={searchParams}
            onNavigate={close}
          />
        ))}
      </nav>

      {/* ── User profile strip ───────────────────────────────────────────── */}
      <div className="border-t border-line">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-2xs font-semibold bg-paper-2 text-ink-2">
              {user?.initials ?? "??"}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium text-ink truncate">
              {user?.name ?? "Not signed in"}
            </span>
            <span className="text-2xs text-ink-4">
              {user?.jobTitle || "—"}
            </span>
          </div>
          <SignOutButton />
        </div>
      </div>
      </aside>
    </>
  );
}

/** Ends the Clerk session and returns to /login. Rendered under the
 *  dashboard layout's StaffClerkProvider. Kept as a compact icon
 *  button (the shared SignOutButton is a full-width labelled Button). */
function SignOutButton() {
  const { signOut } = useClerk();
  return (
    <button
      type="button"
      title="Sign out"
      aria-label="Sign out"
      onClick={() => signOut({ redirectUrl: "/login" })}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-4 hover:text-ink hover:bg-paper-2 transition-colors"
    >
      <LogOut size={15} />
    </button>
  );
}

function NavGroup({
  section,
  pathname,
  searchParams,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  searchParams: URLSearchParams;
  onNavigate: () => void;
}) {
  const [collapsed, toggle] = useCollapsed(section.collapseKey);
  const listId = section.collapseKey ? `${section.collapseKey}-list` : undefined;
  return (
    <div className={section.label ? "mt-4" : "mt-1"}>
      {section.label &&
        (section.collapseKey ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls={listId}
            className="group flex w-full items-center gap-1 px-2.5 pb-1.5 text-2xs font-medium text-ink-4 hover:text-ink-2"
          >
            {section.label}
            <ChevronRight
              size={13}
              aria-hidden
              className={cn(
                "transition-transform",
                collapsed ? "rotate-0" : "rotate-90"
              )}
            />
          </button>
        ) : (
          <div className="px-2.5 pb-1.5 text-2xs font-medium text-ink-4">
            {section.label}
          </div>
        ))}
      {!collapsed && (
        <div id={listId} className="flex flex-col gap-px">
          {section.items.map((item) => {
            const active = isActive(item.href, pathname, searchParams);
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 h-[30px] px-2.5 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-ink font-medium"
                    : "text-ink-2 hover:bg-paper-2 hover:text-ink"
                )}
              >
                {item.dotColor && (
                  <span
                    aria-hidden
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: item.dotColor }}
                  />
                )}
                {Icon && (
                  <Icon
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden
                    className={cn(
                      "shrink-0",
                      active ? "text-ink" : "text-ink-4"
                    )}
                  />
                )}
                <span className="truncate">{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={cn(
                      "ml-auto text-2xs tabular-nums",
                      item.queue ? "font-semibold text-ink" : "text-ink-4"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
