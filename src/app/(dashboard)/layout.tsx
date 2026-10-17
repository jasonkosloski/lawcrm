/**
 * Dashboard Layout
 *
 * UX gate / redirect convenience for everything under (dashboard) —
 * every page in this group renders inside the AppShell with the
 * sidebar. The layout reads the session and bounces to /login (with
 * ?next=) when it is missing or stale (JWT signed for a user that no
 * longer exists / is deactivated — the `jwt` callback in src/auth.ts
 * sets `session.user.id` to undefined).
 *
 * It is NOT the authorization boundary: Next does not re-run a
 * layout on partial (RSC) navigations, so every page.tsx and every
 * server action authenticates itself (`requireUser()` /
 * `requirePermission()`, enforced by src/app/page-guards.test.ts).
 * The proxy (src/proxy.ts) is only an optimistic cookie-presence
 * check. All three layers are needed.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { AppShell } from "@/components/layout/app-shell";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Request-cached: the sidebar and timer queries reuse this read.
  const session = await getSession();
  if (!session?.user?.id) {
    // Stale JWT, no session, or deactivated user. The jwt callback
    // in src/auth.ts wipes `userId` from the token in those cases.
    // Build the ?next= so they land back here after re-login.
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
    <UserTimeZoneProvider timeZone={timeZone}>
      <AppShell>{children}</AppShell>
    </UserTimeZoneProvider>
  );
}
