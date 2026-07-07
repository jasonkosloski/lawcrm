# Permissions

How LawCRM decides who can do what. This doc is the source of truth
for the model + the day-to-day "I'm wiring a new gate, what do I do?"
playbook. If a code path conflicts with what's written here, the code
is wrong.

## TL;DR

A user's effective permissions =
  - `*` (all) if they hold the **Admin** role, OR
  - the **set union** of every `RolePermission` row attached to every
    role they hold.

The catalog of permission keys is **app-defined** (a static list in
`src/lib/permissions.ts`). The grants are **firm-defined** — admins
toggle them in the matrix on `/settings/roles`.

Every server action and page guard funnels through one of two helpers:
`requirePermission(key)` (throws a redirect on fail) or
`currentUserHasPermission(key)` (returns boolean). Admin always passes.

---

## The mental model

There are three concepts; keeping them straight makes the rest of this
doc make sense.

| Concept       | Owner | Lives in                                           | Example                                        |
|---------------|-------|----------------------------------------------------|------------------------------------------------|
| Permission    | App   | `src/lib/permissions.ts` (static catalog)          | `"matters.manage_team"`                        |
| Role          | Firm  | `Role` table, scoped by `firmId`                   | `"Admin"`, `"default"`, `"Billing manager"`    |
| Grant         | Firm  | `RolePermission` join, set in the matrix UI        | `Billing manager → billing.send_invoice`       |

A **permission** is a code-defined capability (`"billing.send_invoice"`).
Adding one is a code change; you can't create permissions in the UI.

A **role** is a firm-defined named bucket (`"Billing manager"`).
Two firms each have their own roles; the names don't collide because
roles are scoped by `firmId`. Two are seeded as system roles (Admin +
default) and locked.

A **grant** is the join row that says "this role grants this
permission." The matrix on `/settings/roles` is the UI for these.

A **user** holds one or more roles via `UserRole`. Their effective
permissions are the union of grants across every role they hold (plus
the Admin wildcard).

---

## Schema

Three tables. All firm-scoped (multi-tenant ready) via the role's
`firmId`; users + role-permission grants inherit the scope through
their role.

### `Role`

Firm-scoped role rows.

| Field         | Type          | Notes                                                       |
|---------------|---------------|-------------------------------------------------------------|
| `id`          | cuid          |                                                             |
| `firmId`      | FK Firm       | Same role name can exist in two different firms.            |
| `name`        | string        | Unique per firm. `"Admin"` and `"default"` are reserved.    |
| `description` | string?       | Free text for the role-list UI.                             |
| `isSystem`    | boolean       | True for the two seeded roles. UI refuses rename/delete.    |
| `createdAt`/`updatedAt` | DateTime |                                                          |

