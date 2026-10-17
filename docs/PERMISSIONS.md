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

Every server action and page guard funnels through the helpers in
`src/lib/permission-check.ts`: `requirePermission(key)` (throws a
redirect on fail), `requirePermissionResult(key)` (returns the denial
as a value), `requirePermissions(keys)` (multi-key) or
`currentUserHasPermission(key)` (returns boolean). Admin always
passes.

**Permissions are capability keys, not data scopes.** A key says what
a user may *do*; it does not say which matters they may see. See
[Matter visibility](#matter-visibility-today-and-planned) below, which
states plainly what is and is not restricted today.

---

## Page and layout guards

A layout is **not** an auth gate: Next renders a page on partial (RSC)
navigations without re-running its parent layouts, and `src/proxy.ts`
only checks that a session cookie exists. So every `page.tsx` and
`layout.tsx` under `src/app/(dashboard)` and `src/app/print` must call
a guard as the **first `await`** of its default export, before reading
any data:

- `requireUser()` (`src/lib/current-user.ts`) - session only; use when
  the page has no finer permission key.
- `requirePermission(key)` / `requireAdmin()` - session plus a key / the Admin role.
- `getCurrentUserId()` - also redirects, but prefer `requireUser()` for readability.

`/matters/new` is a stronger-guard example: it calls
`requirePermission("matters.create")` first.

`currentUserHasPermission` is a read-side flag, not a guard. Guards
redirect by throwing, so never wrap them in try/catch.
`src/app/page-guards.test.ts` enforces this by source scan, with a
commented allowlist for pages owned by packages that have not landed
their guard yet. See ADR-028 in [DECISIONS.md](./DECISIONS.md).

---

## Matter visibility (today and planned)

**Today there is no matter-level read restriction.** Every signed-in,
active user, including one whose only role is the zero-permission
`default` role, can list, open, search, download and export every
matter and everything attached to it: notes (including strategy
memos), documents, invoices, the trust ledger and time narratives. The
matter detail layout, its tabs, the Billing tab and
`/print/invoices/[id]` all guard with `requireUser()` only (there is no
billing "view" key and no team-membership filter on reads). Permission
keys gate *actions* and a few sensitive read-side slices (below), not
which matters a user can open.

`MatterTeamMember` does **not** restrict reads. It drives assignment
pickers, notifications, calendar-detail unlocks (`canViewEventDetails`),
auto-attendees on events, and the lead filter. Do not describe team
membership as a visibility gate anywhere.

Two things *are* scoped per user today, but neither is team-based:

- **Email** is mailbox-personal. A thread belongs to the
  `EmailAccount` that synced it and is visible only to that account's
  owner, even after it is filed to a matter and even to Admins. Every
  email query and email-derived action (file/unfile, spawn
  task/deadline/note, log time, search, badges, attachment download)
  must use `visibleEmailThreadWhere` / `visibleEmailMessageWhere` from
  `src/lib/email-visibility.ts` rather than re-deriving the scope.
- **Calendar event detail** is shown or replaced by "Busy" per event via
  `canViewEventDetails`; labels that reference an event elsewhere (e.g.
  the matter Events tab) use the same scrub (ADR-021).

### Planned (NOT built): matter-team access / ethical walls

Design draft: `out/sweep/MATTER_ACCESS_DESIGN.md` (a working note, not
shipped). No code implements any of this yet: there is no
`src/lib/matter-access.ts`, no firm-level visibility setting, and
`matters.view_all` is **not** in the permission catalog. The planned
rule, decided 2026-10-16:

- A user sees a matter, and everything attached, if they are an active
  team member, hold a grantable `matters.view_all` key (Admins
  implicitly), or the firm-level switch is still on "Everyone".
- The switch lives in Settings, Firm and starts at "Everyone"; an admin
  flips it to "Team only" after fixing rosters (a "thin teams" list
  helps). Hidden matters read as missing (404, not 403). Writes require
  the same access on top of their existing key.
- Events on inaccessible matters show as "Busy" (the existing scrub).

Until that lands, treat every matter as readable by every staff
member. See docs/DECISIONS.md for the recorded decision.

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
  unwired?: boolean;    // catalogued but not enforced anywhere yet
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

### Unwired keys

`PermissionEntry.unwired` marks keys that are catalogued (so they can
be granted ahead of time) but not enforced by any action or page yet.
The matrix shows "Not enforced yet" on them. Today that is
`matters.archive` and `matters.delete` (reserved for the Matter
Actions menu). Remove the flag in the same change that wires the gate.

### Keys that gate more than one surface

- `matters.manage_team` gates `addMatterTeamMember` **and** changing the
  lead attorney from the matter edit form (`updateMatter` returns a
  field error otherwise; the form locks the field). A save that leaves
  the lead unchanged or omits it needs only `matters.edit`.
- `billing.apply_trust` gates sendInvoice's apply-trust leg **and**
  `recordInvoicePayment` with `source=trust`. A role with only
  `billing.record_payment` is refused trust payments until granted
  `apply_trust`.
- `billing.generate_invoice` gates generating/bundling invoices **and**
  `updateInvoiceLineItem` (line-item pricing/edits).
- `documents.template.edit` also governs archiving and restoring a
  template (deliberate, per the action docstring);
  `documents.template.delete` is permanent removal only.
- `matters.settlement.approve` covers every settlement status change
  (approve, disburse, close, reopen) and stage transitions through
  `upsertSettlement`, plus changing amounts on a fully approved
  settlement (which also resets its sign-offs).
  `matters.settlement.edit` alone cannot change status. Settlement
  step notifications go only to `matters.settlement.view` holders.
  `matters.settlement.manage_liens` has per-row edit/delete UI on the
  billing Settlement card (hidden once disbursed or closed).
- `intake.decline` gates declining a lead (`leads.ts`); converting a
  lead needs `matters.create`. The Decline/Convert buttons are hidden
  without the key. Existing roles do not have `intake.decline` until an
  admin ticks it in `/settings/roles` (no backfill was done).

### Cross-key gates worth knowing

- **`parties.edit` + `contacts.edit`** — the Parties-tab edit form
  (`updateMatterContact`) can also rewrite the firm-wide `Contact`
  (name, email, organization, phones), which flows to every matter.
  `parties.edit` alone only covers the per-matter row (role, notes,
  representation). When a submit actually changes a contact field the
  action additionally requires `contacts.edit`; otherwise it returns a
  field error and writes nothing. The form renders those inputs
  read-only for users without `contacts.edit`. The Parties tab
  controls themselves follow `parties.create` / `.edit` / `.delete`.
- **Contacts** - `contacts.merge` gates merge and the merge-candidate
  search; `contacts.delete` gates deactivate and reactivate. Merge
  appends the loser's `Contact.notes` and carries the conflict flag.

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

All helpers are in `src/lib/permission-check.ts` (server-only).

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

### Inline-form guard (`requirePermissionResult`)

```ts
const gate = await requirePermissionResult("firm.edit_info");
if (!gate.ok) return { error: gate.error };
```

The non-redirecting twin of `requirePermission`. Use it for actions
called from an inline form, toggle or menu item that can render a
message: denial returns `{ ok: false, error }` instead of navigating to
`/`, so the user sees why nothing happened. It still redirects to
`/login` with no session. Use `requirePermission` for page-level gates
and actions that rely on the redirect. The team, roles, firm and
matrix-toggle actions use `requirePermissionResult`.

### Multi-key guard (`requirePermissions`)

```ts
import { requirePermissions } from "@/lib/permission-check";

await requirePermissions(["tasks.create", "events.create"]);
```

Requires EVERY key (empty list passes; Admin always passes), resolving
grants once and bouncing to `/` on the first missing key. Use it when
one request creates several record kinds, and call it BEFORE the first
write.

### Captures and notes: per-kind create gates

A note or primary capture (task / event / deadline / time entry) can
carry "sibling" captures that create further records. **Siblings do not
inherit the primary's gate** (ADR-025): every record kind must clear
its own create key, whichever surface carried it.

| Kind created | Key |
|---|---|
| task | `tasks.create` |
| event | `events.create` |
| deadline | `deadlines.create` |
| time entry | `time_entries.create` |
| note (sibling or primary) | `notes.create` |
| pinned note / pinned sibling note | `notes.pin` (in addition to `notes.create`) |

The required set is computed from the capture list by
`requiredCapturePermissions` (`src/lib/capture-permissions.ts`, pure and
unit-tested) and enforced with `requirePermissions` before any write in
`createNote` (`notes.ts`), the primary composers (`captures.ts`) and the
bulk-attach action (`note-attachments.ts`, which ignores `note_sibling`).
Pinning at create time needs `notes.pin` exactly like toggling a pin
later; the Pin toggle in `NoteComposer` is hidden without it (`canPin`).

### Read-side flags that hide controls

Hidden affordances must mirror the action gate, driven by
`currentUserHasPermission` flags resolved on the server:

- Notes tab and composers: `getNoteAccess()` (`src/lib/note-access.ts`)
  maps `notes.create`, `notes.pin`, `notes.delete_any`, `tasks.create`,
  `tasks.delete`, `deadlines.create`, `deadlines.delete`,
  `time_entries.create`, `time_entries.delete_any` and `events.create`
  to booleans passed to client components.
- Matter Create menu, Notes/Events composers: per-entity create keys
  (`MATTER_CREATE_PERMISSION` in `src/lib/matter-create-types.ts`),
  `notes.create`, `events.create`; the New matter button needs
  `matters.create`.
- Communication readers: Save as note, Create task, Create deadline,
  Log time and File to matter need `notes.create`, `tasks.create`,
  `deadlines.create`, `time_entries.create` and
  `communication.file_email` (`comm-action-permissions.ts`).
- Billing tab: `generate_invoice` (generate, bundle, line-item edit),
  `approve_invoice` (Approve, Mark recorded), `send_invoice`,
  `record_payment`, `apply_trust` (Apply trust, together with
  `record_payment`), `void_invoice`, `delete_draft`, and
  `trust.record_transaction` for the trust ledger form.

### Deleting a note that has replies

`deleteNote` cascades to every reply (any depth). The author-may-delete
rule covers the author's own words only: if anyone **else** replied, the
delete also destroys their content, so it requires `notes.delete_any`
even for the author. Non-authors always need `notes.delete_any`.

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
**At least one active admin** is enforced in `updateFirmMember`
(`src/app/actions/team.ts`): a Serializable in-transaction recount
throws `LastActiveAdminError` when a write would leave the firm with
zero, and a serialization failure (P2034) from a concurrent team edit
is mapped to a retry message.

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

### Admin-only permissions and the escalation invariant

`ADMIN_ONLY_PERMISSIONS` (`src/lib/permissions.ts`; the matrix UI and
the server share it) lists permissions that govern access to access
itself: `firm.manage_permissions`, `firm.manage_roles` and
`firm.manage_team_directory`. Only an Admin may grant or revoke them
(`setRolePermissionAction` refuses a non-Admin, and the matrix renders
those cells locked).

`firm.manage_team_directory` is delegable (e.g. to an office manager)
but must not become an escalation path, so `src/app/actions/team.ts`
enforces invariant 5 server-side with `isCurrentUserAdmin()`: a
non-Admin caller may not grant or remove the Admin role, or any role
carrying an ADMIN_ONLY permission, on anyone (themselves included);
may not invite a user with such a role; may not edit, deactivate or
reactivate an Admin, nor deactivate or reset the password of / unlock
sign-in for any holder of such a role. Hiding the checkbox in the UI is
convenience only.

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
6. **Guard the page.** Every new `page.tsx` / `layout.tsx` calls
   `requireUser()` (or a stronger `requirePermission` / `requireAdmin`)
   as its first `await`; a layout does not protect its pages.
   `src/app/page-guards.test.ts` fails the build otherwise (see Page
   and layout guards).
7. **Mirror the gate in the UI.** Hide the control behind the same
   key the action enforces, and cover the denial with a test.

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
  with zero active admins. Enforced by the in-transaction recount in
  `updateFirmMember` (`src/app/actions/team.ts`).
- **Multi-tenant, future.** Roles + RolePermissions are firm-scoped
  via `Role.firmId`. The session callback in `src/auth.ts` already
  threads `firmId` through; when we go multi-tenant the
  permission-check helpers need no changes.

---

## What's NOT yet in the system

- **Per-user permissions.** Roles only. If a single user needs an
  unusual capability, give them a role for it.
- **Per-matter / per-resource visibility.** "User X can see Matter Y
  but not Matter Z" is not supported today: all matters are readable
  by all staff (see Matter visibility above). Team-based access
  (ethical walls) is a planned phase, not built.
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
| `src/lib/permission-check.ts`                                     | Runtime helpers (`currentUserHasPermission`, `requirePermission`, `requirePermissions`, etc.) |
| `src/lib/email-visibility.ts`                                     | `visibleEmailThreadWhere` / `visibleEmailMessageWhere` (mailbox-personal scope) |
| `src/lib/note-access.ts`                                          | `getNoteAccess` (Notes-surface control flags)                   |
| `src/lib/capture-permissions.ts`                                  | Kind to create-key map + `requiredCapturePermissions` for captures/notes |
| `src/lib/current-user.ts`                                         | `getCurrentUserId` / `requireUser` (session guards for pages)   |
| `src/lib/firm.ts`                                                 | `requireAdmin` / `isCurrentUserAdmin` (admin-as-concept)        |
| `src/lib/role-constants.ts`                                       | `ADMIN_ROLE_NAME` / `DEFAULT_ROLE_NAME`                         |
| `src/app/actions/roles.ts`                                        | Role CRUD + `setRolePermissionAction`                           |
| `src/lib/queries/team.ts`                                         | `listFirmRoles`, `listRolePermissionGrants`, `getPrivilegedRoleIds`|
| `src/app/(dashboard)/settings/roles/page.tsx`                     | Matrix page                                                     |
| `src/components/settings/permissions-matrix.tsx`                  | Matrix UI                                                       |
| `src/components/settings/role-row.tsx`                            | Role list row (rename / delete kebab)                           |

---

## Read-side gates on matter tabs

Beyond page-level keys, some matter data is filtered per viewer inside the query (see ADR-021 in `DECISIONS.md`):

- **Events tab / event labels** — calendar event visibility (`canViewEventDetails`), not a permission key: events the viewer can't see are "Busy".
- **Timeline** — settlement rows need `matters.settlement.view`, expense rows need `matters.expense.view`; without them the rows are omitted, not redacted (`activityMoneyFilters` in `src/lib/queries/matter-detail.ts`).
- **Dashboard** — Firm pulse and the Trust balance KPI need `reports.view`. Recent activity omits settlement rows without `matters.settlement.view`, `Expense ...` rows without `matters.expense.view`, and firm-scope (`matterId` null) rows without `firm.view_activity`. Pinned by `src/lib/queries/dashboard-privacy.test.ts`.
- **Email** — mailbox-personal; see Matter visibility.
- **Evidence flags** — `edit_any` rewrites of another reviewer's flag are audited.

---

## Change log

| Date       | Change                                                                                              |
|------------|-----------------------------------------------------------------------------------------------------|
| 2026-04-25 | Replaced `User.isAdmin` boolean with `Role` + `UserRole` membership in the Admin role.              |
| 2026-04-27 | Added `RolePermission` join + matrix UI on `/settings/roles`. Catalog seeded.                       |
| 2026-04-27 | Replaced every `requireAdmin()` write gate with `requirePermission(<specific-key>)`. Admin retained as wildcard. |
| 2026-04-27 | `setRolePermissionAction` writes an `ActivityLog` entry on every non-no-op grant/revoke. Firm-scope (`matterId: null`). |
| 2026-07-06 | Removed the hand-maintained "Categories today" table (it had drifted to cover 6 of 13 categories). The doc now points at `src/lib/permissions.ts` as the sole enumeration. |
| 2026-07-07 | Feature-batch keys: new `contacts` category (`create`/`edit`/`delete`/`merge` — closes the TODO(permissions) in contacts.ts), `communication.edit_call`/`delete_call` (manual call logs only; provider items immutable), `documents.template.{create,edit,delete}` (library governance; generating FROM a template is ungated, saving output rides `documents.upload`). Grant to non-admin roles via /settings/roles. |
| 2026-07-07 | New `reports` category with a single `reports.view` key — the /reports dashboard exposes firm-wide financials + workload (AR aging, utilization, realization), so it's gated separately from the personal dashboard rather than riding an existing firm.* key. |
| 2026-07-07 | Document file system keys wired: `documents.folder.create` / `documents.folder.edit` (rename) / `documents.folder.delete` (delete re-parents contents up a level — never deletes files) gate the folder tree's structure; `documents.organize` gates re-filing ("Move to…" on documents AND folders) as its own key because organizing is often delegated to staff who shouldn't hold upload/delete. Server actions in `src/app/actions/document-folders.ts`; read-side flags drive the browser affordances on the matter Documents tab. |
| 2026-07-07 | Evidence review keys wired: `evidence.flag.create` gates "Flag this moment" on media in the document viewer; `evidence.flag.edit_any` / `evidence.flag.delete_any` cross ownership on other reviewers' flags — creators always edit/delete their OWN flags without any key (same ownership pattern as `notes.edit_any`/`notes.delete_any`). Server actions in `src/app/actions/flagged-moments.ts`; read-side flags drive the composer button + rail kebabs. |
| 2026-10-16 | New `automations` category (ADR-019): `automations.view` (Settings → Automations), `automations.deadline_rule.{create,edit,delete}`, `automations.task_list.{create,edit,delete}` (edit covers items + archive), `automations.defaults.{create,delete}` (what applies automatically to new matters). Applying a rule/list to a matter rides `deadlines.create` / `tasks.create`. Grant to non-admin roles via /settings/roles. |
| 2026-10-16 | `firm.manage_team_directory` joined `ADMIN_ONLY_PERMISSIONS` (now exported from `src/lib/permissions.ts`); team.ts refuses non-Admin escalation (grant/remove Admin, invite Admin, edit/deactivate an Admin, reset/unlock an Admin-class account). `intake.decline` added to the catalog. Role create/rename/delete and permission flips write `type: "auth"` activity entries. |
| 2026-10-16 | Captures and notes enforce per-kind create gates (siblings no longer inherit the primary's gate, ADR-025): `requirePermissions` + `requiredCapturePermissions`; pinning at create needs `notes.pin`; deleting a note others replied to needs `notes.delete_any`; note edit/pin/delete write activity entries. No new keys. |
| 2026-10-16 | Added `requireUser()` and the "Page and layout guards" rule (ADR-028): every page/layout self-authenticates; `/matters/new` now requires `matters.create`. No new permission keys. |
| 2026-10-17 | Doc sweep to match the code: matter-visibility truth (no read restriction; `MatterTeamMember` is not a gate; ethical walls planned, not built), `requirePermissionResult`, `PermissionEntry.unwired`, last-admin invariant now an in-transaction recount, cross-key gates (`apply_trust`, `generate_invoice`, settlement approve, `contacts.edit` with `parties.edit`, `matters.manage_team` for lead change, `intake.decline`), read-side control flags, dashboard/timeline money-row gating. No new keys. |
