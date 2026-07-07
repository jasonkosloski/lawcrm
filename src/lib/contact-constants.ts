/**
 * Contact constants — pure types/strings shared by client + server.
 *
 * Kept Prisma-free (no `@/lib/prisma` import) so client components
 * can import these without dragging the DB driver into the browser
 * bundle. The server-side queries live in `@/lib/queries/contacts`.
 */

export const CONTACT_TYPES = [
  "client",
  "opposing_counsel",
  "witness",
  "expert",
  "judge",
  "court",
  "vendor",
  "medical_provider",
  "government",
  "other",
] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

/**
 * Batch-size ceiling for the /contacts bulk actions (set type,
 * deactivate, CSV export). Client-side the selection bar disables
 * the actions past this; server-side the actions reject with a
 * clear error. Shared here (not in the "use server" actions file —
 * those modules may only export async functions) so both sides
 * agree on one number.
 */
export const BULK_CONTACT_LIMIT = 100;

export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  client: "Client",
  opposing_counsel: "Opposing counsel",
  witness: "Witness",
  expert: "Expert",
  judge: "Judge",
  court: "Court",
  vendor: "Vendor",
  medical_provider: "Medical provider",
  government: "Government",
  other: "Other",
};
