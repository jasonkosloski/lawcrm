/**
 * Lead Access card (restricted intake, ADR-049) on the lead Overview.
 *
 * Open lead: says so, and offers "Restrict" to `intake.restrict`
 * holders. Restricted lead: lists the intake team; holders of the key
 * can add / remove members and reopen the lead. The last member of a
 * restricted lead can't be removed (the server refuses too).
 */

"use client";

import { useId, useState, useTransition } from "react";
import { Lock, LockOpen, Plus, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  addLeadTeamMember,
  removeLeadTeamMember,
  setLeadRestricted,
} from "@/app/actions/lead-access";
import {
  MATTER_TEAM_ROLES,
  MATTER_TEAM_ROLE_LABEL,
  matterTeamRoleLabel,
  type MatterTeamRole,
} from "@/lib/matter-team-constants";
import { confirmAction } from "@/lib/feedback";

export type LeadTeamRow = {
  userId: string;
  name: string;
  initials: string | null;
  jobTitle: string | null;
  role: string;
};

export type LeadTeamUserOption = { id: string; name: string; jobTitle: string | null };

export function LeadAccessCard({
  leadId,
  restricted,
  members,
  userOptions,
  canManage,
}: {
  leadId: string;
  restricted: boolean;
  members: LeadTeamRow[];
  userOptions: LeadTeamUserOption[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const userSelectId = useId();
  const roleSelectId = useId();
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<MatterTeamRole>("co_counsel");

  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = userOptions.filter((u) => !memberIds.has(u.id));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) setError(res.error ?? "Couldn't update access.");
      } catch {
        setError("Couldn't update access. Please retry.");
      }
    });
  };

  const toggle = async () => {
    const next = !restricted;
    if (
      !(await confirmAction(
        next
          ? {
              title: "Restrict this intake?",
              description:
                "Only its team, people who can view restricted intakes, and Admins will see it and everything on it. You're added to the team.",
              confirmLabel: "Restrict",
            }
          : {
              title: "Open this intake to the firm?",
              description: "Everyone at the firm will be able to see it again.",
              confirmLabel: "Open to firm",
            }
      ))
    )
      return;
    run(() => setLeadRestricted(leadId, next));
  };

  const add = () => {
    if (!addUserId) return;
    const fd = new FormData();
    fd.set("userId", addUserId);
    fd.set("role", addRole);
    run(async () => {
      const res = await addLeadTeamMember(leadId, fd);
      if (res.ok) {
        setAddUserId("");
        setAddRole("co_counsel");
      }
      return res;
    });
  };

  const lastMember = restricted && members.length <= 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 text-xs text-ink-3">
        {restricted ? (
          <Lock size={14} className="text-warn shrink-0 mt-px" aria-hidden />
        ) : (
          <LockOpen size={14} className="text-ink-4 shrink-0 mt-px" aria-hidden />
        )}
        <span>
          {restricted
            ? "Restricted: only the team below can see this intake."
            : "Open: everyone at the firm can see this intake."}
        </span>
      </div>

      {restricted && (
        <ul className="border border-line rounded-md divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 px-3 py-2">
              <div className="w-6 h-6 rounded-full bg-paper-2 text-ink-3 flex items-center justify-center text-2xs font-mono shrink-0">
                {m.initials ?? m.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-ink truncate">{m.name}</div>
                <div className="text-2xs text-ink-4 truncate">
                  {matterTeamRoleLabel(m.role)}
                </div>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => run(() => removeLeadTeamMember(leadId, m.userId))}
                  disabled={pending || lastMember}
                  title={lastMember ? "A restricted intake needs at least one member" : undefined}
                  aria-label={`Remove ${m.name}`}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 hover:bg-warn-soft hover:text-warn disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {restricted && canManage && candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 flex-1 min-w-36">
            <label
              htmlFor={userSelectId}
              className="text-2xs font-mono uppercase tracking-wider text-ink-4"
            >
              Add member
            </label>
            <NativeSelect
              id={userSelectId}
              className="w-full"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              disabled={pending}
            >
              <NativeSelectOption value="">Pick a user…</NativeSelectOption>
              {candidates.map((u) => (
                <NativeSelectOption key={u.id} value={u.id}>
                  {u.name}
                  {u.jobTitle ? ` · ${u.jobTitle}` : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label
              htmlFor={roleSelectId}
              className="text-2xs font-mono uppercase tracking-wider text-ink-4"
            >
              Role
            </label>
            <NativeSelect
              id={roleSelectId}
              className="w-full"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as MatterTeamRole)}
              disabled={pending}
            >
              {MATTER_TEAM_ROLES.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {MATTER_TEAM_ROLE_LABEL[r]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button
            type="button"
            onClick={add}
            disabled={pending || !addUserId}
            className="h-8 px-3 text-xs"
          >
            <Plus size={12} />
            Add
          </Button>
        </div>
      )}

      {canManage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggle}
          disabled={pending}
          className="self-start"
        >
          {restricted ? <LockOpen size={12} /> : <Lock size={12} />}
          {restricted ? "Open to firm" : "Restrict"}
        </Button>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn"
        >
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
