/**
 * Extra team seats on the New-matter form. Posts the rows as JSON in
 * `extraTeam` (FormData can't carry an array of pairs cleanly); the
 * server re-validates everything (`resolveExtraTeam` in
 * actions/matters.ts). Only rendered for `matters.manage_team`.
 */

"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  MATTER_TEAM_ROLES,
  MATTER_TEAM_ROLE_LABEL,
} from "@/lib/matter-team-constants";
import type { NewMatterTeamSeat } from "@/lib/new-matter-constants";

const SEAT_ROLES = MATTER_TEAM_ROLES.filter((r) => r !== "lead");

/** Seed rows from the action-echoed JSON so nothing is lost across a
 *  validation round trip. */
export function parseTeamSeats(json: string | undefined): NewMatterTeamSeat[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.flatMap((s) =>
      s && typeof s.userId === "string" && typeof s.role === "string"
        ? [{ userId: s.userId, role: s.role }]
        : [],
    );
  } catch {
    return [];
  }
}

export function NewMatterTeamPicker({
  users,
  leadUserId,
  initial,
  error,
}: {
  users: Array<{ id: string; name: string; jobTitle: string }>;
  leadUserId: string;
  initial: NewMatterTeamSeat[];
  error?: string[];
}) {
  const [seats, setSeats] = useState<NewMatterTeamSeat[]>(initial);
  const taken = new Set([leadUserId, ...seats.map((s) => s.userId)]);
  const canAdd = users.some((u) => !taken.has(u.id));

  const update = (i: number, patch: Partial<NewMatterTeamSeat>) =>
    setSeats((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  // A seat whose person became the lead is dropped on submit (the
  // server drops it too), so the payload never repeats the lead.
  const posted = seats.filter((s) => s.userId && s.userId !== leadUserId);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-ink-2">Other team members</div>
      <input type="hidden" name="extraTeam" value={JSON.stringify(posted)} />
      {seats.map((seat, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <NativeSelect
              className="flex-1"
              aria-label={`Team member ${i + 1}`}
              value={seat.userId}
              onChange={(e) => update(i, { userId: e.target.value })}
            >
              <NativeSelectOption value="" disabled>
                Choose a person
              </NativeSelectOption>
              {users
                .filter((u) => u.id === seat.userId || !taken.has(u.id))
                .map((u) => (
                  <NativeSelectOption key={u.id} value={u.id}>
                    {u.name} · {u.jobTitle}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
            <NativeSelect
              className="w-40"
              aria-label={`Role for team member ${i + 1}`}
              value={seat.role}
              onChange={(e) => update(i, { role: e.target.value })}
            >
              {SEAT_ROLES.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {MATTER_TEAM_ROLE_LABEL[r]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <button
              type="button"
              onClick={() => setSeats((prev) => prev.filter((_, j) => j !== i))}
              aria-label={`Remove team member ${i + 1}`}
              className="p-1 rounded text-ink-3 hover:text-ink-2"
            >
              <X size={13} />
            </button>
          </div>
          {seat.userId && seat.userId === leadUserId && (
            <div className="text-2xs text-warn">
              Already the lead attorney. This row won&apos;t be saved.
            </div>
          )}
        </div>
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={() =>
            setSeats((prev) => [...prev, { userId: "", role: "co_counsel" }])
          }
          className="self-start inline-flex items-center gap-1 text-2xs text-brand-700 hover:underline"
        >
          <Plus size={11} />
          Add team member
        </button>
      )}
      {error?.length ? (
        <div className="text-2xs text-warn">{error[0]}</div>
      ) : null}
    </div>
  );
}
