"use client";

import { useActionState } from "react";
import {
  verifyPortalLink,
  type PortalVerifyState,
} from "@/app/actions/portal-session";
import { Button } from "@/components/ui/button";

export function VerifyForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<
    PortalVerifyState,
    FormData
  >(verifyPortalLink, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state.status === "invalid" ? (
        <p role="alert" className="text-sm text-ink-2">
          This link has expired or was already used.
        </p>
      ) : (
        <p className="text-sm text-ink-3">Continue to your client portal.</p>
      )}
      <Button type="submit" disabled={pending || state.status === "invalid"}>
        Sign in
      </Button>
    </form>
  );
}
