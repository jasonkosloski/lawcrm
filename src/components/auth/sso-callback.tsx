"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HandleSSOCallback } from "@clerk/nextjs";
import { safeRedirectPath } from "@/lib/safe-redirect";

/** How long the callback may run before we stop waiting on it. */
export const SSO_CALLBACK_TIMEOUT_MS = 15_000;

function Failed() {
  return (
    <div
      role="alert"
      className="min-h-dvh flex flex-col items-center justify-center gap-2 bg-paper-2 px-4 text-center"
    >
      <p className="text-sm text-ink">Sign-in didn&apos;t complete.</p>
      <Link href="/login" className="text-sm text-ink-3 underline">
        Back to sign in
      </Link>
    </div>
  );
}

/** Catches a throw from the Clerk callback component. */
class CallbackBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Failed /> : this.props.children;
  }
}

/**
 * Finishes the Google OAuth round trip: Clerk activates the session,
 * then we send the user to `next` (re-sanitised here; it arrived via a
 * query string). A sign-in that needs more steps, or a Google account
 * Clerk would have to sign UP, goes back to /login: staff are
 * invited, never self-registered, and a signed-in non-member lands on
 * /no-access via the pages' own guards. If the callback throws, or has
 * not navigated after SSO_CALLBACK_TIMEOUT_MS, the user sees a failure
 * message with a way back to /login instead of an endless spinner.
 */
export function SsoCallback({ next }: { next: string }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const destination = safeRedirectPath(next);

  useEffect(() => {
    // Unmounting (a successful navigation) clears the timer.
    const t = setTimeout(() => setTimedOut(true), SSO_CALLBACK_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  const go = (url: string) => {
    // decorateUrl may return an absolute URL (Safari ITP cookie refresh).
    if (url.startsWith("http")) window.location.href = url;
    else router.push(url);
  };
  if (timedOut) return <Failed />;
  return (
    <CallbackBoundary>
      <HandleSSOCallback
        navigateToApp={({ decorateUrl }) => go(decorateUrl(destination))}
        navigateToSignIn={() => router.push("/login")}
        navigateToSignUp={() => router.push("/login")}
      />
    </CallbackBoundary>
  );
}
