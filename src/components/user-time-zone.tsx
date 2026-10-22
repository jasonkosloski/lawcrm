/**
 * The signed-in user's profile time zone, for client components.
 *
 * Instants (event times, timestamps) display in the user's PROFILE zone
 * on the server (`getCurrentUserTimeZone()`). Client components must use
 * the same zone — not the browser's — or a server-rendered time and its
 * hydrated twin disagree, and a datetime-local field prefilled in one
 * zone and parsed in another drifts on every save. The dashboard layout
 * provides the zone; `useUserTimeZone()` reads it.
 *
 * Date-only values never need this: format them with `formatDateOnly`
 * (ADR-012).
 */

"use client";

import { createContext, useContext } from "react";

const UserTimeZoneContext = createContext<string | null>(null);

export function UserTimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: React.ReactNode;
}) {
  return <UserTimeZoneContext.Provider value={timeZone}>{children}</UserTimeZoneContext.Provider>;
}

/**
 * The user's profile zone. Outside the dashboard (component tests,
 * public pages) it falls back to the runtime's zone.
 */
export function useUserTimeZone(): string {
  return useContext(UserTimeZoneContext) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
