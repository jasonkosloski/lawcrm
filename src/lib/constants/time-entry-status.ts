/**
 * Time-entry status constants — client-safe (no Prisma imports).
 *
 * Canonical home for the TimeEntry.status value set.
 * `src/lib/note-constants.ts` re-exports TIME_ENTRY_STATUSES for its
 * long-standing importers; new code should import from here.
 */

export const TIME_ENTRY_STATUSES = [
  "draft",
  "submitted",
  "billable",
  "billed",
  "written_off",
] as const;

export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

export const TIME_ENTRY_STATUS_LABEL: Record<TimeEntryStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  billable: "Billable",
  billed: "Billed",
  written_off: "Written off",
};

/// WIP-eligible statuses — entries in these states can still be
/// swept into an invoice. Anything else is either already billed
/// (`billed`) or excluded (`written_off`). Shared by the billing
/// queries AND the invoice-generation actions so the "Generate
/// invoice from N entries" copy can't drift from what actually
/// gets swept.
export const TIME_ENTRY_WIP_STATUSES = [
  "draft",
  "submitted",
  "billable",
] as const satisfies readonly TimeEntryStatus[];
