"use client";

import { useSyncExternalStore } from "react";

/** Tailwind `lg` breakpoint — must stay in sync with the `lg:`
 *  classes that switch the sidebar and mailbox drawers into
 *  persistent columns. */
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeToDesktop(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/** Whether the viewport is at `lg+`, where the sidebar and mailbox
 *  drawers are persistent columns. Needed because `inert` on a closed
 *  drawer is correct only on mobile — at `lg+` the same element is
 *  visible and must stay interactive, and there's no CSS-only way to
 *  scope an attribute to a breakpoint. Server snapshot assumes desktop
 *  so SSR never ships an inert (unclickable) column; on mobile the
 *  drawer starts closed and gains `inert` at hydration. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true
  );
}
