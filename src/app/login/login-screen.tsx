import type { ReactNode } from "react";

/**
 * The look of /login, kept apart from the page's auth plumbing.
 *
 * Two columns on wide screens: the app's name and what it is on the
 * left, the sign-in on the right, on the plain paper ground the rest
 * of the app uses. They stack on narrow screens.
 *
 * `action` is the sign-in control (the Google button under Clerk's
 * provider), passed in so this file has no auth dependency.
 */
export function LoginScreen({ action }: { action: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center bg-paper px-4 py-16 sm:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-14 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-center md:gap-20">
        <div>
          <h1 className="font-display text-6xl font-medium leading-none tracking-[-0.03em] text-ink sm:text-7xl">
            LitGox
          </h1>
          <p className="mt-5 max-w-[32ch] text-lg leading-snug text-ink-2">
            Case management for Kosloski Law Firm,&nbsp;P.C.
          </p>
        </div>

        <section aria-labelledby="sign-in-heading">
          <h2
            id="sign-in-heading"
            className="text-xl font-semibold tracking-[-0.01em] text-ink"
          >
            Sign in
          </h2>
          <p className="mt-2 mb-6 text-base leading-relaxed text-ink-2">
            Use your @kosloskilaw.com Google account.
          </p>
          {action}
          <p className="mt-6 text-sm leading-relaxed text-ink-3">
            Access is by invitation. If you&apos;re new to the firm, ask an
            administrator to add you.
          </p>
        </section>
      </div>
    </main>
  );
}
