"use client";

import { useActionState, useEffect } from "react";
import {
  verifyPortalLink,
  type PortalVerifyState,
} from "@/app/actions/portal-session";
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
      <p role="status" className="text-sm text-ink-3">
        Signing you in…
      </p>
    );
  }

  if (state.status === "invalid") {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-ink-2">
          This link has expired or was already used.
        </p>
        <LoginForm submitLabel="Send a new link" />
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-ink-3">Continue to your client portal.</p>
      <Button type="submit" disabled={pending}>
        Sign in
      </Button>
    </form>
  );
}
