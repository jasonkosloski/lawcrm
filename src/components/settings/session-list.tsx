/**
 * Signed-in devices list — /settings/security.
 *
 * Rows arrive pre-formatted from the server page (times already in the
 * user's profile zone). The current device gets a badge; every other
 * row has a Revoke button that calls `revokeMySession`.
 */

"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { revokeMySession } from "@/app/actions/security-sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type SessionRow = {
  id: string;
  browser: string | null;
  device: string | null;
  location: string | null;
  lastActive: string;
  isCurrent: boolean;
};

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const [isPending, startTransition] = useTransition();

  const revoke = (id: string) =>
    startTransition(async () => {
      const r = await revokeMySession(id);
      if (r.ok) toast.success("Device signed out.");
      else toast.error(r.error);
    });

  return (
    <ul className="flex flex-col divide-y divide-line">
      {sessions.map((s) => {
        const label =
          [s.browser, s.device].filter(Boolean).join(" · ") || "Unknown device";
        return (
          <li key={s.id} className="py-2 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium text-ink flex items-center gap-2">
                <span className="truncate">{label}</span>
                {s.isCurrent && <Badge variant="secondary">This device</Badge>}
              </div>
              <div className="text-2xs text-ink-4 truncate">
                {[s.location, `Last active ${s.lastActive}`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {!s.isCurrent && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => revoke(s.id)}
              >
                Revoke
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
