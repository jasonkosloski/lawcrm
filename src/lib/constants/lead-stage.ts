/**
 * Lead / intake stage constants — client-safe (no Prisma imports).
 *
 * Canonical home for the Lead.stage value set (see the schema doc
 * comment on Lead). `src/lib/queries/leads.ts` re-exports the type +
 * label maps for its long-standing importers; new code should import
 * from here.
 */

export const LEAD_STAGES = [
  "new",
  "contacted",
  "qualifying",
  "meeting",
  "converted",
  "declined",
  "hold",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

/** Canonical display ordering for stages — new leads first,
 *  converted/declined last (they're done). Not applied by any query
 *  yet (queries/leads.ts only re-exports it); sort with it where an
 *  active-first order is wanted. */
export const LEAD_STAGE_ORDER = [
  "new",
  "contacted",
  "qualifying",
  "meeting",
  "hold",
  "converted",
  "declined",
] as const satisfies readonly LeadStage[];

/// Stages that mean the lead left the pipeline — done, one way or
/// the other. Everything else counts as the open pipeline.
export const LEAD_CLOSED_STAGES = [
  "converted",
  "declined",
] as const satisfies readonly LeadStage[];

/// Open-pipeline stages, in funnel order. The reports funnel iterates
/// this so a new stage shows up there automatically.
export const LEAD_OPEN_STAGES = [
  "new",
  "contacted",
  "qualifying",
  "meeting",
  "hold",
] as const satisfies readonly LeadStage[];

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualifying: "Qualifying",
  meeting: "Meeting",
  hold: "On hold",
  converted: "Converted",
  declined: "Declined",
};

/** Where an inquiry came from — Lead.source vocabulary. */
export const LEAD_SOURCES = [
  "phone",
  "web",
  "referral",
  "walk_in",
  "court_appointment",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  web: "Web form",
  referral: "Referral",
  phone: "Phone",
  walk_in: "Walk-in",
  court_appointment: "Court appt.",
};
