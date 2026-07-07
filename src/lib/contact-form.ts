/**
 * Shared form-state shape + pure helpers for the contact
 * create/edit/phone surfaces. Client components import from here
 * (no Prisma), and the server actions in
 * `src/app/actions/contacts.ts` reuse the same normalization so
 * both sides agree on the phone-list invariants.
 */

export type ContactFormState = {
  status: "idle" | "ok" | "error";
  /** When the action redirects, this carries the new contact id so the
   *  client can navigate. (For edit it stays null.) */
  contactId?: string;
  errors?: Partial<
    Record<
      | "name"
      | "type"
      | "email"
      | "phone"
      | "organization"
      | "address"
      | "city"
      | "state"
      | "zip"
      | "notes"
      | "_form",
      string[]
    >
  >;
};

export const contactFormInitialState: ContactFormState = { status: "idle" };

// ── Phone-list helpers ──────────────────────────────────────────────────

/** One row in the editable phone list. Mirrors the ContactPhone
 *  shape minus ids/order — order is positional (array index). */
export type ContactPhoneEntry = {
  /** Free-text label (Mobile / Office / Fax / …). Empty = unlabeled. */
  label: string;
  number: string;
  isPrimary: boolean;
};

/**
 * Enforce the ContactPhone invariants on a submitted list (see the
 * schema comment): trims label + number, drops entries with an empty
 * number, and guarantees exactly one primary when any rows remain —
 * the first entry the user marked primary wins; when none is marked,
 * the first entry is promoted.
 */
export function normalizeContactPhones(
  entries: ContactPhoneEntry[]
): ContactPhoneEntry[] {
  const cleaned = entries
    .map((e) => ({
      label: e.label.trim(),
      number: e.number.trim(),
      isPrimary: e.isPrimary,
    }))
    .filter((e) => e.number.length > 0);

  if (cleaned.length === 0) return cleaned;

  const firstPrimary = cleaned.findIndex((e) => e.isPrimary);
  const primaryIndex = firstPrimary === -1 ? 0 : firstPrimary;
  return cleaned.map((e, i) => ({ ...e, isPrimary: i === primaryIndex }));
}

/**
 * Key for treating two phone strings as "the same number" — digits
 * only, so "(303) 555-0101" and "303.555.0101" collide. Inputs with
 * no digits at all (vanity/partial entries) fall back to the trimmed
 * lowercase string so they still dedupe against exact copies.
 */
export function phoneDedupeKey(number: string): string {
  const digits = number.replace(/\D/g, "");
  return digits.length > 0 ? digits : number.trim().toLowerCase();
}
