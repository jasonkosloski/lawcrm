/**
 * Matter "Create …" action registry
 *
 * Each entry defines one thing a user can create that lives under a
 * specific matter — logged time, notes, tasks, deadlines, parties,
 * documents, calendar events, invoices. Used by:
 *   - `MatterCreateMenu` (the dropdown in the matter detail header)
 *   - `/matters/[id]/new/[type]/page.tsx` (shared placeholder page)
 *
 * When a real create form ships, the placeholder page for that type
 * can be replaced with the form — or a dedicated route can take over.
 */

export type MatterCreateType =
  | "time"
  | "task"
  | "deadline"
  | "party"
  | "document"
  | "event"
  | "invoice";

export type MatterCreateGroup = "track" | "capture" | "connect" | "bill";

export type MatterCreateEntry = {
  type: MatterCreateType;
  group: MatterCreateGroup;
  /** Short menu label, e.g. "Log time". */
  label: string;
  /** Longer description shown on the placeholder page. */
  description: string;
  /** Expected form fields / flow — sets expectations for the real build. */
  expected: string[];
  /** Lucide icon name resolved in the UI. */
  icon:
    | "clock"
    | "task"
    | "deadline"
    | "users"
    | "document"
    | "calendar"
    | "invoice";
};

export const MATTER_CREATE_ENTRIES: MatterCreateEntry[] = [
  {
    type: "time",
    group: "track",
    label: "Log time",
    icon: "clock",
    description:
      "Add a time entry against this matter. Duration, UTBMS activity code, narrative, billing + privilege flags.",
    expected: [
      "Date + duration (decimal hours or start/stop)",
      "Activity (short) + narrative (client-facing)",
      "UTBMS code (picker with firm library)",
      "Billing rate override (if not firm default)",
      "Flags: billable, no-charge, privileged",
      "Link to originating event (email, calendar, document) when applicable",
    ],
  },
  {
    type: "task",
    group: "capture",
    label: "Add task",
    icon: "task",
    description:
      "Create a to-do assigned to a team member with a priority and due date.",
    expected: [
      "Title + optional description",
      "Owner (team-member picker)",
      "Priority (Low / Normal / High / Urgent)",
      "Due date",
      "Optional link to a deadline (so the task inherits its due date)",
    ],
  },
  {
    type: "deadline",
    group: "capture",
    label: "Add deadline",
    icon: "deadline",
    description:
      "Capture a new deadline on this matter — statute-driven, scheduling-order, rule-driven, or manual.",
    expected: [
      "Title + optional description",
      "Due date + optional time",
      "Kind (Critical / Auto-rule / Manual)",
      "Source (statute / scheduling order / filing rule / custom) + reference",
      "Owner (responsible attorney)",
      "Auto-spawn related tasks via deadline templates (future)",
    ],
  },
  {
    type: "party",
    group: "connect",
    label: "Add party",
    icon: "users",
    description:
      "Link a contact to this matter with a specific role (plaintiff, defendant, witness, expert, etc.).",
    expected: [
      "Contact picker (search existing Contact records) or quick-create inline",
      "Role on this matter (plaintiff / defendant / witness / expert / opposing_counsel / lienholder / medical_provider / judge / GAL)",
      "Notes specific to their role on this matter",
      "Conflict check against existing matters as they're added",
    ],
  },
  {
    type: "document",
    group: "connect",
    label: "Upload document",
    icon: "document",
    description:
      "Upload a document (filing, pleading, correspondence, discovery, expert report, contract).",
    expected: [
      "File upload (single or multi) with progress",
      "Category selector",
      "Source (ECF / email / scan / upload / generated / vendor)",
      "Status (active / filed / received / review / archived)",
      "Auto-classification on upload (future)",
      "OCR + full-text search on attached files (future)",
    ],
  },
  {
    type: "event",
    group: "connect",
    label: "Schedule event",
    icon: "calendar",
    description:
      "Create a calendar event on this matter — hearing, deposition, meeting, block time.",
    expected: [
      "Title + type (meeting / deposition / hearing / intake / mediation / block_time / trial)",
      "Start + end time (or all-day)",
      "Location or Zoom URL",
      "Attendees (team + external emails)",
      "Google Calendar sync (future)",
    ],
  },
  {
    type: "invoice",
    group: "bill",
    label: "Create invoice",
    icon: "invoice",
    description:
      "Generate an invoice for this matter from unbilled time entries and expenses.",
    expected: [
      "Line items from current WIP (select which time entries to include)",
      "Optional expense line items",
      "Flat-fee adjustments + write-offs",
      "Tax if applicable",
      "Invoice number auto-assignment",
      "Issue date + due date",
      "Preview + download as PDF + email to client",
    ],
  },
];

export function findMatterCreateEntry(
  type: string
): MatterCreateEntry | undefined {
  return MATTER_CREATE_ENTRIES.find((e) => e.type === type);
}
