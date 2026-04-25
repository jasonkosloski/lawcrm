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
  /** When true, this nav item is only rendered for admins. The
   *  underlying page is also gated server-side via requireAdmin();
   *  hiding the nav item is just so non-admins don't see a link
   *  that would bounce them to /. */
  adminOnly?: boolean;
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
      { href: "/settings/team", label: "Team" },
      // Roles + practice-areas are admin-write surfaces. Roles +
      // Firm info expose a read-only view to non-admins so they can
      // still see the firm setup; practice-areas is fully admin-only.
      { href: "/settings/roles", label: "Roles" },
      { href: "/settings/firm", label: "Firm info" },
      { href: "/settings/practice-areas", label: "Practice areas", adminOnly: true },
      { href: "/settings/integrations", label: "Integrations", adminOnly: true },
      { href: "/settings/billing", label: "Billing & rates", adminOnly: true },
    ],
  },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  // Filter out admin-only items for non-admins. Sections that end up
  // with no visible items get hidden too (don't render an empty
  // section header).
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.adminOnly || isAdmin),
  })).filter((section) => section.items.length > 0);

  return (
    <aside className="w-52 shrink-0 border-r border-line py-5 pr-3">
      <nav className="flex flex-col gap-5">
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
