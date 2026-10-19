"use client";

import { useActionState, useEffect } from "react";
import {
  devPortalSignIn,
  type PortalVerifyState,
} from "@/app/actions/portal-session";
import { Button } from "@/components/ui/button";

export type DevPortalUser = {
  identityId: string;
  name: string;
  email: string;
  matterCount: number;
};

/**
 * Dev-only "Sign in as…" list. The login page renders it only on
 * `portal.localhost` outside production, and the action re-checks that.
 */
export function DevSignIn({ users }: { users: DevPortalUser[] }) {
  const [state, formAction, pending] = useActionState<
    PortalVerifyState,
    FormData
  >(devPortalSignIn, { status: "idle" });

  useEffect(() => {
    // Full navigation so the request goes through the portal proxy rewrite.
    if (state.status === "ok") window.location.replace("/");
  }, [state.status]);

  return (
    <section
      aria-label="Dev sign-in"
      className="flex flex-col gap-3 rounded-lg border border-dashed border-line p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink">Dev sign-in</p>
        <p className="text-xs text-ink-3">
          Local development only. Invite a client from a matter&rsquo;s Portal
          card to list them here.
        </p>
      </div>
      {state.status === "invalid" ? (
        <p role="alert" className="text-xs text-danger">
          That client can&rsquo;t sign in (disabled or no live access).
        </p>
      ) : null}
      {users.length === 0 ? (
        <p className="text-xs text-ink-3">No invited clients yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li key={u.identityId}>
              <form
                action={formAction}
                className="flex items-center justify-between gap-3"
              >
                <input type="hidden" name="identityId" value={u.identityId} />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-ink-2">{u.name}</p>
                  <p className="truncate text-xs text-ink-3">
                    {u.email} · {u.matterCount}{" "}
                    {u.matterCount === 1 ? "matter" : "matters"}
                  </p>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={pending || state.status === "ok"}
                >
                  Sign in as
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
