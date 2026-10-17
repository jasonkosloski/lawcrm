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
  /** Field errors keyed by form field name; `_form` carries errors
   *  that belong to no single field (party removed, stale snapshot). */
  errors?: Record<string, string[]>;
};

export const partyInitialState: PartyFormState = { status: "idle" };

/** Form sentinels for the contact / representation pickers. They live
 *  here (not in the "use server" actions module, which may only export
 *  async functions) so the actions and both client forms share one
 *  definition. */
export const PICK_EXISTING = "__existing__";
export const CREATE_NEW = "__new__";

/** A contact as offered to the party / attorney typeaheads. */
export type ContactOption = {
  id: string;
  name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  type: string;
};

export type RepresentationChoice = "unknown" | "yes" | "no";

/** Representation radio -> MatterContact.isRepresented. Clients are
 *  represented by the firm, so they never persist a value. */
export function representationFlag(
  choice: RepresentationChoice,
  isClient: boolean
): boolean | null {
  if (isClient) return null;
  return choice === "yes" ? true : choice === "no" ? false : null;
}

/** Lenient email check: something@something, no whitespace. Existing
 *  records are never re-validated with it - only values being written. */
export function isLenientEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}

/** True when a free-text subrole names opposing counsel ("Opposing
 *  counsel", "opposing-counsel", "opposing_counsel", ...). */
export function isOpposingCounselRole(role: string | null | undefined): boolean {
  const norm = (role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return /^opposing_(counsel|attorney|lawyer)$/.test(norm);
}
