# Permissions

How LawCRM decides who can do what, plus the "I'm wiring a new gate, what do I do?" playbook. If a code path conflicts with what's written here, the code is wrong.

## TL;DR

A user's effective permissions =

- `*` (all) if they hold the **Admin** role, OR
- the **set union** of every `RolePermission` row on every role they hold.

The catalog of permission keys is **app-defined** (`src/lib/permissions.ts`). The grants are **firm-defined** (admins toggle them in the matrix on `/settings/roles`). Inactive users get nothing.

Every server action and page guard funnels through `src/lib/permission-check.ts`: `requirePermission(key)` (redirects on fail), `requirePermissionResult(key)` (returns the denial as a value), `requirePermissions(keys)` (multi-key), `currentUserHasPermission(key)` / `currentUserHasAnyPermission(keys)` (booleans), `getCurrentUserPermissions()` (bulk: `{ isAdmin, granted }`).

**Permissions are capability keys, not data scopes.** A key says what a user may _do_, not which matters they may see. See [Matter access](#matter-access-ethical-walls).

---

## Page and layout guards

A layout is **not** an auth gate: Next renders a page on partial (RSC) navigations without re-running its parent layouts, and `src/proxy.ts` only checks for a verified Clerk session (not that the user is an active firm member). So every `page.tsx` and `layout.tsx` under `src/app/(dashboard)` and `src/app/print` must call a guard as the **first `await`** of its default export, before reading any data:

- `requireUser()` (`src/lib/current-user.ts`): session only; use when the page has no finer key.
- `requirePermission(key)` / `requireAdmin()`: session plus a key / the Admin role.
- `getCurrentUserId()` also redirects, but prefer `requireUser()` for readability.

`currentUserHasPermission` is a read-side flag, not a guard. Guards redirect by throwing, so never wrap them in try/catch. `src/app/page-guards.test.ts` enforces this by source scan, with a commented allowlist for pages owned by packages that have not landed their guard yet (ADR-028, [decisions/028-layouts-are-not-auth-gates-every-page.md](./decisions/028-layouts-are-not-auth-gates-every-page.md)).

---

## Matter access (ethical walls)

A user can see a matter, and everything attached to it (notes, documents, time incl. privileged narratives, expenses, invoices, trust, deadlines, tasks, events, parties, activity), when ANY of:

1. they are an **active** `MatterTeamMember` (`removedAt = null`);
2. they hold **`matters.view_all`** (Admins implicitly);
3. the firm's `matterVisibility` is `FIRM` (the default, "Everyone") AND the matter is not **restricted** (`Matter.restricted`, toggled with `matters.restrict` on the edit page or inherited from a restricted lead; ADR-049).

An Admin flips the firm to `TEAM` ("Team only") in Settings, Firm (admin-only, not a delegable key; logged). The same page lists "thin teams" (open matters with no active member, or only the lead) so rosters can be fixed first. **Before flipping, grant `matters.view_all` to roles that need firm-wide reach (billing, office manager, reception).**

Hidden == missing: pages call `notFound()` (404) and routes return 404, never 403. Seeing is the precondition for doing: every matter-scoped server action asserts the same access after its permission key.

Helpers (`src/lib/matter-access.ts`, ADR-039):

| Need                                     | Use                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| list / count / aggregate matters         | `matterAccessWhere(userId)` spread into the `Matter` where                                                                                 |
| child list with required matter          | `matterRelationAccessWhere(userId)`                                                                                                        |
| child list with nullable matter          | `optionalMatterAccessWhere` / `optionalMatterAccessClause`                                                                                 |
| child list with nullable matter AND lead | `optionalRecordAccessClause` (Note, Task, CalendarEvent, TimeEntry, Document, RecordsRequest, ActivityLog; a row with both ids needs both) |
| already-loaded row with matterId/leadId  | `assertRecordAccess(row)`                                                                                                                  |
| page or action with a matterId           | `assertMatterAccess(matterId)` (`assertOptionalMatterAccess` if nullable)                                                                  |
| action with a child id                   | `assertChildMatterAccess(kind, id)` (routes lead children to the lead wall)                                                                |
| boolean checks                           | `canAccessMatter(userId, matterId)`, `filterAccessibleMatterIds`                                                                           |

Enforcement tests: `src/app/page-guards.test.ts` (every `matters/[id]` page and layout asserts), `src/app/actions/matter-access-guards.test.ts` (every action taking a matter/child id asserts; commented allowlist), plus two-user integration tests.

Per-surface rules:

- **Calendar**: events on inaccessible matters render as "Busy" (`matterAccessible` input to `canViewEventDetails`; the creator still sees their own event). A viewer who only sees an event as Busy cannot move, resize, edit or delete a private event or an event on a hidden matter (`viewerMayTouchLoadedEvent`, enforced in `actions/calendar-events.ts`; the UI offers drag only to editable ids).
- **Privileged time narratives** are visible to anyone with access to the matter (search included) and to nobody else.
- **Trust column** in the matters list/kanban, its sort and filter need `billing.view` (ADR-038).
- **Conflict checks** still scan every matter; hits on matters the viewer cannot access keep their severity but lose the matter name.
- **Email** remains mailbox-personal (`visibleEmailThreadWhere`, `src/lib/email-visibility.ts`); threads filed to a hidden matter are additionally hidden from non-access users.

## Intake access (restricted leads)

A lead is visible to every active user unless it is **restricted** (`Lead.restricted`). A restricted lead and everything on it is visible only to its team (`LeadTeamMember`), holders of **`intake.view_restricted`** (Admins implicitly), nobody else; inactive users see no lead. `intake.restrict` restricts / reopens a lead and manages its team. Conversion copies the flag and the team to the matter (ADR-049).

Helpers (`src/lib/lead-access.ts`): `leadAccessWhere(userId)` for lead lists and counts, `leadRelationAccessWhere` for a child with a `lead` relation, `assertLeadAccess(leadId)` on pages / actions (404), `canAccessLead` / `filterAccessibleLeadIds` for routes and batches. `assertScopeAccess`, `assertChildMatterAccess`, `assertRecordAccess` and `optionalRecordAccessClause` already route lead rows here.

Enforcement tests: `page-guards.test.ts` (every `intake/[id]` page and layout calls `assertLeadAccess` before any prisma read) and the lead rule in `matter-access-guards.test.ts` (every action that references a `leadId` calls a lead-aware helper). Events on hidden leads are Busy (`leadAccessible`). `reports.view` pipeline counts stay firm-wide.

### Other read-side gates (filtered per viewer inside the query; ADR-021)

- **Events tab / event labels**: `canViewEventDetails` (visibility), not a key; unseen events are "Busy".
- **Timeline**: settlement rows need `matters.settlement.view`, expense rows `matters.expense.view`, trust `deposit` rows `billing.view`; without them rows are omitted, not redacted (`activityMoneyFilters`, `src/lib/queries/matter-detail/activity.ts`).
- **Billing**: `billing.view` gates the matter Billing tab (page guard redirects to `/`; tab link hidden), `/print/invoices/[id]` and its metadata, and the Overview Trust balance / WIP facts (ADR-038). The migration granted it to every role already holding a `billing.*` or `trust.*` key.
- **Dashboard**: Firm pulse needs `reports.view`; the Trust balance KPI needs `reports.view` AND `billing.view`. Recent activity omits settlement rows without `matters.settlement.view`, trust deposit rows without `billing.view`, `Expense ...` rows without `matters.expense.view`, and firm-scope (`matterId` null) rows without `firm.view_activity`. Pinned by `src/lib/queries/dashboard-privacy.test.ts`.
- **Evidence flags**: `edit_any` rewrites of another reviewer's flag are audited.

---

## The mental model

| Concept    | Owner | Lives in                                    | Example                                     |
| ---------- | ----- | ------------------------------------------- | ------------------------------------------- |
| Permission | App   | `src/lib/permissions.ts` (static catalog)   | `"matters.manage_team"`                     |
| Role       | Firm  | `Role` table, scoped by `firmId`            | `"Admin"`, `"default"`, `"Billing manager"` |
| Grant      | Firm  | `RolePermission` join, set in the matrix UI | `Billing manager -> billing.send_invoice`   |

Adding a permission is a code change; you can't create one in the UI. Roles are firm-scoped (names don't collide across firms); two are seeded system roles (Admin, default) and locked. A user holds any number of roles via `UserRole` (composite PK `[userId, roleId]`, `assignedById` null for the seed path); effective permissions are the union of grants across them.

