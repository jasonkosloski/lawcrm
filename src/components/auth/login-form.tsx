/**
 * Login Form
 *
 * Client form bound to the loginAction server action via
 * useActionState. Renders a single generic error string on any
 * failure (no email enumeration). The hidden `next` input
 * round-trips the post-login redirect destination.
 */

"use client";

import { useActionState } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { loginAction } from "@/app/actions/auth";
import { loginInitialState, type LoginFormState } from "@/lib/auth-form";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState<
    LoginFormState,
    FormData
  >(loginAction, loginInitialState);

  return (
    <Card className="p-5">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            className={cn(
              "h-9 px-3 rounded-md border bg-white text-sm text-ink",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4",
              state.status === "error" ? "border-warn" : "border-line"
            )}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={cn(
              "h-9 px-3 rounded-md border bg-white text-sm text-ink",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4",
              state.status === "error" ? "border-warn" : "border-line"
            )}
          />
        </div>

        {state.status === "error" && state.error && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn"
          >
            <TriangleAlert size={12} className="shrink-0 mt-px" />
            <span>{state.error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "h-9 px-4 rounded-md text-sm font-medium bg-brand-500 text-white mt-2",
            "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Card>
  );
}
