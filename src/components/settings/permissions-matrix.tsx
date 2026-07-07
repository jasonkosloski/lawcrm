/**
 * Permissions Matrix
 *
 * Y-axis: every permission in the static catalog, grouped by
 *   category section header.
 * X-axis: every role defined for the firm.
 * Intersection: a checkbox toggle that grants / revokes the
 *   permission on the role.
 *
 * Admin column is rendered checked + locked. The runtime
 * permission check treats Admin as "all granted" regardless of
 * what's in the join table, so we don't materialize join rows for
 * it — the column reads as fully granted because the role's name
 * is "Admin", not because of stored data.
 *
 * Toggles fire `setRolePermissionAction` through useTransition.
 * The optimistic state holds locally so the box flips immediately;
 * if the action errors we revert and surface the message inline.
 *
 * Visible to everyone in the firm (read-only); only admins get
 * functional checkboxes — the parent page passes `canEdit` so
 * this component doesn't repeat the admin lookup.
 */

"use client";

import { Fragment, useState, useTransition } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { setRolePermissionAction } from "@/app/actions/roles";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";
import { PERMISSION_CATEGORIES } from "@/lib/permissions";

type RoleColumn = {
  id: string;
  name: string;
  isSystem: boolean;
};

export function PermissionsMatrix({
  roles,
  /** Map: roleId → Set of permission keys granted to that role. */
  grants,
  canEdit,
}: {
  roles: RoleColumn[];
  grants: Record<string, string[]>;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Optimistic local state — `Map<roleId, Set<permission>>`. Cell
  // toggles flip the box immediately; the action call rolls it
  // back if the server rejects.
  const [grantsState, setGrantsState] = useState<Record<string, Set<string>>>(
    () => {
      const next: Record<string, Set<string>> = {};
      for (const [roleId, list] of Object.entries(grants)) {
        next[roleId] = new Set(list);
      }
      return next;
    }
  );

  const isAdminRole = (r: RoleColumn) =>
    r.isSystem && r.name === ADMIN_ROLE_NAME;

  const isGranted = (roleId: string, key: string, role: RoleColumn): boolean => {
    if (isAdminRole(role)) return true;
    return grantsState[roleId]?.has(key) ?? false;
  };

  const toggle = (roleId: string, role: RoleColumn, key: string) => {
    // `pending` disables the checkbox, but the surrounding <td>'s
    // onClick isn't a form control — guard here too, or clicking
    // the cell padding mid-flight queues extra toggles whose
    // inverse-apply reverts can interleave with the in-flight save.
    if (pending || !canEdit || isAdminRole(role)) return;
    const current = grantsState[roleId]?.has(key) ?? false;
    const next = !current;

    // Optimistic flip — apply locally before the network call.
    setGrantsState((prev) => {
      const set = new Set(prev[roleId] ?? []);
      if (next) set.add(key);
      else set.delete(key);
      return { ...prev, [roleId]: set };
    });
    setError(null);

    startTransition(async () => {
      const res = await setRolePermissionAction(roleId, key, next);
      if (!res.ok) {
        // Revert on failure.
        setGrantsState((prev) => {
          const set = new Set(prev[roleId] ?? []);
          if (next) set.delete(key);
          else set.add(key);
          return { ...prev, [roleId]: set };
        });
        setError(res.error ?? "Couldn't update permission.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Permissions matrix</h2>
        <div className="text-2xs text-ink-4">
          {canEdit
            ? "Toggle a cell to grant or revoke. Admin grants everything by definition."
            : "Read-only — only admins can change permissions."}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <div className="border border-line rounded-md overflow-x-auto bg-paper">
        {/* The grid uses one wide column for the permission label
            and a fixed-width column per role. Sticky left so the
            permission name stays visible while horizontally
            scrolling on small screens with many roles. */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-paper-2/60 border-b border-line">
              <th className="sticky left-0 z-10 bg-paper-2/60 text-left px-3 py-2 text-2xs font-mono uppercase tracking-wider text-ink-4 min-w-[16rem]">
                Permission
              </th>
              {roles.map((r) => (
                <th
                  key={r.id}
                  className="px-2 py-2 text-2xs font-medium text-ink min-w-[7rem] text-center"
                  title={
                    isAdminRole(r)
                      ? "Admin grants every permission by definition."
                      : undefined
                  }
                >
                  <div className="flex items-center justify-center gap-1">
                    <span className="truncate">{r.name}</span>
                    {isAdminRole(r) && (
                      <Lock size={10} className="text-ink-4 shrink-0" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_CATEGORIES.map((cat) => (
              <Fragment key={cat.id}>
                {/* Category band header — spans the full table.
                    Visually breaks the long permission list into
                    scannable groups. Fragment (not <tbody>) so we
                    don't nest tbody elements inside the outer one,
                    which the browser silently restructures and
                    triggers a hydration mismatch. */}
                <tr>
                  <td
                    colSpan={1 + roles.length}
                    className="sticky left-0 bg-paper-2/30 border-b border-line px-3 py-1.5 text-2xs font-mono uppercase tracking-wider text-ink-3"
                  >
                    {cat.label}
                  </td>
                </tr>
                {cat.permissions.map((p, idx) => {
                  const isLast = idx === cat.permissions.length - 1;
                  return (
                    <tr
                      key={p.key}
                      className={cn(
                        "border-b border-line/60 hover:bg-paper-2/40",
                        isLast && "border-b-0"
                      )}
                    >
                      <td className="sticky left-0 bg-paper px-3 py-2 align-top">
                        <div className="text-xs text-ink font-medium">
                          {p.label}
                        </div>
                        <div className="text-2xs text-ink-4 mt-0.5 leading-relaxed max-w-md">
                          {p.description}
                        </div>
                      </td>
                      {roles.map((r) => {
                        const granted = isGranted(r.id, p.key, r);
                        const locked = isAdminRole(r) || !canEdit;
                        return (
                          <td
                            key={r.id}
                            className={cn(
                              "px-2 py-2 text-center align-middle",
                              !locked && "cursor-pointer"
                            )}
                            onClick={() => toggle(r.id, r, p.key)}
                          >
                            <input
                              type="checkbox"
                              checked={granted}
                              disabled={locked || pending}
                              readOnly={locked}
                              // Stop the row's onClick from
                              // double-firing when the click hits
                              // the input directly.
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggle(r.id, r, p.key)}
                              className={cn(
                                "h-4 w-4",
                                locked && "cursor-not-allowed opacity-70"
                              )}
                              aria-label={`${p.label} for ${r.name}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
