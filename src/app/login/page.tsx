/**
 * /login — email + password sign-in.
 *
 * Server component reads the `?next=` param so the client form can
 * post the user back to wherever they were trying to go before the
 * proxy redirected them here. Already-authenticated users land on
 * `/` (or `?next=`) without seeing the form. `?next=` is sanitized
 * to a same-origin relative path before use — both the GET redirect
 * below and the form's hidden field — so a crafted
 * `/login?next=https://evil.example` link can't bounce a signed-in
 * user off-site.
 *
 * No "forgot password" link yet — password reset is a Phase 2 task.
 * Keep the empty space below the form so adding it later doesn't
 * shift the layout.
 */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/login-form";
import { safeRedirectPath } from "@/lib/safe-redirect";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeRedirectPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);

  // Already signed in with a VALID session? Skip the form.
  // `session?.user?.id` is undefined when the JWT references a
  // user that no longer exists or is deactivated (the jwt callback
  // in src/auth.ts wipes userId in those cases) — we render the
  // login form so they can re-auth, and submitting the form mints
  // a fresh JWT that overwrites the stale cookie.
  const session = await auth();
  if (session?.user?.id) {
    redirect(next);
  }

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
        <LoginForm next={next} />
      </div>
    </div>
  );
}
