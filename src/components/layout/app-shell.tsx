/**
 * App Shell
 *
 * The global layout wrapper: 240px sidebar + main content area.
 * Every authenticated page renders inside this shell.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────────┐
 * │  ┌──────────┐  ┌───────────────────────────────────────────┐ │
 * │  │ sidebar  │  │ topbar + page content                     │ │
 * │  │ 240px    │  │ (flex:1, min-height:0, overflow:auto)     │ │
 * │  │          │  │                                           │ │
 * │  └──────────┘  └───────────────────────────────────────────┘ │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Server component: fetches sidebar data once per page render and
 * passes it down to the (client) SidebarNav.
 */

import { SidebarNav } from "./sidebar-nav";
import { getSidebarData } from "@/lib/queries/sidebar";

interface AppShellProps {
  children: React.ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const sidebarData = await getSidebarData();

  return (
    <div className="flex h-full w-full overflow-hidden bg-paper">
      <SidebarNav data={sidebarData} />
      <main className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
