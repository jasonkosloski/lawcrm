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
import { TimerWidget } from "./timer-widget";
import { getSidebarData } from "@/lib/queries/sidebar";
import {
  getCurrentTimerSession,
  getTimerMatterOptions,
} from "@/lib/queries/timer";
import { CommandPaletteProvider } from "@/components/command-palette/command-palette-provider";
import { MobileNavProvider } from "./mobile-nav-provider";

interface AppShellProps {
  children: React.ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const [sidebarData, timerSession] = await Promise.all([
    getSidebarData(),
    getCurrentTimerSession(),
  ]);
  // The matter list only feeds the running timer's re-point panel +
  // stop composer, so the idle state (the overwhelming majority of
  // page renders) skips the query entirely. Right after an
  // optimistic start the list is briefly empty until the layout
  // revalidation lands — acceptable: the matter is only REQUIRED at
  // stop time.
  const timerMatterOptions = timerSession ? await getTimerMatterOptions() : [];

  return (
    <CommandPaletteProvider>
      <MobileNavProvider>
        <div className="flex h-full w-full overflow-hidden bg-paper">
          <SidebarNav data={sidebarData} />
          <main className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
            {children}
          </main>
          {/* Floating bottom-right timer — on every authenticated page. */}
          <TimerWidget
            session={timerSession}
            matterOptions={timerMatterOptions}
          />
        </div>
      </MobileNavProvider>
    </CommandPaletteProvider>
  );
}
