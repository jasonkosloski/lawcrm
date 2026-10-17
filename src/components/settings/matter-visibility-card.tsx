/**
 * Matter visibility card (Settings -> Firm). Admins see the switch
 * and the "thin teams" list; the page does not render this for
 * anyone else.
 */

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  updateMatterVisibilityAction,
  type MatterVisibilityState,
} from "@/app/actions/matter-visibility";
import type { ThinTeamRow } from "@/lib/queries/thin-teams";

const initial: MatterVisibilityState = { status: "idle" };

export function MatterVisibilityCard({
  current,
  thinTotal,
  thinRows,
}: {
  current: "FIRM" | "TEAM";
  thinTotal: number;
  thinRows: ThinTeamRow[];
}) {
  const [state, formAction, pending] = useActionState(
    updateMatterVisibilityAction,
    initial
  );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Matter visibility
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-xs text-ink-3 mb-3 leading-relaxed">
          <strong>Everyone</strong>: any firm member can open any matter.{" "}
          <strong>Team only</strong>: a matter, and everything on it, is
          visible only to its active team, Admins, and roles granted{" "}
          <em>View all matters</em>. Hidden matters look like they do not
          exist. Grant <em>View all matters</em> to roles such as billing or
          office manager, and fix thin teams below, before switching.
        </p>
        <form action={formAction} className="flex flex-col gap-2">
          {(
            [
              ["FIRM", "Everyone"],
              ["TEAM", "Team only"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="inline-flex items-center gap-2 text-xs text-ink-2 select-none"
            >
              <input
                type="radio"
                name="matterVisibility"
                value={value}
                defaultChecked={current === value}
                className="h-3.5 w-3.5"
              />
              <span>{label}</span>
            </label>
          ))}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-line">
            {state.status === "ok" && (
              <span className="text-2xs text-ok">Saved.</span>
            )}
            {state.status === "error" && (
              <span className="text-2xs text-warn">
                {state.error ?? "Couldn't save."}
              </span>
            )}
            <Button type="submit" size="sm" disabled={pending} className="ml-auto">
              {pending ? "Saving…" : "Save visibility"}
            </Button>
          </div>
        </form>

        <div className="mt-4 pt-3 border-t border-line">
          <h3 className="text-xs font-semibold text-ink flex items-center gap-2">
            Thin teams
            <span className="text-2xs font-mono font-normal text-ink-4">
              {thinTotal}
            </span>
          </h3>
          <p className="text-2xs text-ink-3 mt-1 leading-relaxed">
            Open matters with no active team member, or only the lead. Add
            the people who work on them before switching to Team only.
          </p>
          {thinRows.length === 0 ? (
            <div className="text-2xs text-ok mt-2">
              Every open matter has a team.
            </div>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {thinRows.map((m) => (
                <li
                  key={m.id}
                  className="py-1.5 flex items-center justify-between gap-2 text-xs"
                >
                  <Link
                    href={`/matters/${m.id}/edit`}
                    className="text-ink hover:underline truncate"
                  >
                    {m.name}
                  </Link>
                  <span className="text-2xs text-ink-4 shrink-0">
                    {m.reason === "no_members"
                      ? "No team"
                      : `Lead only${m.leadName ? ` (${m.leadName})` : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {thinTotal > thinRows.length && (
            <div className="text-2xs text-ink-4 mt-2">
              Showing {thinRows.length} of {thinTotal}.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
