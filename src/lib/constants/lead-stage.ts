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

/** Ordering for stages — new leads surface first, converted/declined
 *  drop to the bottom (they're done). */
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

/// Open-pipeline stages, in funnel order. The reports funnel and the
/// intake queue both iterate this so a new stage shows up everywhere
/// at once.
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

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  web: "Web form",
  referral: "Referral",
  phone: "Phone",
  walk_in: "Walk-in",
  court_appointment: "Court appt.",
};
