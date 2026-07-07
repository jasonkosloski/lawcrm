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
import { PermissionsMatrix } from "@/components/settings/permissions-matrix";
import { RoleRow } from "@/components/settings/role-row";
import {
  currentUserHasPermission,
  getCurrentUserPermissions,
} from "@/lib/permission-check";
import {
  listFirmRoles,
  listRolePermissionGrants,
} from "@/lib/queries/team";

export default async function RolesSettingsPage() {
  // Three independent permission gates on this page:
  //   - role list visibility: open to every signed-in firm member
  //     (read view is firm-wide governance info)
  //   - role CRUD (create/rename/delete): firm.manage_roles
  //   - permission matrix toggles: firm.manage_permissions
  // viewerIsAdmin feeds the matrix's meta-key lock: the server
  // action only lets Admins grant/revoke firm.manage_permissions /
  // firm.manage_roles, so the matrix greys those cells for
  // non-admin editors instead of surfacing a server error on click.
  const [roles, canManageRoles, canManagePerms, grantsMap, resolved] =
    await Promise.all([
      listFirmRoles(),
      currentUserHasPermission("firm.manage_roles"),
      currentUserHasPermission("firm.manage_permissions"),
      listRolePermissionGrants(),
      getCurrentUserPermissions(),
    ]);

  // Convert the Map<roleId, Set<key>> into a plain object the
  // matrix component can serialize across the server/client
  // boundary. Sets aren't transferrable; arrays are.
  const grants: Record<string, string[]> = {};
  for (const [roleId, keys] of grantsMap) {
    grants[roleId] = Array.from(keys);
  }

  return (
    <div className="flex flex-col gap-5 max-w-6xl">
      <div>
        <h1 className="text-base font-semibold text-ink">Roles</h1>
        <p className="text-xs text-ink-3 mt-1">
          Permission groups for your firm. Members can hold any number
          of roles; permissions flow through these. Admins can change
          which roles grant which permissions in the matrix below.
        </p>
      </div>

      {/* Permissions matrix — drives what each role actually grants. */}
      <PermissionsMatrix
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          isSystem: r.isSystem,
        }))}
        grants={grants}
        canEdit={canManagePerms}
        viewerIsAdmin={resolved.isAdmin}
      />

      {/* Role list / management — rename, delete, member count. */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">Roles</h2>
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
                <RoleRow key={r.id} role={r} isAdmin={canManageRoles} />
              ))}
            </TableBody>
          </Table>
        </Card>

        {canManageRoles && (
          <div className="flex flex-col gap-2">
            <CreateRoleForm />
            <div className="text-[10px] text-ink-4 leading-relaxed">
              System roles (<span className="font-mono">Admin</span>,{" "}
              <span className="font-mono">default</span>) can&apos;t
              be renamed or deleted. The{" "}
              <span className="font-mono">default</span> role is
              auto-assigned to every new firm member.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
