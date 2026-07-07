/**
 * Dashboard Layout
 *
 * Authoritative auth gate for everything under (dashboard) — every
 * page in this group renders inside the AppShell with the sidebar.
 * The layout itself calls `auth()` and bounces to /login when the
 * session is missing or stale (JWT signed for a user that no longer
 * exists / is deactivated — caught by the `jwt` callback in
 * src/auth.ts setting `session.user.id` to undefined).
 *
 * The proxy (src/proxy.ts) is intentionally OPTIMISTIC — it only
 * checks cookie presence so it stays fast and runs Edge-style. This
 * layer is where we actually verify the session is good. Pair both
 * for defense in depth.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { AppShell } from "@/components/layout/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
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
  return <AppShell>{children}</AppShell>;
}
