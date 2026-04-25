/**
 * /settings/roles — Permission roles for the firm.
 *
 * Source of truth for "what permission groups exist." Admins can
 * create, rename, and delete custom roles; the two system roles
 * ("Admin" + "default") are locked. Today only the Admin role
 * actually grants powers (admin-gated server actions); custom roles
 * exist as named buckets ready for granular permissions when those
 * land.
 *
 * Everyone in the firm can see the roster (handy for "what does
 * Billing mean here?"); only admins get the create/edit/delete
 * affordances.
 */

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateRoleForm } from "@/components/settings/create-role-form";
import { RoleRow } from "@/components/settings/role-row";
import { isCurrentUserAdmin } from "@/lib/firm";
import { listFirmRoles } from "@/lib/queries/team";

export default async function RolesSettingsPage() {
  const [roles, isAdmin] = await Promise.all([
    listFirmRoles(),
    isCurrentUserAdmin(),
  ]);

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <div>
        <h1 className="text-base font-semibold text-ink">Roles</h1>
        <p className="text-xs text-ink-3 mt-1">
          Permission groups for your firm. Members can hold any number
          of roles; permissions flow through these.{" "}
          <span className="text-ink-4">
            Today only <span className="font-mono">Admin</span> grants
            powers — custom roles are named buckets ready for
            granular permissions.
          </span>
        </p>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Role</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="pr-4 w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((r) => (
              <RoleRow key={r.id} role={r} isAdmin={isAdmin} />
            ))}
          </TableBody>
        </Table>
      </Card>

      {isAdmin && (
        <div className="flex flex-col gap-2">
          <CreateRoleForm />
          <div className="text-[10px] text-ink-4 leading-relaxed">
            System roles (<span className="font-mono">Admin</span>,{" "}
            <span className="font-mono">default</span>) can&apos;t be
            renamed or deleted. The <span className="font-mono">default</span>{" "}
            role is auto-assigned to every new firm member.
          </div>
        </div>
      )}
    </div>
  );
}
