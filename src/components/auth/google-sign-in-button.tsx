"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useSignIn } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Starts the Google OAuth flow through Clerk. The visitor returns to
 * /sso-callback (which finishes the session) and then to `next`, which
 * the /login page has already sanitised to a same-origin path. Must
 * render under a ClerkProvider (StaffClerkProvider).
 */
export function GoogleSignInButton({ next }: { next: string }) {
  const { signIn } = useSignIn();
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  async function start() {
    setFailed(false);
    setPending(true);
    try {
      const { error } = await signIn.sso({
        strategy: "oauth_google",
        // `next` rides on the callback URL so the callback page can
        // send the user on (it re-sanitises before navigating).
        redirectCallbackUrl: `/sso-callback?next=${encodeURIComponent(next)}`,
        redirectUrl: next,
      });
      if (error) {
        setFailed(true);
        setPending(false);
      }
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <Card className="p-5 flex flex-col gap-3">
      <Button type="button" onClick={start} disabled={pending}>
        {pending ? "Redirecting to Google…" : "Continue with Google"}
      </Button>
      {failed && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn"
        >
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>Sign-in is temporarily unavailable. Please try again.</span>
        </div>
      )}
    </Card>
  );
}
