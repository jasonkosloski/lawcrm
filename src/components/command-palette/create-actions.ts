/**
 * Create-new actions for the command palette (palette v2).
 *
 * Pure navigation only — each row jumps to an existing create page
 * and that page enforces its own permission gate server-side
 * (PaletteData carries no permission flags, so the palette does not
 * pre-filter; a user without access hits the page's own guard).
 *
 * Deliberately NOT included (need more than navigation):
 * - "Log a call" — opens CallLogDialog, which requires contact-picker
 *   data the palette doesn't preload and has no URL affordance to
 *   auto-open on /communication. Navigating without opening the
 *   dialog would be a lie.
 * - "Start timer" — startTimer() upserts the user's single
 *   TimerSession, silently replacing (= discarding) a running clock.
 *   The TimerWidget guards discard behind a two-step confirm; the
 *   palette can't replicate that without knowing whether a timer is
 *   running, and PaletteData doesn't carry it. Revisit if palette
 *   data ever includes the active session.
 *
 * Shape matches NavDestination so these rows reuse the palette's
 * nav-row rendering AND resolve from localStorage recents through
 * the same lookup path. Note: `nav:contacts-new` already exists in
 * NAV_DESTINATIONS; the palette renders it HERE (as create:contact
 * would duplicate it) by filtering it out of the Navigation group —
 * see command-palette.tsx.
 */

import type { NavDestination } from "@/lib/command-palette/destinations";

export const CREATE_ACTIONS: NavDestination[] = [
  {
    id: "create:matter",
    label: "New matter",
    keywords: "create add open case matter",
    href: "/matters/new",
    icon: "filePlus",
  },
  {
    id: "create:event",
    label: "New event",
    keywords: "create add calendar appointment meeting schedule",
    href: "/calendar/events/new",
    icon: "calendarPlus",
  },
  {
    id: "create:lead",
    label: "New intake / lead",
    keywords: "create add lead prospect intake",
    href: "/intake/new",
    icon: "inboxPlus",
  },
];

/** The one pre-existing create destination — rendered in the Create
 *  group instead of Navigation so all create-new rows sit together. */
export const CREATE_NAV_IDS = new Set(["nav:contacts-new"]);
