/**
 * /login — staff sign-in with Google, through Clerk.
 *
 * Server component reads the `?next=` param so the sign-in button can
 * send the user back to wherever they were trying to go before the
 * proxy redirected them here. `?next=` is sanitized to a same-origin
 * relative path before use — both the GET redirect below and the
 * button prop — so a crafted `/login?next=https://evil.example` link
 * can't bounce a signed-in user off-site.
 *
 * A firm member skips the page; a signed-in Clerk user who isn't a
 * firm member goes to /no-access (not back here: that would loop).
 */

import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { StaffClerkProvider } from "@/components/auth/staff-clerk-provider";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getStaffAuth } from "@/lib/staff-auth";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeRedirectPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);

  const staff = await getStaffAuth();
  if (staff.status === "ok") redirect(next);
  if (staff.status === "no_access") redirect("/no-access");

  return (
    <div className="min-h-dvh flex items-center justify-center bg-paper-2 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-lg font-semibold text-ink">
            Kosloski Law CRM
          </h1>
          <p className="text-2xs font-mono uppercase tracking-wider text-ink-4 mt-1">
            Sign in to continue
          </p>
        </div>
        <StaffClerkProvider>
          <GoogleSignInButton next={next} />
        </StaffClerkProvider>
      </div>
    </div>
  );
}
