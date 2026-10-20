export const REQUIRED_MATTER_FIELDS = [
  { key: "venue", label: "Venue" },
  { key: "caseNumber", label: "Case number" },
  { key: "court", label: "Court" },
  { key: "filedDate", label: "Filed date" },
  { key: "trialDate", label: "Trial date" },
  { key: "incidentDate", label: "Incident date" },
  { key: "opposingParty", label: "Opposing party" },
  { key: "opposingFirm", label: "Opposing firm" },
  { key: "description", label: "Summary" },
  { key: "client", label: "Client" },
] as const;

export type RequiredMatterField = (typeof REQUIRED_MATTER_FIELDS)[number]["key"];

export type RequiredFieldValues = Partial<
  Record<RequiredMatterField, string | null | undefined>
>;

export const requiredFieldError = "Required for this practice area.";

const KEYS: ReadonlySet<string> = new Set(
  REQUIRED_MATTER_FIELDS.map((f) => f.key),
);

export function isRequiredMatterField(k: string): k is RequiredMatterField {
  return KEYS.has(k);
}

function isEmpty(v: string | null | undefined): boolean {
  return v == null || v.trim() === "";
}

/** Create rule: required fields that are empty. */
export function missingRequired(
  required: readonly string[],
  values: RequiredFieldValues,
): RequiredMatterField[] {
  return required.filter(isRequiredMatterField).filter((k) => isEmpty(values[k]));
}

/** Edit rule: required fields that had a value before and are empty after. */
export function clearedRequired(
  required: readonly string[],
  before: RequiredFieldValues,
  after: RequiredFieldValues,
): RequiredMatterField[] {
  return required
    .filter(isRequiredMatterField)
    .filter((k) => !isEmpty(before[k]) && isEmpty(after[k]));
}

/** Required-field key -> the form control's `name` (and error key). */
export const REQUIRED_FIELD_INPUT_NAME: Record<RequiredMatterField, string> = {
  venue: "venueId",
  client: "clientId",
  caseNumber: "caseNumber",
  court: "court",
  filedDate: "filedDate",
  trialDate: "trialDate",
  incidentDate: "incidentDate",
  opposingParty: "opposingParty",
  opposingFirm: "opposingFirm",
  description: "description",
};

/**
 * The keys an area insists on, as the forms enforce them. Incident date only
 * counts when the area tracks SOL (the only time the field is shown; the
 * server mirrors this).
 */
export function requiredKeysFor(
  area: {
    requiredMatterFields: readonly string[] | null | undefined;
    hasStatuteOfLimitations: boolean;
  } | null,
): RequiredMatterField[] {
  if (!area) return [];
  return (area.requiredMatterFields ?? [])
    .filter(isRequiredMatterField)
    .filter((k) => k !== "incidentDate" || area.hasStatuteOfLimitations);
}
