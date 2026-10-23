/**
 * Matter Team Management
 *
 * Card on the matter edit page, rendered for users with matters.manage_team. Lists active team
 * members with a Remove button per row, lists former members
 * read-only with a "(former)" suffix, and exposes an Add form
 * (user picker + role select).
 *
 * Permissions: the parent page renders this card only when the
 * viewing user holds `matters.manage_team` (admin always does).
 * Mutations on the server side go through the same gate via
 * `requirePermission("matters.manage_team")`.
 *
 * Audit: every add/remove fires through addMatterTeamMember /
 * removeMatterTeamMember which write an ActivityLog entry.
 * The card itself is just a thin client over those actions.
 */

"use client";

import { useId, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { addMatterTeamMember, removeMatterTeamMember } from "@/app/actions/matters";
import {
  MATTER_TEAM_ROLES,
  MATTER_TEAM_ROLE_LABEL,
  matterTeamRoleLabel,
  type MatterTeamRole,
} from "@/lib/matter-team-constants";
import { confirmAction } from "@/lib/feedback";
import { FormErrorBanner } from "@/components/ui/field";

export type TeamMemberRow = {
  membershipId: string;
  userId: string;
  name: string;
  jobTitle: string | null;
  initials: string | null;
  role: string;
  /** null = active, Date = soft-removed and shown as "(former)". */
  removedAt: Date | null;
};

export type TeamUserOption = {
  id: string;
  name: string;
  jobTitle: string | null;
};

export function MatterTeamManagement({
  matterId,
  members,
  userOptions,
  attorneyIds,
}: {
  matterId: string;
  members: TeamMemberRow[];
  userOptions: TeamUserOption[];
  /** Users holding a bar admission: only they can be made lead. */
  attorneyIds: string[];
}) {
  const [pending, startTransition] = useTransition();
  // Which operation is in flight, so only the Add button reads "Adding…"
  // during an add (not during a removal).
  const [pendingKind, setPendingKind] = useState<"add" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addUserSelectId = useId();
  const addRoleSelectId = useId();
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<MatterTeamRole>("co_counsel");

  const active = members.filter((m) => !m.removedAt);
  const former = members.filter((m) => m.removedAt);

  // Available-to-add users: anyone not already an active member.
  // Former members can still be re-added — picking them upserts
  // their existing row (clears removedAt + sets the new role).
  const activeUserIds = new Set(active.map((m) => m.userId));
  const candidates = userOptions.filter((u) => !activeUserIds.has(u.id));

  const handleAdd = () => {
    if (!addUserId) {
      setError("Pick a user.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("userId", addUserId);
    fd.set("role", addRole);
    setPendingKind("add");
    startTransition(async () => {
      // A thrown action (network blip, post-commit failure) must not
      // escape to the route error boundary — that would replace the
      // whole edit page and discard unsaved edits in the form above.
      // The add/remove actions are idempotent, so retrying is safe.
      try {
        const res = await addMatterTeamMember(matterId, fd);
        if (!res.ok) {
          setError(res.error ?? "Couldn't add team member.");
        } else {
          setAddUserId("");
          setAddRole("co_counsel");
        }
      } catch {
        setError("Couldn't update the team. Please retry.");
      } finally {
        setPendingKind(null);
      }
    });
  };

  const handleRemove = async (membershipId: string, name: string) => {
    if (
      !(await confirmAction({
        title: `Remove ${name} from this matter?`,
        description: "They stay in the audit trail but won't appear in the active roster.",
        confirmLabel: "Remove member",
        destructive: true,
      }))
    )
      return;
    setError(null);
    setPendingKind("remove");
    startTransition(async () => {
      try {
        const res = await removeMatterTeamMember(matterId, membershipId);
        if (!res.ok) setError(res.error ?? "Couldn't remove team member.");
      } catch {
        setError("Couldn't update the team. Please retry.");
      } finally {
        setPendingKind(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-ink">Team</div>
        <div className="text-2xs text-ink-4 mt-0.5">
          Add or remove people from the case team. Removals are soft — former members stay logged on
          the matter for historical attribution.
        </div>
      </div>

      {/* Active members */}
      <div className="border border-line rounded-md overflow-hidden">
        {active.length === 0 ? (
          <div className="px-3 py-3 text-2xs text-ink-4 italic">No active team members yet.</div>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((m) => (
              <li key={m.membershipId} className="flex items-center gap-3 px-3 py-2">
                <div className="w-7 h-7 rounded-full bg-paper-2 text-ink-3 flex items-center justify-center text-2xs font-mono shrink-0">
                  {m.initials ?? m.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink truncate">{m.name}</div>
                  <div className="text-2xs text-ink-4 truncate">
                    {matterTeamRoleLabel(m.role)}
                    {m.jobTitle && (
                      <>
                        <span className="mx-1">·</span>
                        {m.jobTitle}
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(m.membershipId, m.name)}
                  // The server always refuses to remove the lead; make
                  // that visible instead of offering a dead-end button.
                  disabled={pending || m.role === "lead"}
                  title={m.role === "lead" ? "Promote another member to lead first" : undefined}
                  aria-label={`Remove ${m.name}`}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-warn-soft hover:text-warn disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add form — picker + role + button. Hidden when there are
          no candidates to add (everyone already on the team). */}
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <label htmlFor={addUserSelectId} className="text-2xs font-medium text-ink-3">
              Add member
            </label>
            <NativeSelect
              className="w-full"
              id={addUserSelectId}
              value={addUserId}
              onChange={(e) => {
                setAddUserId(e.target.value);
                // "Lead attorney" is offered only for attorneys.
                if (addRole === "lead" && !attorneyIds.includes(e.target.value)) {
                  setAddRole("co_counsel");
                }
              }}
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
          <div className="flex flex-col gap-1 w-44">
            <label htmlFor={addRoleSelectId} className="text-2xs font-medium text-ink-3">
              Role
            </label>
            <NativeSelect
              className="w-full"
              id={addRoleSelectId}
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as MatterTeamRole)}
              disabled={pending}
            >
              {MATTER_TEAM_ROLES.filter((r) => r !== "lead" || attorneyIds.includes(addUserId)).map(
                (r) => (
                  <NativeSelectOption key={r} value={r}>
                    {MATTER_TEAM_ROLE_LABEL[r]}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
          </div>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={pending || !addUserId}
            className="h-8 px-3 text-xs"
          >
            <Plus size={12} />
            {pendingKind === "add" ? "Adding…" : "Add"}
          </Button>
        </div>
      )}

      <FormErrorBanner message={error} />

      {/* Former members — read-only, dimmed. Always rendered when
          there are any so the audit trail stays visible during
          edit. */}
      {former.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-line">
          <div className="text-2xs font-medium text-ink-3">Former members</div>
          <ul className="border border-line rounded-md overflow-hidden divide-y divide-line">
            {former.map((m) => (
              <li key={m.membershipId} className="flex items-center gap-3 px-3 py-2 opacity-70">
                <div className="w-7 h-7 rounded-full bg-paper-2 text-ink-4 flex items-center justify-center text-2xs font-mono shrink-0">
                  {m.initials ?? m.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink-3 truncate">{m.name}</div>
                  <div className={cn("text-2xs text-ink-4 truncate")}>
                    {matterTeamRoleLabel(m.role)}
                    <span className="ml-1 italic">(former)</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
