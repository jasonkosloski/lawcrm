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

  // Laid out like a pleading's case caption: the firm on the left, a
  // column of ")" marks, the action on the right. On narrow screens the
  // bracket column folds away and a rule separates the two halves.
  return (
    <main className="min-h-dvh bg-paper px-4 py-12 sm:px-8 flex items-center justify-center">
      <div className="w-full max-w-4xl grid gap-10 sm:grid-cols-[1fr_auto_minmax(0,22rem)] sm:gap-12 items-center">
        <div>
          <h1 className="font-display text-6xl sm:text-7xl font-medium leading-[0.98] tracking-[-0.02em] text-ink">
            Kosloski
            <br />
            Law
          </h1>
          <p className="mt-5 text-sm text-ink-3">Case management for the firm</p>
        </div>

        <CaptionBrackets />

        <section
          aria-labelledby="sign-in-heading"
          className="border-t border-line pt-8 sm:border-t-0 sm:pt-0"
        >
          <h2 id="sign-in-heading" className="text-base font-semibold text-ink">
            Sign in
          </h2>
          <p className="mt-1.5 mb-6 text-sm leading-relaxed text-ink-3">
            Use your @kosloskilaw.com Google account.
          </p>
          <StaffClerkProvider>
            <GoogleSignInButton next={next} />
          </StaffClerkProvider>
          <p className="mt-6 text-xs leading-relaxed text-ink-4">
            Access is by invitation. If you&apos;re new to the firm, ask an
            administrator to add you.
          </p>
        </section>
      </div>
    </main>
  );
}

/** The ")" column of a case caption, desktop only. Decorative. */
function CaptionBrackets() {
  return (
    <div
      aria-hidden="true"
      className="hidden sm:flex flex-col self-stretch justify-center font-display text-2xl leading-[1.75] text-ink-4/70 select-none"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i}>)</span>
      ))}
    </div>
  );
}
