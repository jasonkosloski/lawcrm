/**
 * Static navigation destinations for the command palette.
 *
 * Each entry maps to a top-level route or a common sub-route users
 * want to jump to directly. Keywords are the extra terms users might
 * search by ("cases" → Matters, "inbox" → Email) beyond the label.
 *
 * Icon is a lucide component name string resolved in the UI layer —
 * keeps this file free of component imports so it stays a pure data
 * module.
 */

export type NavDestination = {
  id: string;
  label: string;
  keywords: string;
  href: string;
  icon: string;
};

export const NAV_DESTINATIONS: NavDestination[] = [
  { id: "nav:today", label: "Today", keywords: "home dashboard start", href: "/", icon: "home" },
  { id: "nav:matters", label: "All matters", keywords: "cases list table", href: "/matters", icon: "gavel" },
  { id: "nav:matters-pinned", label: "Matters — pinned only", keywords: "cases favorites", href: "/matters?pinned=1", icon: "pin" },
  { id: "nav:intake", label: "Intake queue", keywords: "leads new prospects", href: "/intake", icon: "inbox" },
  { id: "nav:email", label: "Email", keywords: "inbox mail messages", href: "/email", icon: "mail" },
  { id: "nav:calendar", label: "Calendar", keywords: "schedule events meetings", href: "/calendar", icon: "calendar" },
  { id: "nav:time", label: "Time tracking", keywords: "hours billing timer", href: "/time", icon: "clock" },
  { id: "nav:billing", label: "Billing", keywords: "invoices payments ar", href: "/billing", icon: "dollar" },
  { id: "nav:reports", label: "Reports", keywords: "analytics dashboards", href: "/reports", icon: "chart" },
  { id: "nav:automations", label: "Automations", keywords: "triggers templates", href: "/automations", icon: "zap" },
  { id: "nav:settings", label: "Settings", keywords: "preferences account", href: "/settings", icon: "settings" },
  { id: "nav:settings-profile", label: "Settings — Profile", keywords: "me user account", href: "/settings/profile", icon: "settings" },
  { id: "nav:settings-integrations", label: "Settings — Integrations", keywords: "gmail calendar oauth connections", href: "/settings/integrations", icon: "settings" },
  { id: "nav:settings-team", label: "Settings — Team", keywords: "users roles staff members", href: "/settings/team", icon: "settings" },
];

/** Maps string icon names used in NAV_DESTINATIONS + palette item kinds
 *  to lucide components. Lives here so the registry stays a pure data
 *  module, but consumers can still render icons. */
export const ICON_NAMES = [
  "home",
  "gavel",
  "pin",
  "inbox",
  "mail",
  "calendar",
  "clock",
  "dollar",
  "chart",
  "zap",
  "settings",
  "user",
  "userSquare",
  "briefcase",
  "leaf",
] as const;
export type IconName = (typeof ICON_NAMES)[number];
