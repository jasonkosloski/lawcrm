"use client";

import { useRouter } from "next/navigation";
import { HandleSSOCallback } from "@clerk/nextjs";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Finishes the Google OAuth round trip: Clerk activates the session,
 * then we send the user to `next` (re-sanitised here; it arrived via a
 * query string). A sign-in that needs more steps, or a Google account
 * Clerk would have to sign UP, goes back to /login: staff are
 * invited, never self-registered, and a signed-in non-member lands on
 * /no-access via the pages' own guards.
 */
export function SsoCallback({ next }: { next: string }) {
  const router = useRouter();
  const destination = safeRedirectPath(next);
  const go = (url: string) => {
    // decorateUrl may return an absolute URL (Safari ITP cookie refresh).
    if (url.startsWith("http")) window.location.href = url;
    else router.push(url);
  };
  return (
    <HandleSSOCallback
      navigateToApp={({ decorateUrl }) => go(decorateUrl(destination))}
      navigateToSignIn={() => router.push("/login")}
      navigateToSignUp={() => router.push("/login")}
    />
  );
}
