/**
 * Party category constants.
 *
 * The Parties tab groups matter contacts by one of these five
 * coarse buckets. Finer-grained subroles (plaintiff, defendant,
 * opposing counsel, GAL, medical provider, …) still live on the
 * `role` column for display + reporting, but the category drives
 * the tab's sections.
 *
 * TODO (settings): make the list firm-configurable — same pattern
 * as the practice-areas settings page. For now these five are
 * hardcoded.
 */

export const PARTY_CATEGORIES = [
  "client",
  "opposing",
  "lay_witness",
  "expert_witness",
  "other",
] as const;

export type PartyCategory = (typeof PARTY_CATEGORIES)[number];

export const PARTY_CATEGORY_LABEL: Record<PartyCategory, string> = {
  client: "Clients",
  opposing: "Opposing parties",
  lay_witness: "Lay witnesses",
  expert_witness: "Expert witnesses",
  other: "Others",
};

/** Singular form for CTAs like "Add a client". */
export const PARTY_CATEGORY_ADD_LABEL: Record<PartyCategory, string> = {
  client: "Add a client",
  opposing: "Add an opposing party",
  lay_witness: "Add a lay witness",
  expert_witness: "Add an expert witness",
  other: "Add a party",
};

export type PartyFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const partyInitialState: PartyFormState = { status: "idle" };
