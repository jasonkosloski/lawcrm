/**
 * Permission catalog.
 *
 * Static list of every permission the app knows about, grouped by
 * category for the matrix UI. Permissions are app-defined (we know
 * in code which capabilities exist), not data the firm creates;
 * the `RolePermission` table just records "this role grants this
 * permission key." Adding a new permission is a code change here +
 * a UI surface that calls `hasPermission(...)`.
 *
 * The runtime checks live in `src/lib/permission-check.ts` and
 * are wired into every server action + page guard. Each call site
 * passes a specific key like `matters.manage_team` — see that file
 * for the helper signatures.
 *
 * Naming: dotted keys, lowercase snake_case under the dot. The
 * prefix matches the category id so a key like "billing.send_invoice"
 * is self-locating — you can grep for it and find both the catalog
 * entry and the runtime check.
 */

export type PermissionEntry = {
  key: string;
  label: string;
  description: string;
};

export type PermissionCategory = {
  id: string;
  label: string;
  permissions: PermissionEntry[];
};

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "matters",
    label: "Matters",
    permissions: [
      {
        key: "matters.manage_team",
        label: "Manage team members",
        description:
          "Add or remove people from a matter's case team via the matter edit page.",
      },
      {
        key: "matters.edit",
        label: "Edit matter details",
        description:
          "Change name, practice area, stage, fee structure, opposing party, summary, and other matter fields.",
      },
      {
        key: "matters.archive",
        label: "Archive matters",
        description:
          "Move a matter to archived state (preserved, hidden from the active list). Reserved for the Matter Actions menu.",
      },
      {
        key: "matters.delete",
        label: "Delete matters",
        description:
          "Permanently delete a matter and its associated rows. Reserved for the Matter Actions menu.",
      },
      {
        key: "matters.expense.view",
        label: "View matter expenses",
        description:
          "See logged expenses on a matter (filing fees, expert costs, travel, etc.).",
      },
      {
        key: "matters.expense.create",
        label: "Log expenses",
        description:
          "Add a new expense to a matter — filing fees, expert witness fees, deposition transcripts, postage, etc.",
      },
      {
        key: "matters.expense.edit",
        label: "Edit expenses",
        description:
          "Change amount, description, billable / client-advanced flags on an existing expense.",
      },
      {
        key: "matters.expense.delete",
        label: "Delete expenses",
        description:
          "Remove an expense entirely. Refused once the expense has been billed onto an invoice.",
      },
      {
        key: "matters.settlement.view",
        label: "View settlements",
        description:
          "See the gross→fees→costs→liens→client-net waterfall on contingency matters.",
      },
      {
        key: "matters.settlement.edit",
        label: "Create / edit settlements",
        description:
          "Compose a new settlement on a matter; edit gross / firm fee / costs / status while it's pending.",
      },
      {
        key: "matters.settlement.manage_liens",
        label: "Manage settlement liens",
        description:
          "Add a lien (medical, subrogation, etc.) to a settlement; negotiate the amount and mark its status.",
      },
    ],
  },
  {
    id: "intake",
    label: "Intake",
    permissions: [
      {
        key: "intake.conflict_check.run",
        label: "Run conflict checks",
        description:
          "Click to (re-)scan a lead against existing Contacts and opposing parties. Updates the conflict-check status on the lead.",
      },
      {
        key: "intake.conflict_check.override",
        label: "Override conflict flags",
        description:
          "Mark a flagged or conflicted lead as cleared with a justification. Required for ethics compliance — the override is logged in the audit trail.",
      },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    permissions: [
      {
        key: "billing.generate_invoice",
        label: "Generate invoice from WIP",
        description:
          "Bundle a matter's approved time entries into a draft invoice.",
      },
      {
        key: "billing.approve_invoice",
        label: "Approve invoices",
        description:
          "Move a draft invoice to approved (the gate before sending).",
      },
      {
        key: "billing.send_invoice",
        label: "Send invoices",
        description:
          "Transition an approved invoice to sent — actual delivery is logged today; the gate stays the same when real email lands.",
      },
      {
        key: "billing.delete_draft",
        label: "Delete draft invoices",
        description:
          "Hard-delete a draft invoice. Time entries return to billable WIP.",
      },
      {
        key: "billing.void_invoice",
        label: "Void invoices",
        description:
          "Soft-kill an approved or sent invoice (no payments recorded).",
      },
      {
        key: "billing.record_payment",
        label: "Record payments",
        description:
          "Log a payment received against a sent or partially-paid invoice (check, ACH, cash, card, other).",
      },
      {
        key: "billing.apply_trust",
        label: "Apply trust to invoices",
        description:
          "Run the four-leg trust transfer that earns funds out of the matter trust toward an outstanding invoice balance.",
      },
    ],
  },
  {
    id: "trust",
    label: "Trust account",
    permissions: [
      {
        key: "trust.record_transaction",
        label: "Record trust transactions",
        description:
          "Add trust deposits, disbursements, or refunds via the matter trust composer.",
      },
    ],
  },
  {
    id: "firm",
    label: "Firm settings",
    permissions: [
      {
        key: "firm.manage_team_directory",
        label: "Invite / edit / deactivate firm members",
        description:
          "Full access to the /settings/team roster — invite new members, edit roles, reset passwords, deactivate accounts.",
      },
      {
        key: "firm.manage_roles",
        label: "Create / rename / delete custom roles",
        description:
          "Manage the firm's custom roles (the two system roles, Admin and default, are always locked).",
      },
      {
        key: "firm.manage_permissions",
        label: "Set role permissions",
        description:
          "Toggle the matrix on this page — controls who else can grant access to what.",
      },
      {
        key: "firm.edit_info",
        label: "Edit firm profile",
        description:
          "Edit firm name, EIN, contact info, address, logo, and other identity fields.",
      },
      {
        key: "firm.manage_practice_areas",
        label: "Manage practice areas + stages",
        description:
          "Create, rename, reorder, archive, and delete practice areas and the stages that live under them.",
      },
      {
        key: "firm.view_activity",
        label: "View firm-wide activity log",
        description:
          "Read the cross-matter audit feed at /settings/activity. Useful for compliance review, dispute resolution, and finding who-did-what.",
      },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    permissions: [
      {
        key: "documents.delete_any",
        label: "Delete any document",
        description:
          "Delete documents uploaded by other firm members (uploaders can always delete their own).",
      },
    ],
  },
];

/// Flat key list, derived from the categories. Used by the action
/// layer to validate input, by the seed-friendly migration helper
/// to clean up dropped keys, and as the source-of-truth set for
/// the matrix UI.
export const PERMISSION_KEYS: string[] = PERMISSION_CATEGORIES.flatMap(
  (c) => c.permissions.map((p) => p.key)
);

export const PERMISSION_KEYS_SET = new Set(PERMISSION_KEYS);

/// O(1) label lookup keyed by the dotted permission key. Built once
/// at module load so callers (activity log titles, error messages,
/// etc.) don't have to walk the categories.
const PERMISSION_LABEL_BY_KEY = new Map<string, string>();
for (const cat of PERMISSION_CATEGORIES) {
  for (const p of cat.permissions) {
    PERMISSION_LABEL_BY_KEY.set(p.key, p.label);
  }
}

/** True when `key` appears in the static catalog. Cheap O(1). */
export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS_SET.has(key);
}

/** Display label for a permission key. Falls back to the key itself
 *  when the catalog doesn't recognize it (e.g. legacy `RolePermission`
 *  rows that survived a catalog removal). */
export function permissionLabel(key: string): string {
  return PERMISSION_LABEL_BY_KEY.get(key) ?? key;
}
