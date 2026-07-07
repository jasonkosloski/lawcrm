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
        key: "matters.create",
        label: "Create matters",
        description:
          "Open a new matter — manually via the New matter form or programmatically by converting a lead. Doesn't grant team-management or edit rights on existing matters.",
      },
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
      {
        key: "matters.settlement.approve",
        label: "Sign off on settlement approval steps",
        description:
          "Mark a settlement approval step approved or rejected. Each step is gated by this permission today; future role-specific approval gates (partner-only sign-off, etc.) will layer on top.",
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
        key: "documents.upload",
        label: "Upload documents",
        description:
          "Attach files to a matter via the Documents tab. Uploaders can always delete their own uploads.",
      },
      {
        key: "documents.delete_any",
        label: "Delete any document",
        description:
          "Delete documents uploaded by other firm members (uploaders can always delete their own).",
      },
    ],
  },
  {
    id: "tasks",
    label: "Tasks",
    permissions: [
      {
        key: "tasks.create",
        label: "Create tasks",
        description:
          "Add new tasks on a matter or firm-wide. Required for the 'New task' button on the matter Tasks tab and the global Tasks dialog.",
      },
      {
        key: "tasks.edit",
        label: "Edit tasks",
        description:
          "Change a task's title, description, due date, priority, or status — including marking it complete or cancelled.",
      },
      {
        key: "tasks.delete",
        label: "Delete tasks",
        description:
          "Permanently remove a task from a matter (or firm-wide). The activity log entry is preserved.",
      },
    ],
  },
  {
    id: "deadlines",
    label: "Deadlines",
    permissions: [
      {
        key: "deadlines.create",
        label: "Create deadlines",
        description:
          "Add a new deadline to a matter — discovery cutoffs, statutory notice dates, hearings, etc.",
      },
      {
        key: "deadlines.edit",
        label: "Edit deadlines",
        description:
          "Change a deadline's date, kind, source rule, description, or status (open / completed / waived).",
      },
      {
        key: "deadlines.delete",
        label: "Delete deadlines",
        description:
          "Permanently remove a deadline. Use carefully — most deadlines are statutorily driven.",
      },
    ],
  },
  {
    id: "notes",
    label: "Notes",
    permissions: [
      {
        key: "notes.create",
        label: "Create notes",
        description:
          "Author notes (memo, strategy, chatter, plain note) on a matter or as a firm-wide capture.",
      },
      {
        key: "notes.edit_any",
        label: "Edit any note",
        description:
          "Edit the body or type of notes authored by other firm members. Authors can always edit their own.",
      },
      {
        key: "notes.delete_any",
        label: "Delete any note",
        description:
          "Delete notes authored by other firm members. Authors can always delete their own.",
      },
      {
        key: "notes.pin",
        label: "Pin / unpin notes",
        description:
          "Pin a note so it surfaces at the top of the matter Overview tab. Pinning is a firm-wide signal — usually reserved for case leads.",
      },
    ],
  },
  {
    id: "time_entries",
    label: "Time entries",
    permissions: [
      {
        key: "time_entries.create",
        label: "Log time",
        description:
          "Log billable or non-billable time on a matter, task, or firm-level activity.",
      },
      {
        key: "time_entries.edit_any",
        label: "Edit any time entry",
        description:
          "Edit time entries logged by other team members. Loggers can always edit their own draft / unbilled entries.",
      },
      {
        key: "time_entries.delete_any",
        label: "Delete any time entry",
        description:
          "Delete time entries logged by other team members. Loggers can always delete their own unbilled entries.",
      },
    ],
  },
  {
    id: "parties",
    label: "Parties",
    permissions: [
      {
        key: "parties.create",
        label: "Add parties to a matter",
        description:
          "Pin a contact to a matter as a party — client, opposing party, witness, expert, vendor, etc.",
      },
      {
        key: "parties.edit",
        label: "Edit party records",
        description:
          "Change a party's role on a matter, contact info, or supplemental fields.",
      },
      {
        key: "parties.delete",
        label: "Remove parties from matters",
        description:
          "Detach a contact from a matter. The underlying Contact record is preserved.",
      },
    ],
  },
  {
    id: "events",
    label: "Events",
    permissions: [
      {
        key: "events.create",
        label: "Create events",
        description:
          "Schedule events on a matter — meetings, depositions, hearings, intakes, mediations, trial blocks, etc.",
      },
      {
        key: "events.edit",
        label: "Edit events",
        description:
          "Change date, time, type, location, or invitees on an existing event.",
      },
      {
        key: "events.delete",
        label: "Delete events",
        description:
          "Remove an event from the calendar. Linked time entries / tasks remain but lose their event association.",
      },
      {
        key: "events.edit_non_matter",
        label: "Edit other users' personal events",
        description:
          "Edit calendar events that aren't tied to a matter and that the user didn't create. Default OFF for everyone — keeps personal events truly personal. Grant only when a role legitimately needs cross-user calendar editing (e.g. an exec assistant role).",
      },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    permissions: [
      {
        key: "communication.file_email",
        label: "File emails to matters",
        description:
          "File an email thread onto a matter (or unfile it back to the inbox) via the thread-reader picker. Filing changes the matter's record, so it's a matter mutation — not just an inbox convenience.",
      },
      {
        key: "communication.log_call",
        label: "Log calls",
        description:
          "Manually record a phone call with a contact — direction, outcome, duration, summary, and optional matter filing. The call appears in the Messages inbox and, when filed, on the matter timeline.",
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
