/**
 * Pure rules for the matter's originating document (fee agreement /
 * retainer) record and the firm-level "require a signed originating
 * document" gate. No I/O. Dates are date-only YYYY-MM-DD strings
 * (ADR-012); the caller supplies `today` in the firm's calendar.
 */

export const AGREEMENT_STATUSES = ["not_sent", "sent", "signed"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

const DEFAULT_LABEL = "Fee agreement";

export function originatingDocLabel(
  area: { originatingDocLabel: string | null } | null
): string {
  const v = area?.originatingDocLabel?.trim();
  return v ? v : DEFAULT_LABEL;
}

export type AgreementInput = {
  status: string;
  signedDate: string;
  hasOriginatingFile: boolean;
};

type GateField = "originatingFileId" | "agreementStatus" | "agreementSignedDate";

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function agreementGateErrors(
  input: AgreementInput,
  opts: { required: boolean; label: string; today: string }
): Partial<Record<GateField, string>> {
  const errors: Partial<Record<GateField, string>> = {};
  const { required, label, today } = opts;

  if (required && !input.hasOriginatingFile) {
    errors.originatingFileId = `Attach the signed ${label}.`;
  }

  if (input.status !== "" && !(AGREEMENT_STATUSES as readonly string[]).includes(input.status)) {
    errors.agreementStatus = "Choose a status.";
  } else if (required && input.status !== "signed") {
    errors.agreementStatus = `Mark the ${label} as signed.`;
  }

  if (input.signedDate === "") {
    if (required) {
      errors.agreementSignedDate = "Enter the date it was signed.";
    }
  } else if (!isRealDate(input.signedDate)) {
    errors.agreementSignedDate = "Enter a valid date.";
  } else if (today !== "" && input.signedDate > today) {
    errors.agreementSignedDate = "The signed date can't be in the future.";
  }

  return errors;
}
