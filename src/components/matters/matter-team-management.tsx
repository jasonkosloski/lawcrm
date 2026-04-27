/**
 * Matter Team Management
 *
 * Admin-only card on the matter edit page. Lists active team
 * members with a Remove button per row, lists former members
 * read-only with a "(former)" suffix, and exposes an Add form
 * (user picker + role select).
 *
 * Permissions: today the parent page renders this card only when
 * the viewing user is an admin (server-side check via
 * `isCurrentUserAdmin()`). When firm-configurable role
 * permissions land we'll add a `canEdit` prop and gate the
 * mutating UI on it — the read-only structure already supports
 * being shown without buttons.
 *
 * Audit: every add/remove fires through addMatterTeamMember /
 * removeMatterTeamMember which write an ActivityLog entry.
 * The card itself is just a thin client over those actions.
 */

"use client";

import { useState, useTransition } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  addMatterTeamMember,
  removeMatterTeamMember,
} from "@/app/actions/matters";
import {
  MATTER_TEAM_ROLES,
  MATTER_TEAM_ROLE_LABEL,
  matterTeamRoleLabel,
  type MatterTeamRole,
} from "@/lib/matter-team-constants";

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
}: {
  matterId: string;
  members: TeamMemberRow[];
  userOptions: TeamUserOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
    startTransition(async () => {
      const res = await addMatterTeamMember(matterId, fd);
      if (!res.ok) {
        setError(res.error ?? "Couldn't add team member.");
      } else {
        setAddUserId("");
        setAddRole("co_counsel");
      }
    });
  };

  const handleRemove = (membershipId: string, name: string) => {
    if (
      !confirm(
        `Remove ${name} from this matter? They stay in the audit trail but won't appear in the active roster.`
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await removeMatterTeamMember(matterId, membershipId);
      if (!res.ok) setError(res.error ?? "Couldn't remove team member.");
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-ink">Team</div>
        <div className="text-2xs text-ink-4 mt-0.5">
          Add or remove people from the case team. Removals are
          soft — former members stay logged on the matter for
          historical attribution.
        </div>
      </div>

      {/* Active members */}
      <div className="border border-line rounded-md overflow-hidden">
        {active.length === 0 ? (
          <div className="px-3 py-3 text-2xs text-ink-4 italic">
            No active team members yet.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((m) => (
              <li
                key={m.membershipId}
                className="flex items-center gap-3 px-3 py-2"
              >
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
                  disabled={pending}
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
            <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Add member
            </label>
            <select
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              disabled={pending}
              className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            >
              <option value="">Pick a user…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.jobTitle ? ` · ${u.jobTitle}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-44">
            <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Role
            </label>
            <select
              value={addRole}
              onChange={(e) =>
                setAddRole(e.target.value as MatterTeamRole)
              }
              disabled={pending}
              className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            >
              {MATTER_TEAM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {MATTER_TEAM_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={pending || !addUserId}
            className="h-8 px-3 text-xs"
          >
            <Plus size={12} />
            {pending ? "Adding…" : "Add"}
          </Button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {/* Former members — read-only, dimmed. Always rendered when
          there are any so the audit trail stays visible during
          edit. */}
      {former.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-line">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Former members
          </div>
          <ul className="border border-line rounded-md overflow-hidden divide-y divide-line">
            {former.map((m) => (
              <li
                key={m.membershipId}
                className="flex items-center gap-3 px-3 py-2 opacity-70"
              >
                <div className="w-7 h-7 rounded-full bg-paper-2 text-ink-4 flex items-center justify-center text-2xs font-mono shrink-0">
                  {m.initials ?? m.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink-3 truncate">{m.name}</div>
                  <div
                    className={cn(
                      "text-2xs text-ink-4 truncate"
                    )}
                  >
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
