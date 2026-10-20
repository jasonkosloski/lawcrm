/**
 * Dashboard Layout
 *
 * UX gate / redirect convenience for everything under (dashboard) —
 * every page in this group renders inside the AppShell with the
 * sidebar. The layout resolves the staff identity and bounces to
 * /login (with ?next=) when signed out, or to /no-access when the
 * Clerk user is not an active firm member.
 *
 * It is NOT the authorization boundary: Next does not re-run a
 * layout on partial (RSC) navigations, so every page.tsx and every
 * server action authenticates itself (`requireUser()` /
 * `requirePermission()`, enforced by src/app/page-guards.test.ts).
 * The proxy (src/proxy.ts) is only an optimistic check. All
 * three layers are needed.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getStaffAuth } from "@/lib/staff-auth";
import { getCurrentFirm } from "@/lib/firm";
import { StaffClerkProvider } from "@/components/auth/staff-clerk-provider";
import { AppShell } from "@/components/layout/app-shell";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";

/**
 * Tab titles read "<page> · <firm>" using the signed-in user's firm
 * (its short name when set, else its legal name). Signed out, this
 * adds nothing and the root layout's "LitGox" template applies; the
 * layout body redirects anyway.
 */
export async function generateMetadata(): Promise<Metadata> {
  const staff = await getStaffAuth();
  if (staff.status !== "ok") return {};
  const firm = await getCurrentFirm();
  const name = firm.shortName?.trim() || firm.name;
  return { title: { default: name, template: `%s · ${name}` } };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Request-cached: the sidebar and timer queries reuse this read.
  const staff = await getStaffAuth();
  if (staff.status === "no_access") redirect("/no-access");
  if (staff.status !== "ok") {
    // No Clerk session. Build the ?next= so they land back here after
    // re-login.
    //
    // Next.js gives a layout no built-in way to learn the request
    // path, so we rely on `x-pathname` (pathname + search) injected
    // by src/proxy.ts via NextResponse.next({ request: { headers } }).
    // (`x-invoke-path` was a Next internal that no longer surfaces —
    // don't reach for it.) If the header is absent we fall back to a
    // bare /login rather than guessing. The value is user-adjacent
    // (a header), but /login sanitizes ?next= before redirecting, so
    // a spoofed value can't turn into an open redirect.
    const h = await headers();
    const nextPath = h.get("x-pathname") ?? "";
    const loginUrl =
      nextPath && nextPath !== "/"
        ? `/login?next=${encodeURIComponent(nextPath)}`
        : "/login";
    redirect(loginUrl);
  }
  // Client components format instants and fill datetime-local inputs in
  // the user's profile zone via useUserTimeZone() (ADR-012).
  const timeZone = await getCurrentUserTimeZone();
  return (
    <StaffClerkProvider>
      <UserTimeZoneProvider timeZone={timeZone}>
        <AppShell>{children}</AppShell>
      </UserTimeZoneProvider>
    </StaffClerkProvider>
  );
}