### Schema notes (`Role`, `UserRole`, `RolePermission`; see `prisma/schema.prisma`)

- `Role.name` is unique per firm; `"Admin"` and `"default"` are reserved; `isSystem` makes the UI refuse rename/delete.
- `RolePermission` has composite PK (roleId, permission); `permission` is a dotted key validated against the catalog at write time. Cascade on Role delete. **Unknown keys are tolerated on read** (if a key is dropped from the catalog, rows pinned to it sit harmlessly).
- **No `Permission` model** (app-defined, not firm data). **No rows for Admin**: the runtime treats `role.name === "Admin"` as a wildcard; materializing rows would need re-seeding on every catalog change and the matrix would special-case them anyway. **No per-user grants**: if one user needs an unusual permission, give them a role for it.

---

## The catalog (`src/lib/permissions.ts`)

Static, in-code, grouped by category for the matrix UI: `PERMISSION_CATEGORIES` (each `{ id, label, permissions: PermissionEntry[] }`; entry = `{ key, label, description, unwired? }`), plus derived `PERMISSION_KEYS`, `PERMISSION_KEYS_SET`, `isKnownPermission(key)`. **That file is the source of truth for the key list; this doc deliberately does not duplicate it** (a hand-maintained table once drifted to 54% incomplete; don't reintroduce one). Enumerate with `grep -E '^\s+id:' src/lib/permissions.ts` (categories) / `grep -E '^\s+key:'` (keys), or read the `/settings/roles` matrix, which renders the same catalog.

### Naming convention

Dotted keys `<category>.<verb_or_noun>`, lowercase snake_case after the dot. The prefix matches the category id so a key is self-locating (grep finds both the catalog entry and the runtime check).

### Granular keys per capability

**Split each capability into its own key.** Don't lump add/edit/delete under a single `manage_X`: a firm legitimately wants to delegate "add team members" to a senior paralegal but reserve "remove" for partners. Examples: `matters.team.view` / `.add` / `.remove`; `billing.invoice.draft` / `.approve` / `.send` / `.void` / `.record_payment` / `.apply_trust`.

The catalog still has some coarse `manage_*` keys (`matters.manage_team`, `firm.manage_team_directory`, `firm.manage_roles`, `firm.manage_practice_areas`) kept from the cutover off `requireAdmin()`. **New work must not add coarse keys**; refine existing ones as features are revisited.

### Unwired keys

`PermissionEntry.unwired` marks keys that are catalogued (grantable ahead of time) but not enforced anywhere. The matrix shows "Not enforced yet". Remove the flag in the same change that wires the gate (grep `unwired` in the catalog for the current set).

### Keys that gate more than one surface

- `matters.manage_team` gates `addMatterTeamMember`, extra team seats on `createMatter` (the lead alone needs only `matters.create`), **and** changing the lead attorney from the matter edit form (`updateMatter` returns a field error otherwise; the form locks the field). A save that leaves the lead unchanged or omits it needs only `matters.edit`.
- `matters.billing_type.edit` gates changing a matter's billing type after creation (`updateMatter` rejects a changed value without it; the edit form shows the type read-only). Choosing the type at creation needs only `matters.create`, limited to the practice area's allowed list (ADR-060).
- `billing.apply_trust` gates sendInvoice's apply-trust leg **and** `recordInvoicePayment` with `source=trust`. A role with only `billing.record_payment` is refused trust payments.
- `billing.generate_invoice` gates generating/bundling invoices **and** `updateInvoiceLineItem`.
- `billing.view` is a pure read gate (Billing tab, invoice print, trust KPI and deposit rows). Every billing action keeps its own key; action keys do not imply view, so grant both.
- `documents.template.edit` also governs archiving/restoring a template; `documents.template.delete` is permanent removal only. Template blocks use the same three keys. Generating FROM a template and previewing it both need `documents.upload` (preview never shows more than a user could generate; the dialog is hidden without it). `documents.edit` gates renaming / re-categorizing a document; metadata only, the file is never changed.
- `firm.edit_document_style` gates saving the firm house style and its logo (`/settings/documents` and `/api/document-style/logo`); viewing the page and generating letters need no extra key. Details: [features/documents.md](./features/documents.md).
- `documents.transcribe` (request or re-run a machine transcript of an audio/video document; the migration grants it to roles holding `documents.upload`), `documents.transcript.edit` (correct text, rename speakers; granted alongside transcribe) and `documents.transcript.delete` (granted to roles holding `documents.delete_any`). Reading a transcript needs only access to the document itself; there is no separate view key.
- `documents.folder.{create,edit,delete}` gate folder structure (delete re-parents contents, never deletes files). `documents.organize` gates re-filing ("Move to..." on documents AND folders) and "Copy to..." (`copyDocumentToFolder`), its own key because organizing is often delegated to staff who shouldn't hold upload/delete. `documents.upload` also gates the viewer's "Add attachments to documents" for older emails (`extractAttachments`); automatic extraction at upload rides the upload's authorization (ADR-043).
- `evidence.flag.create` gates "Flag this moment"; `evidence.flag.edit_any` / `.delete_any` cross ownership on others' flags. Creators always edit/delete their OWN flags without any key (same ownership pattern as `notes.edit_any` / `notes.delete_any`).
- `matters.settlement.approve` covers every settlement status change (approve, disburse, close, reopen) and stage transitions through `upsertSettlement`, plus changing amounts on a fully approved settlement (which resets its sign-offs). `matters.settlement.edit` alone cannot change status. Step notifications go only to `matters.settlement.view` holders. `matters.settlement.manage_liens` has per-row edit/delete UI on the billing Settlement card (hidden once disbursed or closed).
- `intake.create` gates the New intake form (`createLead`), the page and the queue button. `intake.decline` gates declining a lead (`leads.ts`); converting needs `matters.create`. Buttons hide without the key. New keys are not backfilled onto existing roles: an admin ticks them in `/settings/roles`.
- `communication.edit_call` / `.delete_call` apply to manual call logs only; provider items are immutable.
- `automations.*`: `automations.task_list.edit` covers items + archive; applying a rule/list to a matter rides `deadlines.create` / `tasks.create`.
- `records.*` (view/create/edit/delete) plus `records.types.manage` for the settings page.
- `reports.view` gates /reports (firm-wide financials + workload), deliberately separate from the personal dashboard.
- `contacts.merge` gates merge and the merge-candidate search; `contacts.delete` gates deactivate/reactivate.

### Cross-key gates

- **`venues.*`**: no view key. Picking a venue on the matter forms needs only `matters.create` / `matters.edit`; `/settings/venues` needs any one venues key, and `venues.add` also gates press-Enter-to-add in the venue picker on the matter forms.

- **`parties.edit` + `contacts.edit`**: the Parties-tab edit form (`updateMatterContact`) can also rewrite the firm-wide `Contact` (name, email, organization, phones), which flows to every matter. `parties.edit` alone covers only the per-matter row (role, notes, representation). When a submit actually changes a contact field the action additionally requires `contacts.edit`, else returns a field error and writes nothing; the form renders those inputs read-only without `contacts.edit`. Tab controls follow `parties.create` / `.edit` / `.delete`.

### Client portal (separate identity)

Portal clients are **not** users and hold no roles or keys: they sign in through their own identity (ADR-051) and see only matters with a live `PortalMatterAccess` row (`assertPortalMatterAccess`, `portalMatterWhere` in `src/lib/portal-access.ts`; every portal page calls `requirePortalIdentity` first, pinned by `portal-guards.test.ts`). Staff control of that access uses the `portal.*` keys in the catalog (view the Portal card, invite, revoke/disable); the migration granted them to roles holding `matters.edit`. Documents add `portal.share_documents` (share files and folders, hide files; the share UI also needs `portal.view`), `portal.add_requests`, `portal.edit_requests` (edit, send back, accept, cancel) and `portal.delete_requests`; `20261019183859_portal_documents` granted all four to roles holding `matters.edit`. Each action also asserts matter access (ADR-039), and identity-wide changes (disable, re-enable, email change, merging two contacts that both have portal identities) require access to every matter the identity has. `portal.revoke` also gates disable, which is a server action with no UI yet. Deactivating a contact (`contacts.delete`) disables its portal identity and ends its sessions. Billing adds `portal.share_billing` (the per-matter billing switch and "send via portal"; it also needs `billing.view` plus matter access, and the migration granted it to holders of `billing.send_invoice`). Enabling the portal is the existing `firm.edit_info` key (Settings, Firm). Details: [features/client-portal.md](./features/client-portal.md).

---

## Resolution rules (runtime)

`src/lib/permission-check.ts` is the single chokepoint. The resolver runs once per request (React `cache()`, so a page guard and the action it triggers hit the DB once; changes show on the next request) and returns `{ isAdmin, granted: Set<string> }` where `granted` is the union of `RolePermission.permission` across roles, EXCLUDING Admin (wildcard, not materialized). Check order: inactive user -> nothing (Admin or not); Admin -> everything; else `granted.has(key)`.

**Unions, not precedence, no deny rules**: to remove a capability from someone, take them out of the role that grants it. Simplest model that covers every observed use case.

---

## API: how you call it

Read-side flag (component/page): `await currentUserHasPermission("firm.edit_info")` -> boolean; use for any `canEdit` / `canDelete` flag.

Nav visibility: `currentUserHasAnyPermission([...])` lights an item when the user can do anything in the area.

Bulk: `getCurrentUserPermissions()` -> `{ isAdmin, granted }` (pass `Array.from(granted)` to a client component deciding several things; the settings sidebar does this).

Write path: `await requirePermission("foo.delete")` first in the action. Throws `redirect("/")` on failure; returns the userId.

**Inline forms (`requirePermissionResult`)**: the non-redirecting twin. Use it for actions called from an inline form, toggle or menu item that can render a message: denial returns `{ ok: false, error }` so the user sees why nothing happened (it still redirects to `/login` with no session). Use `requirePermission` for page-level gates and actions that rely on the redirect. Team, roles, firm and matrix-toggle actions use `requirePermissionResult`.

**Multi-key (`requirePermissions`)**: requires EVERY key (empty list passes; Admin always passes), resolves grants once and bounces to `/` on the first missing key. Use it when one request creates several record kinds, and call it BEFORE the first write.

### Captures and notes: per-kind create gates

A note or primary capture (task / event / deadline / time entry) can carry "sibling" captures that create further records. **Siblings do not inherit the primary's gate** (ADR-025): every kind must clear its own create key.

| Kind created                      | Key                                         |
| --------------------------------- | ------------------------------------------- |
| task                              | `tasks.create`                              |
| event                             | `events.create`                             |
| deadline                          | `deadlines.create`                          |
| time entry                        | `time_entries.create`                       |
| note (sibling or primary)         | `notes.create`                              |
| pinned note / pinned sibling note | `notes.pin` (in addition to `notes.create`) |

The set is computed by `requiredCapturePermissions` (`src/lib/capture-permissions.ts`, pure, unit-tested) and enforced with `requirePermissions` before any write in `createNote` (`notes.ts`), the primary composers (`captures.ts`) and the bulk-attach action (`note-attachments.ts`, which ignores `note_sibling`). Pinning at create needs `notes.pin` exactly like toggling later; the Pin toggle in `NoteComposer` is hidden without it (`canPin`).

### Deleting a note that has replies

`deleteNote` cascades to every reply. The author-may-delete rule covers the author's own words only: if anyone **else** replied, deletion also destroys their content, so it requires `notes.delete_any` even for the author. Non-authors always need `notes.delete_any`.

### Read-side flags that hide controls

Hidden affordances must mirror the action gate, driven by server-resolved `currentUserHasPermission` flags:

- Notes tab and composers: `getNoteAccess()` (`src/lib/note-access.ts`) maps `notes.create`, `notes.pin`, `notes.delete_any`, `tasks.create`/`.delete`, `deadlines.create`/`.delete`, `time_entries.create`/`.delete_any`, `events.create` to booleans for client components.
- Matter Create menu, Notes/Events composers: per-entity create keys (`MATTER_CREATE_PERMISSION`, `src/lib/matter-create-types.ts`); New matter button needs `matters.create`.
- Communication readers: Save as note, Create task, Create deadline, Log time, File to matter need `notes.create`, `tasks.create`, `deadlines.create`, `time_entries.create`, `communication.file_email` (`src/components/communication/comm-action-permissions.ts`).
- Billing tab: `generate_invoice` (generate, bundle, line-item edit), `approve_invoice` (Approve, Mark recorded), `send_invoice`, `record_payment`, `apply_trust` (Apply trust, together with `record_payment`), `void_invoice`, `delete_draft`, and `trust.record_transaction` for the trust ledger form.

### `requireAdmin()` / `isCurrentUserAdmin()`

Admin-as-concept helpers in `src/lib/firm.ts`. Use them only when the gate is conceptually "admin-only" (something we never want to delegate). **Don't use them as a shortcut around defining a real permission**; if a role might legitimately want the capability, add a key.

---

## System roles

| Role      | Behavior                                                              |
| --------- | --------------------------------------------------------------------- |
| `Admin`   | Wildcard; matrix column locked + always checked.                      |
| `default` | Auto-assigned to every active member; starts with **no** permissions. |

`default` is a backward-compat handle, not an "everyone can do this" bucket; granting it `firm.manage_roles` would let every member create roles. Admin-ness is membership in the Admin role (`userRoles: { some: { role: { name: "Admin" } } }`); there is no `User.isAdmin`.

**At least one active admin** is enforced in `updateFirmMember` (`src/app/actions/team.ts`): a Serializable in-transaction recount throws `LastActiveAdminError` when a write (removing the Admin role, deactivating an admin) would leave zero; a serialization failure (P2034) from a concurrent team edit maps to a retry message.

---

## The matrix UI (`/settings/roles`)

`PermissionsMatrix` (`src/components/settings/permissions-matrix.tsx`): rows = catalog permissions by category (sticky left column), columns = firm roles (Admin pinned leftmost).

- **Admin column**: always checked + disabled; the server action also refuses any write to the Admin role.
- **Whole matrix read-only** when the page's `canEdit` (`currentUserHasPermission("firm.manage_permissions")`) is false. This page-level check controls whether anything can be toggled, regardless of other permissions.
- **Optimistic UI**: a click flips the checkbox and fires `setRolePermissionAction(roleId, key, granted)` in a transition; on rejection local state reverts with an inline warning; success calls `revalidatePath("/settings/roles")`.
- **Audit**: every non-no-op grant/revoke writes an `ActivityLog` entry (`matterId: null`, actor `userId`, readable title like `Granted "Send invoices" to Billing manager`, raw key in `detail`, type `auth`). Granting an already-granted permission skips the log.
- `firm.manage_permissions` is separate from `firm.manage_roles` (create/rename/delete) because granting permissions is a higher-trust act than naming roles.

### Admin-only permissions and the escalation invariant

`ADMIN_ONLY_PERMISSIONS` (`src/lib/permissions.ts`, shared by matrix UI and server) lists permissions that govern access to access itself (currently `firm.manage_permissions`, `firm.manage_roles`, `firm.manage_team_directory`). Only an Admin may grant or revoke them (`setRolePermissionAction` refuses a non-Admin; the matrix renders those cells locked).

`firm.manage_team_directory` is delegable (e.g. to an office manager) but must not become an escalation path, so `src/app/actions/team.ts` enforces server-side with `isCurrentUserAdmin()`: a non-Admin caller may not grant or remove the Admin role, or any role carrying an ADMIN_ONLY permission, on anyone (themselves included); may not invite a user with such a role; may not edit, deactivate or reactivate an Admin, nor deactivate, reset the password of, or unlock sign-in for any holder of such a role. Hiding the checkbox in the UI is convenience only.

---

## Adding a new permission

1. **Catalog**: add a `PermissionEntry` (`key`, `label`, `description`) to the right category in `src/lib/permissions.ts`.
2. **Wire the gate**: `await requirePermission("matters.expense.create")` in the action; `currentUserHasPermission(...)` in the page to hide the control.
3. Done: the matrix picks it up automatically (no migration, no seed; Admin gets it via wildcard; other roles default to no).

**Removing**: delete the catalog entry. Existing rows sit harmlessly (`isKnownPermission()` rejects writes, matrix reads filter by catalog membership); prune periodically if you like.

**Renaming**: don't. Pick a new key, dual-write callers during the transition, then drop the old key. The label can change any time.

## Adding a new gated feature (playbook)

1. **List every distinct capability** before writing code; split add / edit / delete / archive / view per the granular-keys rule.
2. **Add a key per capability** under a shared category prefix.
3. **`requirePermission(key)` at every write entry point** (server actions, anywhere a write originates).
4. **`currentUserHasPermission(key)` for read affordances** (buttons, kebab items, edit-vs-read views, conditional sections).
5. **Hide nav items entirely** for users who can't do anything in the feature (`currentUserHasAnyPermission([...])`).
6. **Guard the page**: every new `page.tsx` / `layout.tsx` calls `requireUser()` (or stronger) as its first `await`; `src/app/page-guards.test.ts` fails the build otherwise.
7. **Mirror the gate in the UI** (hide the control behind the same key the action enforces) and cover the denial with a test.

Example: an expense feature gets `matters.expense.view/create/edit/delete` plus a higher-trust `mark_billable`; each action calls `requirePermission(<its exact key>)`, the tab shows for `currentUserHasAnyPermission([view, create, edit])`, each button for its own key.

---

## Edge cases

- **Inactive user**: no permissions (Admin or otherwise); `getStaffAuth()` (`src/lib/staff-auth.ts`) resolves them to `no_access` on the next request, whatever their Clerk session says.
- **Tampered form**: `setRolePermissionAction` validates the key with `isKnownPermission()` and refuses to mutate Admin. Action gates re-check on every call regardless of the UI.
- **Multi-tenant, future**: roles/grants are firm-scoped via `Role.firmId`; `getStaffAuth()` is the single identity chokepoint where a `firmId` would attach, so the permission helpers need no change.

## Not in the system

- **Per-user permissions** (roles only). **Per-user matter exceptions** (matter access is team-based; no "deny user X on matter Y" list). **Time-bound grants** (add `expiresAt` and filter at read if ever needed). **Deny rules** (pure additive set-union).

---

## File index

| File                                                                                                            | Role                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/permissions.ts`                                                                                        | Static catalog + helpers, `ADMIN_ONLY_PERMISSIONS`                  |
| `src/lib/permission-check.ts`                                                                                   | Runtime helpers                                                     |
| `src/lib/matter-access.ts`                                                                                      | Matter-access helpers                                               |
| `src/lib/email-visibility.ts`                                                                                   | `visibleEmailThreadWhere` / `visibleEmailMessageWhere`              |
| `src/lib/note-access.ts`                                                                                        | `getNoteAccess`                                                     |
| `src/lib/capture-permissions.ts`                                                                                | `requiredCapturePermissions`                                        |
| `src/lib/current-user.ts`                                                                                       | `getCurrentUserId` / `requireUser`                                  |
| `src/lib/firm.ts`                                                                                               | `requireAdmin` / `isCurrentUserAdmin`                               |
| `src/lib/role-constants.ts`                                                                                     | `ADMIN_ROLE_NAME` / `DEFAULT_ROLE_NAME`                             |
| `src/app/actions/roles.ts`                                                                                      | Role CRUD + `setRolePermissionAction`                               |
| `src/app/actions/team.ts`                                                                                       | Team edits, escalation + last-admin invariants                      |
| `src/lib/queries/team.ts`                                                                                       | `listFirmRoles`, `listRolePermissionGrants`, `getPrivilegedRoleIds` |
| `src/app/(dashboard)/settings/roles/page.tsx`, `src/components/settings/permissions-matrix.tsx`, `role-row.tsx` | Matrix page, UI, role row                                           |
