"use client";

import { useActionState } from "react";
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
