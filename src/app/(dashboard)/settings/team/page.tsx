/**
 * /settings/team — Firm roster.
 *
 * Everyone in the firm sees the roster (handy for "what's the
 * paralegal's email"); admins additionally get the per-row kebab
 * (Edit / Reset password) plus the invite composer at the bottom.
 *
 * Permission roles (Admin, default, custom) replace the old
 * isAdmin boolean. Members can hold any number of roles; the
 * "default" role is auto-assigned to everyone. Manage the role
 * catalog on /settings/roles.
 *
 * Invariants enforced server-side in `src/app/actions/team.ts`:
 *   - "At least one Admin" — any change that would leave 0 active
 *     users with the Admin role is rejected.
 *   - "default role always assigned" — survives any role-list edit.
 *   - "No deactivating yourself" — you can't lock yourself out.
 *   - "Email is unique" — duplicate-on-invite returns a friendly
 *     error rather than a Prisma constraint violation.
 */

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MemberRow } from "@/components/settings/member-row";
import { InviteMemberComposer } from "@/components/settings/invite-member-composer";
import { getCurrentUserId } from "@/lib/current-user";
import { isCurrentUserAdmin } from "@/lib/firm";
import { listFirmUsers, listRolePickerOptions } from "@/lib/queries/team";

export default async function TeamSettingsPage() {
  const currentUserId = await getCurrentUserId();
  const [members, isAdmin, rolePickerOptions] = await Promise.all([
    listFirmUsers(currentUserId),
    isCurrentUserAdmin(),
    listRolePickerOptions(),
  ]);

  const activeCount = members.filter((m) => m.isActive).length;
  const adminCount = members.filter((m) => m.isAdmin && m.isActive).length;

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <div>
        <h1 className="text-base font-semibold text-ink">Team</h1>
        <p className="text-xs text-ink-3 mt-1">
          Firm members, job titles, and role assignments.{" "}
          <span className="text-ink-4">
            {activeCount} active · {adminCount}{" "}
            {adminCount === 1 ? "admin" : "admins"}
          </span>
        </p>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Member</TableHead>
              <TableHead>Job title</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
              <TableHead className="pr-4 w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isCurrentUserAdmin={isAdmin}
                rolePickerOptions={rolePickerOptions}
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      {isAdmin && (
        <div className="flex flex-col gap-2">
          <InviteMemberComposer rolePickerOptions={rolePickerOptions} />
          <div className="text-[10px] text-ink-4 leading-relaxed">
            Invites generate a one-time password you deliver to the new
            member. Email-based invites land when we wire delivery
            (Phase 2 of <span className="font-mono">docs/AUTH_PLAN.md</span>).
          </div>
        </div>
      )}
    </div>
  );
}
