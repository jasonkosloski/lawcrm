/**
 * Dashboard Layout
 *
 * All authenticated pages (matters, email, calendar, etc.) render inside
 * the AppShell which provides the sidebar and main content area.
 */

import { AppShell } from "@/components/layout/app-shell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
