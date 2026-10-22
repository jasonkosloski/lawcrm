/**
 * Server-side phone-list helpers shared by the Parties actions (and
 * available to the contacts actions). Deliberately NOT in a
 * "use server" module: these are plain helpers, not actions.
 *
 * The invariants (exactly one primary, Contact.phone mirrors the
 * primary) come from `normalizeContactPhones` in contact-form.ts; this
 * file adds the strict payload schema and the replace-all writer so
 * the two surfaces cannot drift again.
 */

import { z } from "zod";
import type { Tx } from "@/lib/prisma";
import { normalizeContactPhones, type ContactPhoneEntry } from "@/lib/contact-form";

export const MAX_PHONES_PER_CONTACT = 20;
export const MAX_PHONE_LABEL = 40;
export const MAX_PHONE_NUMBER = 80;

/** Strict: an over-long label/number or too many rows rejects the
 *  WHOLE list (a replace-all must never silently drop entries). */
export const phoneListSchema = z
  .array(
    z.object({
      label: z.string().trim().max(MAX_PHONE_LABEL).default(""),
      number: z.string().trim().max(MAX_PHONE_NUMBER),
      isPrimary: z.boolean().default(false),
    }),
  )
  .max(MAX_PHONES_PER_CONTACT);

export type ParsedPhones = { ok: true; phones: ContactPhoneEntry[] } | { ok: false; error: string };

/** Parse a JSON-stringified phones list (the party edit form posts
 *  one) into a normalized list. Malformed JSON or an invalid entry is
 *  an error - never "treat it as an empty list" (that deletes every
 *  phone). An explicit `[]` is a valid "clear all". */
export function parsePhonesJson(raw: string): ParsedPhones {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: "The phone list was not understood; reload the page and retry",
    };
  }
  const parsed = phoneListSchema.safeParse(decoded);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Phone labels are limited to ${MAX_PHONE_LABEL} characters, numbers to ${MAX_PHONE_NUMBER}, and ${MAX_PHONES_PER_CONTACT} phones per contact`,
    };
  }
  return { ok: true, phones: normalizeContactPhones(parsed.data) };
}

/** Replace-all: whatever `entries` holds becomes the contact's phone
 *  list (array order = display order), exactly one primary when any
 *  exist, with the primary mirrored onto Contact.phone. */
export async function replaceContactPhones(
  tx: Tx,
  contactId: string,
  entries: ContactPhoneEntry[],
): Promise<void> {
  const phones = normalizeContactPhones(entries);
  await tx.contactPhone.deleteMany({ where: { contactId } });
  if (phones.length > 0) {
    await tx.contactPhone.createMany({
      data: phones.map((p, i) => ({
        contactId,
        label: p.label || null,
        number: p.number,
        isPrimary: p.isPrimary,
        order: i,
      })),
    });
  }
  const primary = phones.find((p) => p.isPrimary);
  await tx.contact.update({
    where: { id: contactId },
    data: { phone: primary?.number ?? null },
  });
}

/** Canonical comparison form of a phone list (normalized, trimmed) so
 *  stored and submitted lists compare without tripping on odd
 *  primaries or whitespace. */
export function phonesSignature(entries: ContactPhoneEntry[]): string {
  return JSON.stringify(
    normalizeContactPhones(entries).map((p) => [p.label, p.number, p.isPrimary]),
  );
}
