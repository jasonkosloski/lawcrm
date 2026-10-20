import type { ReactNode } from "react";

/**
 * The look of /login, kept apart from the page's auth plumbing.
 *
 * A split screen: a brand-navy panel carrying the LitGox wordmark and
 * what the app is, and the sign-in on the app's paper ground beside
 * it. On narrow screens the navy panel becomes a band above the
 * sign-in.
 *
 * `action` is the sign-in control (the Google button under Clerk's
 * provider), passed in so this file has no auth dependency.
 */
export function LoginScreen({ action }: { action: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-paper lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="flex flex-col justify-end bg-brand-900 px-6 pt-20 pb-10 sm:px-12 lg:px-16 lg:pb-16">
        <h1 className="font-display text-6xl font-medium leading-none tracking-[-0.03em] text-paper sm:text-7xl lg:text-[8.5rem]">
          LitGox
        </h1>
        <p className="mt-6 max-w-[36ch] text-lg leading-snug text-brand-200">
          Case management for the firm: matters, deadlines, documents
          and billing in one place.
        </p>
      </div>

      <div className="flex flex-1 px-6 pt-12 pb-16 sm:px-12 lg:items-center lg:px-16 lg:py-14">
        <section aria-labelledby="sign-in-heading" className="w-full max-w-sm">
          <h2
            id="sign-in-heading"
            className="font-display text-3xl font-medium tracking-[-0.01em] text-ink"
          >
            Sign in
          </h2>
          <p className="mt-3 mb-7 text-base leading-relaxed text-ink-2">
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
