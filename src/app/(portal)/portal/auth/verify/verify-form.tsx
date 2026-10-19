"use client";

import { useActionState, useEffect } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import {
  verifyPortalLink,
  type PortalVerifyState,
} from "@/app/actions/portal-session";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoginForm } from "../../login/login-form";

export function VerifyForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<
    PortalVerifyState,
    FormData
  >(verifyPortalLink, { status: "idle" });

  useEffect(() => {
    // Full navigation so the request goes through the portal proxy rewrite.
    if (state.status === "ok") window.location.replace("/");
  }, [state.status]);

  if (state.status === "ok") {
    // No button while the full navigation runs, so it can't be re-submitted
    // with an already-spent token.
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-ink-3"
      >
        <Loader2 className="size-4 animate-spin text-brand-500" aria-hidden="true" />
        Signing you in…
      </p>
    );
  }

  if (state.status === "invalid") {
    return (
      <div className="flex flex-col gap-5">
        <Alert variant="destructive" className="border-danger/25 bg-danger/5 px-3 py-3">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="text-ink-2">
            This link has expired or was already used.
          </AlertDescription>
        </Alert>
        <p className="text-sm text-ink-3">
          Enter your email and we&rsquo;ll send you a new one.
        </p>
        <LoginForm submitLabel="Send a new link" />
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm leading-relaxed text-ink-3">
        Select Sign in to open your client portal.
      </p>
      <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
        Sign in
      </Button>
    </form>
  );
}
