import type { ReactNode } from "react";
import { ReceivedStamp } from "./received-stamp";

/**
 * The look of /login, kept apart from the page's auth plumbing.
 *
 * The screen is the first page of a filing laid over the columns of
 * Denver's federal courthouse: the clerk's RECEIVED stamp top-right
 * (below the sign-in on narrow screens, so it never reads as a label
 * over the name), then a case caption with the firm on the
 * left, a column of ")" marks, and the sign-in on the right. The
 * sheet rises from the bottom edge and runs off it, like a page half
 * out of a folder. Below the lg breakpoint the ")" column folds away and the
 * caption stacks.
 *
 * `action` is the sign-in control (the Google button under Clerk's
 * provider), passed in so this file has no auth dependency.
 */
export function LoginScreen({ action }: { action: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-brand-900">
      {/* Grayscale photo over flat navy: reads as a navy duotone. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[url(/login/courthouse-columns.jpg)] bg-cover bg-center opacity-35 animate-in fade-in zoom-in-[108%] fill-mode-both duration-[2400ms] ease-out motion-reduce:animate-none"
      />

      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-4 pt-14 sm:px-8 sm:pt-[12vh]">
        <article className="flex flex-1 flex-col bg-paper px-6 pt-8 pb-8 sm:px-16 sm:pt-14 sm:pb-12 animate-in fade-in slide-in-from-bottom-12 fill-mode-both duration-700 ease-out motion-reduce:animate-none">
          <header className="order-2 mt-12 flex justify-end lg:order-none lg:mt-0">
            <ReceivedStamp />
          </header>

          <div className="order-1 grid flex-1 content-center gap-12 lg:order-none lg:mt-10 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,23rem)] lg:items-center lg:gap-14">
            <div>
              <h1 className="font-display text-[clamp(3.5rem,11vw,8.5rem)] font-medium leading-[0.92] tracking-[-0.035em] text-ink animate-in fade-in slide-in-from-bottom-6 fill-mode-both delay-200 duration-700 ease-out motion-reduce:animate-none">
                {"Kosloski "}
                <br />
                Law
              </h1>
              <p className="mt-7 max-w-[34ch] text-lg leading-snug text-ink animate-in fade-in slide-in-from-bottom-4 fill-mode-both delay-300 duration-500 motion-reduce:animate-none">
                The firm&apos;s case-management system: matters, deadlines,
                documents and billing.
              </p>
            </div>

            <CaptionBrackets />

            <section
              aria-labelledby="sign-in-heading"
              className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both delay-500 duration-500 motion-reduce:animate-none"
            >
              <h2
                id="sign-in-heading"
                className="font-display text-[1.75rem] font-medium leading-tight tracking-[-0.01em] text-ink"
              >
                Notice of appearance
              </h2>
              <p className="mt-3 mb-7 text-base leading-relaxed text-ink-2">
                Sign in with your @kosloskilaw.com Google account.
              </p>
              {action}
              <p className="mt-6 text-base leading-relaxed text-ink-2">
                Access is by invitation. If you&apos;re new to the firm, ask
                an administrator to add you.
              </p>
            </section>
          </div>

          <p className="order-3 mt-14 text-sm text-ink-3 animate-in fade-in fill-mode-both delay-1000 duration-500 motion-reduce:animate-none lg:order-none">
            Courthouse columns, Denver: Carol M. Highsmith, Library of
            Congress.
          </p>
        </article>
      </div>
    </main>
  );
}

/** The ")" column of a case caption, wide screens only. Decorative. */
function CaptionBrackets() {
  return (
    <div
      aria-hidden="true"
      className="hidden select-none flex-col self-stretch justify-center font-display text-2xl leading-[1.75] text-ink-4 lg:flex"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          style={{ animationDelay: `${250 + i * 40}ms` }}
          className="animate-in fade-in fill-mode-both duration-300 motion-reduce:animate-none"
        >
          )
        </span>
      ))}
    </div>
  );
}
