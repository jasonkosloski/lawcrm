/**
 * App Shell
 *
 * The global layout wrapper: 240px sidebar + main content area.
 * Every authenticated page renders inside this shell.
 *
 * Layout (lg+ / desktop):
 * ┌──────────────────────────────────────────────────────────────┐
 * │  ┌──────────┐  ┌───────────────────────────────────────────┐ │
 * │  │ sidebar  │  │ topbar + page content                     │ │
 * │  │ 240px    │  │ (flex:1, min-height:0, overflow:auto)     │ │
 * │  └──────────┘  └───────────────────────────────────────────┘ │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Layout (< lg / tablet / mobile):
 *   - Sidebar hidden by default; appears as an overlay drawer
 *     when the topbar's hamburger is tapped (see
 *     MobileNavProvider).
 *   - Main fills the viewport.
 *
 * Server component: fetches sidebar data once per page render and
 * passes it down to the (client) SidebarNav.
 */

import { SidebarNav } from "./sidebar-nav";
import { getSidebarData } from "@/lib/queries/sidebar";
import { CommandPaletteProvider } from "@/components/command-palette/command-palette-provider";
import { MobileNavProvider } from "./mobile-nav-provider";

interface AppShellProps {
  children: React.ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const sidebarData = await getSidebarData();

  return (
    <CommandPaletteProvider>
      <MobileNavProvider>
        <div className="flex h-full w-full overflow-hidden bg-paper">
          <SidebarNav data={sidebarData} />
          <main className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
            {children}
          </main>
        </div>
      </MobileNavProvider>
    </CommandPaletteProvider>
  );
}
