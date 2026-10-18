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
  /** True when the key is catalogued (so it can be granted ahead of
   *  time) but no action or page enforces it yet. The matrix marks
   *  these so an admin doesn't assume ticking them changes anything. */
  unwired?: boolean;
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
        key: "matters.view_all",
        label: "View all matters",
        description:
          "See every matter and everything on it (notes, documents, time, billing, calendar details) even when not on its case team. Only matters once the firm's matter visibility is set to Team only in Settings → Firm; Admins always have it. Grant to roles such as billing or office manager before turning team-only on.",
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
        unwired: true,
        label: "Archive matters",
        description:
          "Move a matter to archived state (preserved, hidden from the active list). Reserved for the Matter Actions menu.",
      },
      {
        key: "matters.delete",
        unwired: true,
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
        key: "intake.create",
        label: "Add new intakes",
        description:
          "Record a new inquiry from the New intake form: the person (linked to an existing contact or created), how they found the firm, and the incident. A conflict check runs automatically on save.",
      },
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
      {
        key: "intake.decline",
        label: "Decline leads",
        description:
          "Decline a lead with an optional reason, removing it from the active intake queue. The decline is logged in the activity log.",
      },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    permissions: [
      {
        key: "billing.view",
        label: "View billing, trust ledger and invoices",
        description:
          "See a matter's Billing tab (invoices, payments, trust ledger and balance), print invoices, the invoice preview, the dashboard trust figure and trust deposit rows in activity feeds. Viewing only - every billing action keeps its own key.",
      },
      {
        key: "billing.generate_invoice",
        label: "Generate invoice from WIP",
        description:
          "Bundle a matter's approved time entries into a draft invoice, and price (hours / rate) its line items while it is still a draft.",
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
          "Run the four-leg trust transfer that earns funds out of the matter trust toward an outstanding invoice balance, including recording a payment with the Trust method.",
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
          "Full access to the /settings/team roster — invite new members, edit roles, reset passwords, deactivate accounts. Only an Admin can grant or remove the Admin role (or roles carrying access-management permissions), or edit, deactivate, or reset the password of an Admin.",
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
          "Attach files to a matter via the Documents tab (an uploaded email's attachments are added as documents too). Uploaders can always delete their own uploads.",
      },
      {
        key: "documents.delete_any",
        label: "Delete any document",
        description:
          "Delete documents uploaded by other firm members (uploaders can always delete their own).",
      },
      {
        key: "documents.folder.create",
        label: "Create folders",
        description:
          "Add folders to a matter's document file tree (discovery productions arrive as deep folder structures).",
      },
      {
        key: "documents.folder.edit",
        label: "Rename folders",
        description:
          "Rename or reorder folders in a matter's document tree.",
      },
      {
        key: "documents.folder.delete",
        label: "Delete folders",
        description:
          "Remove a folder — its contents are re-parented up a level, never deleted with it.",
      },
      {
        key: "documents.organize",
        label: "Move documents between folders",
        description:
          "Re-file documents within a matter's folder tree, and copy a document to another folder (\"Copy to…\" — an independent document that shares the stored file). Distinct from upload/delete — organizing is often delegated to staff who shouldn't remove records.",
      },
      {
        key: "documents.template.create",
        label: "Create document templates",
        description:
          "Add reusable templates (demand letters, discovery, retainers) to the firm template library. Generating a document from a template needs Upload documents, not this key — these keys govern the library itself.",
      },
      {
        key: "documents.template.edit",
        label: "Edit document templates",
        description:
          "Change a template's name, category, or body, and archive or restore it (archived templates drop out of every matter's Generate picker). Edits affect every future generation, so treat like firm-wide content.",
      },
      {
        key: "documents.template.delete",
        label: "Delete document templates",
        description:
          "Permanently remove templates from the library (archiving is under Edit document templates). Already-generated documents are untouched.",
      },
    ],
  },
  {
    id: "contacts",
    label: "Contacts",
    permissions: [
      {
        key: "contacts.create",
        label: "Create contacts",
        description:
          "Add people/organizations to the directory — the standalone New Contact form (inline creation during intake, matter setup, and call logging stays open to everyone; those flows gate on their own keys).",
      },
      {
        key: "contacts.edit",
        label: "Edit contacts",
        description:
          "Change a contact's profile, type, or phone numbers from the contact detail page.",
      },
      {
        key: "contacts.delete",
        label: "Deactivate contacts",
        description:
          "Soft-delete a contact from the directory (historical matter rows are preserved).",
      },
      {
        key: "contacts.merge",
        label: "Merge duplicate contacts",
        description:
          "Combine two contact records — every matter link, thread, note, and lead is re-pointed to the survivor and the duplicate is deactivated. Hard to undo; delegate carefully.",
      },
      {
        key: "contacts.export",
        label: "Export contacts",
        description:
          "Download selected contacts (names, emails, phones, organizations) as a CSV from the contacts list. Bulk export of the client list — grant narrowly.",
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
    id: "automations",
    label: "Automations",
    permissions: [
      {
        key: "automations.view",
        label: "View automations",
        description:
          "See Settings → Automations: the firm's deadline rules, task lists, and which ones apply automatically to new matters. Applying a rule or list to a matter rides deadlines.create / tasks.create instead.",
      },
      {
        key: "automations.deadline_rule.create",
        label: "Create deadline rules",
        description:
          "Add a reusable deadline rule (\"N days after/before an anchor date\") to the firm library.",
      },
      {
        key: "automations.deadline_rule.edit",
        label: "Edit deadline rules",
        description:
          "Change a rule's title, anchor, offset, citation, or archive it. Affects future applications only — deadlines already generated keep their dates.",
      },
      {
        key: "automations.deadline_rule.delete",
        label: "Delete deadline rules",
        description:
          "Permanently remove a rule. Deadlines it generated stay on their matters; a rule other rules count from can't be deleted.",
      },
      {
        key: "automations.task_list.create",
        label: "Create task lists",
        description: "Add a reusable task list (checklist) to the firm library.",
      },
      {
        key: "automations.task_list.edit",
        label: "Edit task lists",
        description:
          "Rename a task list, add/edit/reorder/remove its items, or archive it. Tasks already created from it are unaffected.",
      },
      {
        key: "automations.task_list.delete",
        label: "Delete task lists",
        description:
          "Permanently remove a task list. Tasks it created stay on their matters.",
      },
      {
        key: "automations.defaults.create",
        label: "Add automatic defaults",
        description:
          "Choose a deadline rule or task list to apply automatically whenever a matter is created (new-matter form or lead conversion), for one practice area or all.",
      },
      {
        key: "automations.defaults.delete",
        label: "Remove automatic defaults",
        description: "Stop a rule or list from applying automatically to new matters.",
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
          "Change a party's role, notes and representation on a matter. Changing the shared contact's name, email, organization or phones from the Parties tab also needs Edit contacts (contacts.edit).",
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
    id: "evidence",
    label: "Evidence review",
    permissions: [
      {
        key: "evidence.flag.create",
        label: "Flag evidence for review",
        description:
          "Flag timestamped moments in bodycam, dashcam, or call recordings, pages and passages in documents, or whole files — category + note, surfaced on the matter's Evidence review page. Creators can always edit their own flags.",
      },
      {
        key: "evidence.flag.edit_any",
        label: "Edit anyone's flags",
        description:
          "Change another reviewer's flagged moments (category, note, anchor). Own flags are always editable without this.",
      },
      {
        key: "evidence.flag.delete_any",
        label: "Delete anyone's flags",
        description:
          "Remove another reviewer's flagged moments. Own flags are always deletable without this.",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    permissions: [
      {
        key: "reports.view",
        label: "View firm reports",
        description:
          "The /reports dashboard — intake pipeline, team utilization, AR aging, realization. Firm-wide financial and workload data, so it's gated separately from the personal dashboard.",
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
      {
        key: "communication.send_email",
        label: "Send email",
        description:
          "Compose new emails and reply to threads from a connected Gmail account. Every send goes out from the sender's OWN connected mailbox — this key governs whether they can send from inside the CRM at all.",
      },
      {
        key: "communication.edit_call",
        label: "Edit logged calls",
        description:
          "Correct a manually logged call's outcome, duration, summary, or matter filing after the fact. Only manual logs are editable — provider-synced items are immutable records.",
      },
      {
        key: "communication.delete_call",
        label: "Delete logged calls",
        description:
          "Remove a manually logged call. Only manual logs are deletable — provider-synced items are immutable records.",
      },
    ],
  },
  {
    id: "records",
    label: "Records requests",
    permissions: [
      {
        key: "records.view",
        label: "View records requests",
        description:
          "See the Records tabs on matters and intake, the dashboard's Records to chase card, and records requests in global search.",
      },
      {
        key: "records.create",
        label: "Create records requests",
        description:
          "Start a new records request (custodian, type, subject, date range) on a matter or intake lead.",
      },
      {
        key: "records.edit",
        label: "Edit records requests",
        description:
          "Change a request's status, dates, owner and fields; log follow-ups; link or unlink received documents. Reopening a closed request also needs this.",
      },
      {
        key: "records.delete",
        label: "Delete records requests",
        description:
          "Delete a request. Its linked documents, follow-up tasks and expense are kept; only the links are cleared.",
      },
      {
        key: "records.types.manage",
        label: "Manage records request types",
        description:
          "Settings → Records request types: create, edit and archive the firm's request types (response period, follow-up interval, default letter template).",
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

/**
 * Permissions that govern access to access itself. Only an Admin may
 * grant or revoke them (setRolePermissionAction), and a non-Admin
 * team-directory manager may not hand out — or take away — a role
 * that carries one of them (team.ts), or reset the password of /
 * deactivate a member who holds such a role. Otherwise a delegate
 * could mint admin-equivalent peers (or become one) with no Admin
 * involvement.
 *
 *   - manage_permissions: edits the permission matrix itself
 *   - manage_roles: renaming/deleting roles dismantles delegation
 *   - manage_team_directory: assigns roles + resets passwords, i.e.
 *     account takeover and self-promotion if left to delegates
 */
export const ADMIN_ONLY_PERMISSIONS: ReadonlySet<string> = new Set([
  "firm.manage_permissions",
  "firm.manage_roles",
  "firm.manage_team_directory",
]);

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
