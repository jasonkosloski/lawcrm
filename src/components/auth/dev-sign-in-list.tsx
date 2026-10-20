"use client";

import { useState } from "react";
import { useSignIn } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { devSignInAs } from "@/app/actions/dev-sign-in";

type DevUser = { id: string; name: string; email: string; jobTitle: string };

/** DEV ONLY (rendered by /dev/sign-in-as, which 404s outside dev).
 *  Gets a sign-in ticket from the server action, completes it with
 *  Clerk's `ticket` strategy, then goes to `/`. */
export function DevSignInList({ users }: { users: DevUser[] }) {
  const { signIn } = useSignIn();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(id: string) {
    setError(null);
    setPending(id);
    try {
      const res = await devSignInAs(id);
      if (!res.ok) throw new Error(res.error);
      const t = await signIn.ticket({ ticket: res.ticket });
      if (t.error) throw new Error(t.error.message);
      const f = await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/");
          if (url.startsWith("http")) window.location.href = url;
          else window.location.assign(url);
        },
      });
      if (f.error) throw new Error(f.error.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {users.map((u) => (
        <div key={u.id} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-ink truncate">{u.name}</div>
            <div className="text-2xs text-ink-4 truncate">
              {u.jobTitle} · {u.email}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending !== null}
            onClick={() => go(u.id)}
          >
            {pending === u.id ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-2xs text-warn">
          {error}
        </p>
      )}
    </div>
  );
}
