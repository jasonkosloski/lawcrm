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

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TopBar title="Settings" crumbs="Settings" />
      <div className="flex-1 overflow-y-auto animate-page-enter">
        <div className="flex h-full">
          <SettingsNav />
          <div className="flex-1 min-w-0 p-6 overflow-y-auto">{children}</div>
        </div>
      </div>
    </>
  );
}