Reverse relations: `userRoles` (users holding the role) and
`permissions` (the role's `RolePermission` grants).

### `UserRole`

Many-to-many between users and roles. Composite PK on `[userId, roleId]`
prevents the same role being assigned twice; distinct roles stack.

| Field          | Type        | Notes                                                       |
|----------------|-------------|-------------------------------------------------------------|
| `userId`       | FK User     |                                                             |
| `roleId`       | FK Role     |                                                             |
| `assignedAt`   | DateTime    |                                                             |
| `assignedById` | FK User?    | Who granted it. Null for the seed path. SetNull on delete.  |

A user can hold any number of roles. The runtime `hasPermission` check
walks all of them and unions the grants.

### `RolePermission`

The join table that drives the matrix.

| Field        | Type       | Notes                                                                                      |
|--------------|------------|--------------------------------------------------------------------------------------------|
| `roleId`     | FK Role    | Composite PK with `permission`.                                                            |
| `permission` | string     | Dotted key, e.g. `"matters.manage_team"`. Validated against the catalog at write time.    |
| `createdAt`  | DateTime   |                                                                                            |

Cascade on `Role` delete. **Unknown permission keys are tolerated on
read** — if we drop a key from the catalog, existing rows pinned to it
sit harmlessly until cleaned up.

### What's NOT in the schema

- **No `Permission` model.** Permissions are app-defined, not data the
  firm owns. Adding one is a code change, not a row insert.
- **No rows for the Admin role.** Admin's column in the matrix renders
  fully checked + locked because the runtime treats `role.name === "Admin"`
  as a wildcard short-circuit. Materializing rows for Admin would just
  duplicate the catalog every time it changed.
- **No per-user grants.** Permissions flow through roles only. If a
  single user needs an unusual permission, give them a role for it.

---

## The catalog (`src/lib/permissions.ts`)

Static, in-code list of every permission the app knows about, grouped
by category for the matrix UI.

```ts
export type PermissionEntry = {
  key: string;          // "matters.manage_team"
  label: string;        // "Manage team members"
  description: string;  // shown in the matrix tooltip
};

export type PermissionCategory = {
  id: string;                       // "matters"
  label: string;                    // "Matters"
  permissions: PermissionEntry[];
};

export const PERMISSION_CATEGORIES: PermissionCategory[] = [ /* ... */ ];

// Flat key list, derived from the categories.
export const PERMISSION_KEYS: string[] = ...;
export const PERMISSION_KEYS_SET = new Set(PERMISSION_KEYS);
export function isKnownPermission(key: string): boolean;
```

### Naming convention

Dotted keys: `<category>.<verb_or_noun>`. Lowercase snake_case under
the dot. The prefix matches the category id so a key like
`"billing.send_invoice"` is self-locating — grep finds both the
catalog entry and the runtime check.

### Granular keys per capability

**Every feature should split each capability into its own key.**
Don't lump add/edit/delete under a single `manage_X` permission — a
firm legitimately wants to delegate "can add team members" to a
senior paralegal but reserve "can remove team members" for partners.
Examples of the right granularity:

- `firm.practice_areas.view` / `.create` / `.edit` / `.archive` / `.delete`
- `matters.team.view` / `.add` / `.remove`
- `billing.invoice.draft` / `.approve` / `.send` / `.delete_draft` / `.void` / `.record_payment` / `.apply_trust`

The v1 catalog has some coarse `manage_*` keys (`matters.manage_team`,
`firm.manage_team_directory`, `firm.manage_roles`,
`firm.manage_practice_areas`) preserved during the cutover from
`requireAdmin()`. **New work should not add coarse keys** — split the
capability up front. Existing coarse keys get refined as each feature
gets revisited.

### The current catalog

**`src/lib/permissions.ts` is the source of truth** — this doc
deliberately does not duplicate the key list. (A hand-maintained
table lived here once and drifted to 54% incomplete within two
months; don't reintroduce one.) To enumerate:

```bash
# every category id
grep -E '^\s+id:' src/lib/permissions.ts
# every key with its label
grep -E '^\s+key:' src/lib/permissions.ts
```

Or read `PERMISSION_CATEGORIES` directly — it's grouped and
commented for exactly this purpose. The matrix UI at
`/settings/roles` renders the same catalog, so it's also a live,
always-current view of every category and key.

---

## Resolution rules (runtime)

`src/lib/permission-check.ts` is the single chokepoint. The resolver
runs once per request (cached via React's `cache()`) and returns:

```ts
type ResolvedPermissions = {
  isAdmin: boolean;       // any of the user's roles is "Admin"
  granted: Set<string>;   // union of RolePermission.permission across
                          // all of the user's roles, EXCLUDING admin
                          // (admin gets a wildcard, not a materialized
                          // catalog)
};
```

The check then asks:

1. If the user is **inactive** → no permissions. Period.
2. If the user holds the **Admin** role → all permissions. (Short-circuit;
   `granted` may be empty but `isAdmin: true` makes every call return
   true.)
3. Otherwise → `granted.has(key)`.

### Why Admin is a wildcard, not seed rows

If we materialized a `RolePermission` row for every catalog key on the
Admin role, every catalog change would need to re-seed those rows.
And the matrix UI would have to special-case rendering them as locked
anyway. Treating `role.name === "Admin"` as the short-circuit is the
same thing with less data to maintain.

The matrix UI shows Admin's column as checked + locked from the role's
name, not from the join table.

### Why unions, not precedence

A user holding "Billing manager" + "Case manager" gets the **union** of
their permissions. There's no precedence to worry about — set-union is
the simplest model that makes sense and covers every observed use case.
If someone needs to *remove* a permission for a specific user, the
right answer is "don't put them in the role that grants it," not "add a
deny rule."

### Caching

The resolver is wrapped in `cache()` from React. Multiple gates in the
same render (a page guard + a server action it triggers) hit the DB
once. The cache is per-request, so changes from one request show up
on the next.

---

## API: how you actually call it

All four helpers are in `src/lib/permission-check.ts` (server-only).

### Read-side check (component / page)

```ts
import { currentUserHasPermission } from "@/lib/permission-check";

const canEdit = await currentUserHasPermission("firm.edit_info");
return canEdit ? <EditForm /> : <ReadOnlyView />;
```

Use this anywhere you want a `canEdit` / `canDelete` / `canSeeButton`
flag. Returns `Promise<boolean>`. Admin always returns true.

### "Any of these" check (nav-item visibility)

```ts
import { currentUserHasAnyPermission } from "@/lib/permission-check";

const showFirmGroup = await currentUserHasAnyPermission([
  "firm.manage_team_directory",
  "firm.manage_roles",
  "firm.edit_info",
]);
```

Useful for a nav item or tab that lights up when the user can do
*anything* in the area, without listing each capability separately.

### Bulk fetch (multiple checks at once)

```ts
import { getCurrentUserPermissions } from "@/lib/permission-check";

const { isAdmin, granted } = await getCurrentUserPermissions();
// pass `Array.from(granted)` to a client component that needs to
// decide several things locally
```

The settings sidebar uses this — one fetch, the nav component decides
each item's visibility from the granted set.

### Server-action guard (write paths)

```ts
import { requirePermission } from "@/lib/permission-check";

export async function deleteFoo(id: string) {
  await requirePermission("foo.delete");
  // ... do the thing
}
```

Throws a `redirect("/")` when the check fails — same UX as
`requireAdmin()` had for non-admins. Returns the userId for chaining
into the action body.

### `requireAdmin()` / `isCurrentUserAdmin()` — when to use them

The admin-as-concept helpers in `src/lib/firm.ts` stay. Use them when
the gate is conceptually "admin-only" rather than a specific
permission — e.g., a future "Matter Actions → Archive matter" that we
explicitly never want to delegate. **Don't reach for them as a
shortcut around defining a real permission.** If a role legitimately
might want the capability, add a permission key.

---

## System roles

Two roles are seeded on every firm and locked from rename/delete:

| Role      | Behavior                                                                                       |
|-----------|------------------------------------------------------------------------------------------------|
| `Admin`   | Wildcard. Every permission check returns true. Column in the matrix is locked + always checked.|
| `default` | Auto-assigned to every active member. Starts with **no** permissions; admin can grant some.   |

The `default` role is a backward-compat handle, not a magic
"everyone can do this" bucket. Granting it `firm.manage_roles` would
let every member create roles — usually not what you want.

The `User.isAdmin` boolean is gone. Admin-ness is membership in the
Admin role: `userRoles: { some: { role: { name: "Admin" } } }`.
**At least one active admin** is enforced by `countActiveAdmins()` —
any write that would leave the firm with zero is rejected.

---

## The matrix UI (`/settings/roles`)

Rendered by `PermissionsMatrix` (`src/components/settings/permissions-matrix.tsx`).

- **Y-axis:** every catalog permission, grouped by category. Sticky
  left column so labels stay visible while horizontally scrolling on
  small screens.
- **X-axis:** every role in the firm. Admin pinned to the leftmost
  column.
- **Intersection:** a checkbox.

### Locks

- **Admin column:** always checked + disabled. Toggling would no-op
  (the runtime treats Admin as a wildcard regardless of stored rows),
  and the server action refuses any write to the Admin role
  defensively.
- **Whole matrix when `canEdit=false`:** every cell is read-only. The
  page passes `canEdit` based on `currentUserHasPermission("firm.manage_permissions")`.

### Optimistic UI

Each click flips the checkbox immediately and fires
`setRolePermissionAction(roleId, key, granted)` in a transition. If
the server rejects, the local state reverts and an inline warning
shows. The action calls `revalidatePath("/settings/roles")` on
success so the next render reflects the canonical state.

### Audit trail

Every non-no-op grant or revoke writes an `ActivityLog` entry with
`matterId: null` (firm-scope), the actor's `userId`, a human-
readable title (`Granted "Send invoices" to Billing manager` /
`Revoked …`), and the raw permission key in `detail`. Duplicate
clicks (granting an already-granted permission) skip the log so
the audit doesn't fill with no-ops.

### Why `firm.manage_permissions` is its own key

It's separate from `firm.manage_roles` (create/rename/delete) because
granting permissions is a higher-trust act than naming roles. The
matrix shows the cell for `firm.manage_permissions` itself like any
other cell — but the page-level check
(`currentUserHasPermission("firm.manage_permissions")`) is what
controls whether the user can toggle anything at all. So a
non-admin who somehow doesn't have it sees the matrix in read-only
mode, even if their other permissions would otherwise allow editing.

---

## Adding a new permission

Three-file change.

1. **Catalog.** Open `src/lib/permissions.ts`, find the right
   category (or add one), append a `PermissionEntry`:

   ```ts
   {
     key: "matters.expense.create",
     label: "Add expenses to a matter",
     description: "Log filing fees, expert costs, travel, etc.",
   },
   ```

2. **Wire the gate.** In the action that performs the capability:

   ```ts
   await requirePermission("matters.expense.create");
   ```

   In the page that surfaces it:

   ```ts
   const canCreate = await currentUserHasPermission("matters.expense.create");
   {canCreate && <NewExpenseButton />}
   ```

3. **Done.** The matrix UI picks up the new key automatically — no
   migration, no seed update. Admin gets it for free (wildcard).
   Other roles default to no, admins toggle on per-role via the
   matrix.

### Removing a permission

Delete the entry from the catalog. Existing `RolePermission` rows
that reference the dropped key sit harmlessly — `isKnownPermission()`
returns false on writes (so the UI can't grant it), and the matrix
read filters by catalog membership so the dropped key just stops
appearing. A periodic prune is fine but not required.

### Renaming a permission

Don't. It's a key change, not a label change. Pick a new key, dual-
write callers during the transition, then drop the old key from the
catalog. The label is independent — change that any time.

---

## Adding a new gated feature

The opinionated default playbook for any new feature:

1. **List every distinct capability** before writing code. Don't
   stop at "manage" — split add / edit / delete / archive / view
   per the granular-permissions guideline.
2. **Add a key per capability** to the catalog. Keep them under a
   shared category prefix.
3. **Wire `requirePermission(key)` at every write entry point** —
   server actions, mutation routes, anywhere a write originates.
4. **Wire `currentUserHasPermission(key)` for read affordances** —
   buttons, kebab items, edit-vs-read views, conditional sections.
5. **Hide nav items entirely** for users who can't do *anything* in
   the feature. Use `currentUserHasAnyPermission([...])` if there
   are multiple capabilities the nav item could light up for.

Worked example — adding an expense-tracking feature:

```text
Catalog additions:
  matters.expense.view
  matters.expense.create
  matters.expense.edit
  matters.expense.delete
  matters.expense.mark_billable      // higher-trust action

Wiring:
  Server actions   → requirePermission(<exact key per action>)
  Tab visibility   → currentUserHasAnyPermission([view, create, edit])
  "Add" button     → currentUserHasPermission("matters.expense.create")
  Per-row delete   → currentUserHasPermission("matters.expense.delete")
  "Mark billable"  → currentUserHasPermission("matters.expense.mark_billable")
```

The granularity might feel like overkill on day one. It pays off the
first time a firm asks "can our paralegal log expenses but not edit
them after they're approved?" — the answer is "yes, just toggle two
boxes."

---

## Edge cases

- **Inactive user.** `User.isActive = false` returns no permissions
  (Admin or otherwise). The session validator in `src/auth.ts` also
  invalidates their JWT on the next request, so this is belt + suspenders.
- **Stale matrix grant after a permission is removed.** The row sits
  there harmlessly. `isKnownPermission()` filters writes; reads union
  the matrix into `granted: Set<string>` and runtime checks just
  return false for keys that aren't actually queried anywhere.
- **Tampered form.** Permission writes (`setRolePermissionAction`)
  validate the key against `isKnownPermission()` and refuse to mutate
  the Admin role. Action gates re-check on every call regardless of
  what the UI showed.
- **Last-admin invariant.** Removing the Admin role from a user, or
  deactivating an admin, is rejected when it would leave the firm
  with zero active admins. Enforced by `countActiveAdmins()` in
  `src/lib/queries/team.ts`.
- **Multi-tenant, future.** Roles + RolePermissions are firm-scoped
  via `Role.firmId`. The session callback in `src/auth.ts` already
  threads `firmId` through; when we go multi-tenant the
  permission-check helpers need no changes.

---

## What's NOT yet in the system

- **Per-user permissions.** Roles only. If a single user needs an
  unusual capability, give them a role for it.
- **Per-matter / per-resource permissions.** "User X can see Matter Y
  but not Matter Z" is governed by `MatterTeamMember` membership
  today, not by the permission system. Resource-scoped permissions
  could layer on later (probably as `MatterPermission` rows or as
  permission-keys-with-resource-arguments) but we don't need them yet.
- **Time-bound grants.** No expiry on `RolePermission`. If we ever
  need "until end of quarter" grants, add `expiresAt` and filter at
  read time.
- **Deny rules.** Pure additive set-union model. If you need to
  remove a capability from someone, take them out of the role.

---

## File index

| File                                                              | Role                                                            |
|-------------------------------------------------------------------|-----------------------------------------------------------------|
| `prisma/schema.prisma`                                            | `Role`, `UserRole`, `RolePermission` definitions                |
| `src/lib/permissions.ts`                                          | Static catalog + helpers (`PERMISSION_KEYS`, `isKnownPermission`)|
| `src/lib/permission-check.ts`                                     | Runtime helpers (`currentUserHasPermission`, `requirePermission`, etc.) |
| `src/lib/firm.ts`                                                 | `requireAdmin` / `isCurrentUserAdmin` (admin-as-concept)        |
| `src/lib/role-constants.ts`                                       | `ADMIN_ROLE_NAME` / `DEFAULT_ROLE_NAME`                         |
| `src/app/actions/roles.ts`                                        | Role CRUD + `setRolePermissionAction`                           |
| `src/lib/queries/team.ts`                                         | `listFirmRoles`, `listRolePermissionGrants`, `countActiveAdmins`|
| `src/app/(dashboard)/settings/roles/page.tsx`                     | Matrix page                                                     |
| `src/components/settings/permissions-matrix.tsx`                  | Matrix UI                                                       |
| `src/components/settings/role-row.tsx`                            | Role list row (rename / delete kebab)                           |

---

## Change log

| Date       | Change                                                                                              |
|------------|-----------------------------------------------------------------------------------------------------|
| 2026-04-25 | Replaced `User.isAdmin` boolean with `Role` + `UserRole` membership in the Admin role.              |
| 2026-04-27 | Added `RolePermission` join + matrix UI on `/settings/roles`. Catalog seeded.                       |
| 2026-04-27 | Replaced every `requireAdmin()` write gate with `requirePermission(<specific-key>)`. Admin retained as wildcard. |
| 2026-04-27 | `setRolePermissionAction` writes an `ActivityLog` entry on every non-no-op grant/revoke. Firm-scope (`matterId: null`). |
| 2026-07-06 | Removed the hand-maintained "Categories today" table (it had drifted to cover 6 of 13 categories). The doc now points at `src/lib/permissions.ts` as the sole enumeration. |
