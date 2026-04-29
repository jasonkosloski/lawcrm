/**
 * Settings Layout
 *
 * Two-pane: left rail of section links + main content area. Every
 * settings page renders inside this so the nav stays put while the
 * right pane swaps.
 *
 * As features land, each one adds its settings under `/settings/<section>`
 * (or a sub-route within an existing section). Keep individual pages
 * scoped and cohesive so a section never sprawls into an "everything
 * else" dumping ground.
 */

import { TopBar } from "@/components/layout/topbar";
import { SettingsNav } from "@/components/settings/settings-nav";
import { getCurrentUserPermissions } from "@/lib/permission-check";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve once at the layout, threaded into the nav so each item
  // can decide its own visibility. Each underlying write also
  // re-checks server-side via `requirePermission(...)` so a deep-
  // link still bounces.
  const { isAdmin, granted } = await getCurrentUserPermissions();
  return (
    <>
      <TopBar title="Settings" crumbs="Settings" />
      <div className="flex-1 overflow-y-auto animate-page-enter">
        {/* Vertical stack below `lg` (nav strip on top, then content);
            two-pane (rail + content) at lg+. */}
        <div className="flex flex-col lg:flex-row h-full">
          <SettingsNav
            isAdmin={isAdmin}
            grantedPermissions={Array.from(granted)}
          />
          <div className="flex-1 min-w-0 p-3 sm:p-6 overflow-y-auto">{children}</div>
        </div>
      </div>
    </>
  );
}
