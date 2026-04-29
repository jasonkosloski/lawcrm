/**
 * Settings Side-Nav
 *
 * Left-rail navigation for `/settings/*`. Sections are grouped so new
 * categories slot in cleanly as features add their own settings pages.
 * Client-only so it can read the active route via `usePathname`.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  description?: string;
  /** When set, the item is only rendered for users who hold this
   *  permission (admin always passes). When omitted, every signed-
   *  in firm member sees the link. The underlying page is also
   *  gated server-side via `requirePermission(...)`; hiding the
   *  nav item is just so people don't see a link that would
   *  bounce them. */
  requires?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: "Account",
    items: [
      { href: "/settings/profile", label: "Profile" },
      { href: "/settings/security", label: "Security" },
      { href: "/settings/notifications", label: "Notifications" },
    ],
  },
  {
    label: "Firm",
    items: [
      // Team + Roles + Firm info expose read-only views for everyone
      // (the underlying pages render write affordances based on
      // each user's permissions). Practice-areas / integrations /
      // billing are write-only surfaces for now.
      { href: "/settings/team", label: "Team" },
      { href: "/settings/roles", label: "Roles" },
      { href: "/settings/firm", label: "Firm info" },
      {
        href: "/settings/practice-areas",
        label: "Practice areas",
        requires: "firm.manage_practice_areas",
      },
      {
        href: "/settings/activity",
        label: "Activity log",
        requires: "firm.view_activity",
      },
      // Integrations + Billing & rates are placeholder pages today;
      // gated on edit_info as a stand-in until they get their own
      // permission keys.
      {
        href: "/settings/integrations",
        label: "Integrations",
        requires: "firm.edit_info",
      },
      {
        href: "/settings/billing",
        label: "Billing & rates",
        requires: "firm.edit_info",
      },
    ],
  },
];

export function SettingsNav({
  isAdmin,
  grantedPermissions,
}: {
  isAdmin: boolean;
  /** Flat list of permission keys the current user has. Used to
   *  hide nav items they can't act on. Admin's set is empty
   *  (admin short-circuits everything). */
  grantedPermissions: string[];
}) {
  const pathname = usePathname();
  const granted = new Set(grantedPermissions);

  // Filter items by required permission. Sections that end up with
  // no visible items get hidden too — no empty section header.
  const canSee = (item: NavItem): boolean => {
    if (!item.requires) return true;
    if (isAdmin) return true;
    return granted.has(item.requires);
  };
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(canSee),
  })).filter((section) => section.items.length > 0);

  return (
    <aside
      className={cn(
        // lg+: vertical rail, fixed 208px, right-side hairline.
        "lg:w-52 lg:shrink-0 lg:border-r lg:border-line lg:py-5 lg:pr-3",
        // <lg: full-width horizontal scroll strip below the topbar.
        // Section group headers ("Account" / "Firm") become inline
        // labels separated by a vertical hairline so the user can
        // still see the grouping. The bottom border replaces the
        // right border so the strip reads as part of the topbar.
        "border-b border-line lg:border-b-0"
      )}
    >
      {/* Mobile / tablet: horizontal scroll. */}
      <nav className="lg:hidden flex items-center gap-3 overflow-x-auto scrollbar-thin px-3 py-2">
        {visibleSections.map((section, si) => (
          <div key={section.label} className="flex items-center gap-2">
            {si > 0 && (
              <span aria-hidden className="h-3 w-px bg-line shrink-0" />
            )}
            <span className="text-2xs font-semibold uppercase tracking-wider text-ink-4 shrink-0">
              {section.label}
            </span>
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs transition-colors",
                    active
                      ? "bg-brand-500 text-white"
                      : "text-ink-2 bg-paper-2 hover:bg-[#eaf0f5] hover:text-brand-700"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Desktop: vertical rail (current). */}
      <nav className="hidden lg:flex flex-col gap-5">
        {visibleSections.map((section) => (
          <div key={section.label}>
            <div className="px-2.5 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-4">
              {section.label}
            </div>
            <ul className="flex flex-col gap-px">
              {section.items.map((item) => {
                // Highlight the section link on any nested route too —
                // e.g. /settings/practice-areas/<id> still highlights
                // "Practice areas".
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block px-2.5 py-1.5 rounded-md text-xs transition-colors",
                        active
                          ? "bg-brand-500 text-white"
                          : "text-ink-2 hover:bg-[#eaf0f5] hover:text-brand-700"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
