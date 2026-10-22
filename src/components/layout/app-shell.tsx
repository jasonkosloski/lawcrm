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
 * Server component: fetches sidebar data once per layout render and
 * passes it down to the (client) SidebarNav. The topbar is NOT part
 * of the shell — each page renders its own TopBar — but the topbar's
 * notification bell reads the shell-level NotificationBellProvider.
 */

import { SidebarNav } from "./sidebar-nav";
import { TimerWidget } from "./timer-widget";
import { getSidebarData } from "@/lib/queries/sidebar";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getCurrentTimerSession, getTimerMatterOptions } from "@/lib/queries/timer";
import { CommandPaletteProvider } from "@/components/command-palette/command-palette-provider";
import { MobileNavProvider } from "./mobile-nav-provider";
import { NotificationBellProvider } from "./notification-bell-provider";

interface AppShellProps {
  children: React.ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const [sidebarData, timerSession, canViewAutomations, canLogTime] = await Promise.all([
    getSidebarData(),
    getCurrentTimerSession(),
    // Flags only (UX): the Automations page and stopTimer re-check
    // server-side. The permission resolver is cached per request.
    currentUserHasPermission("automations.view"),
    currentUserHasPermission("time_entries.create"),
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
        {/* Bell state lives here (not in each page's TopBar) so it
            survives navigation instead of remounting + refetching. */}
        <NotificationBellProvider>
          <div className="flex h-full w-full overflow-hidden bg-paper">
            <SidebarNav data={sidebarData} canViewAutomations={canViewAutomations} />
            <main className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">{children}</main>
            {/* Floating bottom-right timer — on every authenticated page. */}
            <TimerWidget
              session={timerSession}
              matterOptions={timerMatterOptions}
              canLogTime={canLogTime}
            />
          </div>
        </NotificationBellProvider>
      </MobileNavProvider>
    </CommandPaletteProvider>
  );
}
