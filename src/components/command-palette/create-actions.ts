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
 * - "Start timer" — startTimer() refuses to replace a running clock
 *   unless called with `replace: true`; no UI affordance for that
 *   confirmation ("Replace running timer?") exists yet, and the
 *   palette doesn't know whether a timer is running (PaletteData
 *   doesn't carry it). Revisit once the confirm UI exists.
 * - "New intake / lead" — /intake/new is still a placeholder page
 *   with no form, so offering it would be a dead end. Re-add once
 *   the intake form ships.
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
];

/** The one pre-existing create destination — rendered in the Create
 *  group instead of Navigation so all create-new rows sit together. */
export const CREATE_NAV_IDS = new Set(["nav:contacts-new"]);
