"use client";

import { useActionState, useState } from "react";
import { MailCheck } from "lucide-react";
import { requestPortalLink, type PortalLinkState } from "@/app/actions/portal-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Email-a-link form. The "sent" copy is uniform whether or not the address
 * has portal access (no account enumeration); it may echo the address the
 * visitor typed, since that reveals nothing they don't already know.
 * "Use a different email" remounts the form for a fresh action state.
 */
export function LoginForm({ submitLabel = "Email me a link" }: { submitLabel?: string }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <LinkRequest key={attempt} submitLabel={submitLabel} onReset={() => setAttempt((n) => n + 1)} />
  );
}

function LinkRequest({ submitLabel, onReset }: { submitLabel: string; onReset: () => void }) {
  const [email, setEmail] = useState("");
  const [state, formAction, pending] = useActionState<PortalLinkState, FormData>(
    requestPortalLink,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <div role="status" className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-tint p-4">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-brand-500" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <p className="font-medium text-ink">Check your email</p>
            <p className="text-ink-2">If that email has portal access, a link is on its way.</p>
            {email ? (
              <p className="truncate text-ink-3">
                You entered <span className="font-medium text-ink-2">{email}</span>
              </p>
            ) : null}
            <p className="text-ink-3">
              The link works for 15 minutes. Check your spam folder if it doesn&rsquo;t arrive.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="self-start px-0 text-brand-600 hover:bg-transparent hover:text-brand-700 hover:underline"
          onClick={onReset}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="portal-email" className="text-ink-2">
          Email
        </Label>
        <Input
          id="portal-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10 bg-white px-3"
        />
      </div>
      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending ? "Sending…" : submitLabel}
      </Button>
    </form>
  );
}
