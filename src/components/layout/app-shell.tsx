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
 */

import { SidebarNav } from "./sidebar-nav";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-paper">
      <SidebarNav />
      <main className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
