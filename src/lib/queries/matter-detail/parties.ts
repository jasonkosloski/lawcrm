/**
 * Matter Detail — Parties tab reader.
 */

import { prisma } from "@/lib/prisma";

// ── Parties ──────────────────────────────────────────────────────────────

export type ContactPhoneRow = {
  id: string;
  label: string | null;
  number: string;
  isPrimary: boolean;
};

export type PartyRow = {
  /** matterContact row id — used for delete/unlink. */
  id: string;
  contactId: string;
  name: string;
  organization: string | null;
  email: string | null;
  /** Denormalized primary phone — same as phones.find(p=>p.isPrimary).
   *  Kept as its own field so existing readers don't have to walk
   *  the array. Nullable when the contact has no phones at all. */
  phone: string | null;
  /** Full list of phones in display order (primary first). */
  phones: ContactPhoneRow[];
  contactType: string;
  /** True when this row represents the matter's primary client
   *  (Matter.clientId points at this contactId and category is
   *  "client"). The UI pins it, disables delete, and shows a
   *  "Primary" badge. */
  isPrimaryClient: boolean;
  /** Coarse display bucket — client / opposing / lay_witness /
   *  expert_witness / other. */
  category: string;
  /** Optional finer-grained subrole — plaintiff, defendant,
   *  opposing counsel, GAL, medical provider, etc. */
  role: string | null;
  notes: string | null;
  conflictStatus: string;
  /** Representation info for non-client parties. `null` means
   *  unknown; `false` means explicitly pro se / self-represented;
   *  `true` means represented (check the rep contact below). */
  isRepresented: boolean | null;
  /** Preferred — the representing attorney as a real Contact row.
   *  When set, the rep cell renders as a clickable link to the
   *  Contact and the firm/email/phone are derived from that Contact
   *  (so an edit on /contacts/[id] flows through everywhere). */
  representationContactId: string | null;
  /** Display fields for the rep cell. When `representationContactId`
   *  is set these mirror the Contact; otherwise they fall back to the
   *  legacy free-text representation* columns on MatterContact. */
  representationName: string | null;
  representationFirm: string | null;
  representationEmail: string | null;
  representationPhone: string | null;
};

export async function getMatterParties(matterId: string): Promise<PartyRow[]> {
  const [matter, rows] = await Promise.all([
    prisma.matter.findUnique({
      where: { id: matterId },
      select: { clientId: true },
    }),
    prisma.matterContact.findMany({
      where: { matterId },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            organization: true,
            email: true,
            phone: true,
            type: true,
            conflictStatus: true,
            phones: {
              orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
              select: {
                id: true,
                label: true,
                number: true,
                isPrimary: true,
              },
            },
          },
        },
        // Representing attorney as a first-class Contact. When set,
        // we render the rep cell from this row (and ignore the legacy
        // text columns); when null, fall back to the text columns.
        representationContact: {
          select: {
            id: true,
            name: true,
            organization: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: [{ category: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const primaryClientId = matter?.clientId ?? null;

  return rows.map((r) => {
    // Prefer the joined Contact when present so contact-page edits
    // flow through automatically; fall back to the legacy text
    // columns for rows we haven't backfilled yet.
    // The FK decides: when a rep Contact is linked, its fields are
    // the truth even where they have since been cleared — falling
    // back field-by-field would resurrect stale mirrored text (the
    // legacy columns are written once, at save time).
    const repFromContact = r.representationContact;
    const repName = repFromContact ? repFromContact.name : r.representationName;
    const repFirm = repFromContact ? repFromContact.organization : r.representationFirm;
    const repEmail = repFromContact ? repFromContact.email : r.representationEmail;
    const repPhone = repFromContact ? repFromContact.phone : r.representationPhone;

    return {
      id: r.id,
      contactId: r.contact.id,
      name: r.contact.name,
      organization: r.contact.organization,
      email: r.contact.email,
      phone: r.contact.phone,
      phones: r.contact.phones,
      contactType: r.contact.type,
      category: r.category,
      role: r.role,
      notes: r.notes,
      conflictStatus: r.contact.conflictStatus,
      isRepresented: r.isRepresented,
      representationContactId: r.representationContactId,
      representationName: repName,
      representationFirm: repFirm,
      representationEmail: repEmail,
      representationPhone: repPhone,
      isPrimaryClient: r.category === "client" && r.contact.id === primaryClientId,
    };
  });
}
