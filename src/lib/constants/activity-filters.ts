/**
 * Type-pill buckets for the firm activity audit page
 * (/settings/activity).
 *
 * Each bucket maps a pill to the `ActivityLog.type` values it shows.
 * Keep it in step with what the writers actually emit — see
 * `ActivityType` in src/lib/activity-log.ts. Known gap: invoice,
 * expense, permission-grant and conflict-check writers still log
 * under the catch-all "filing" type, so those rows surface under
 * Filings (and All) rather than Financial / Security until the
 * writers get their own types.
 */

import type { ActivityType } from "@/lib/activity-log";

export const ACTIVITY_FILTER_BUCKETS: Record<
  string,
  { label: string; types: readonly ActivityType[] }
> = {
  all: { label: "All", types: [] },
  filings: { label: "Filings", types: ["filing"] },
  communications: { label: "Communications", types: ["email", "call"] },
  documents: { label: "Documents", types: ["document", "records"] },
  evidence: { label: "Evidence", types: ["evidence"] },
  deadlines: { label: "Deadlines", types: ["deadline"] },
  tasks: { label: "Tasks", types: ["task", "task_complete"] },
  notes: { label: "Notes", types: ["note"] },
  time: { label: "Time", types: ["time_entry"] },
  financial: {
    label: "Financial",
    types: ["deposit", "settlement"],
  },
  events: { label: "Events", types: ["event"] },
  security: { label: "Security", types: ["auth"] },
};

export const ACTIVITY_PILL_ORDER = [
  "all",
  "filings",
  "communications",
  "documents",
  "evidence",
  "deadlines",
  "tasks",
  "notes",
  "time",
  "financial",
  "events",
  "security",
] as const;
