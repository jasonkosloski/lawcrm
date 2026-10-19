"use client";

import { useActionState } from "react";
import {
  requestPortalLink,
  type PortalLinkState,
} from "@/app/actions/portal-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<PortalLinkState, FormData>(
    requestPortalLink,
    { status: "idle" }
  );

  if (state.status === "sent") {
    return (
      <p role="status" className="text-sm text-ink-2">
        If that email has portal access, a link is on its way.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="portal-email"
          className="text-2xs font-mono uppercase tracking-wider text-ink-4"
        >
          Email
        </label>
        <Input
          id="portal-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
        />
      </div>
      <Button type="submit" disabled={pending}>
        Email me a link
      </Button>
    </form>
  );
}
