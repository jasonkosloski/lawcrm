/**
 * Party server actions.
 *
 * Accepts either `contactId` (pick existing) or `newContactName`
 * (create a new Contact inline), plus the category + optional
 * subrole. One transaction so a failed MatterContact link doesn't
 * leave an orphaned new Contact behind.
 *
 * Auth: gated on `parties.create` (createMatterContact),
 * `parties.edit` (updateMatterContact), and `parties.delete`
 * (removeMatterContact). Admins short-circuit; other roles need
 * explicit grant via the matrix. updateMatterContact additionally
 * requires `contacts.edit` when it would change the shared Contact
 * record (name / email / organization / phones) — see there.
 *
 * Every mutation writes a matter-scoped audit entry (source
 * "Parties"): who added, edited, or removed a party. Removing an
 * adverse party matters most — conflict checks scan these rows.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/prisma";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { logAuditEntry } from "@/lib/audit-entry";
import {
  PARTY_CATEGORIES,
  PARTY_CATEGORY_LABEL,
  type PartyFormState,
} from "@/lib/party-constants";

const PICK_EXISTING = "__existing__";
const CREATE_NEW = "__new__";

/** Posted shape for a single phone in the edit form. */
const phoneEntrySchema = z.object({
  label: z.string().trim().max(40).optional().default(""),
  number: z.string().trim().min(1, "Number required").max(80),
  isPrimary: z.boolean().default(false),
});
type PhoneEntry = z.infer<typeof phoneEntrySchema>;

/** Replace-all strategy for a contact's phones. Normalizes so exactly
 *  one entry is primary when any exist, then mirrors the primary's
 *  number onto Contact.phone so pre-existing single-phone readers
 *  keep working. */
async function syncContactPhones(
  tx: Tx,
  contactId: string,
  phones: PhoneEntry[]
): Promise<void> {
  // Normalize primary — exactly one when the list is non-empty.
  if (phones.length > 0) {
    const currentPrimary = phones.findIndex((p) => p.isPrimary);
    if (currentPrimary === -1) phones[0].isPrimary = true;
    else {
      // Clear any dupes beyond the first primary.
      phones.forEach((p, i) => {
        p.isPrimary = i === currentPrimary;
      });
    }
  }

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

/** Resolved representation block to persist on the MatterContact row.
 *  Either points at an existing/new Contact (representationContactId)
 *  or all-null when the party is pro se / unknown / a client. The
 *  legacy free-text columns are mirrored from the resolved Contact for
 *  back-compat reads. */
type ResolvedRepresentation = {
  representationContactId: string | null;
  representationName: string | null;
  representationFirm: string | null;
  representationEmail: string | null;
  representationPhone: string | null;
};

const NULL_REPRESENTATION: ResolvedRepresentation = {
  representationContactId: null,
  representationName: null,
  representationFirm: null,
  representationEmail: null,
  representationPhone: null,
};

/** Resolve the rep contact — either pick an existing one or create a
 *  new one inline. Returns the FK + mirrored display fields for the
 *  MatterContact row. Throws when the picked id doesn't exist (caller
 *  rolls back the surrounding transaction). */
async function resolveRepresentation(
  tx: Tx,
  input: {
    mode: typeof PICK_EXISTING | typeof CREATE_NEW;
    pickedId: string | null;
    newName: string | null;
    newFirm: string | null;
    newEmail: string | null;
    newPhone: string | null;
  }
): Promise<ResolvedRepresentation> {
  if (input.mode === PICK_EXISTING) {
    if (!input.pickedId) throw new Error("Representation contact id missing");
    const c = await tx.contact.findUnique({
      where: { id: input.pickedId },
      select: {
        id: true,
        name: true,
        organization: true,
        email: true,
        phone: true,
      },
    });
    if (!c) throw new Error("Representation contact not found");
    return {
      representationContactId: c.id,
      representationName: c.name,
      representationFirm: c.organization,
      representationEmail: c.email,
      representationPhone: c.phone,
    };
  }

  // CREATE_NEW — opposing counsel by default. The user can change the
  // contact's type later via the contacts directory if it's wrong
  // (e.g. an in-house counsel hire that should be "other").
  if (!input.newName) throw new Error("Representation name missing");
  const created = await tx.contact.create({
    data: {
      name: input.newName,
      organization: input.newFirm || null,
      email: input.newEmail || null,
      phone: input.newPhone || null,
      type: "opposing_counsel",
    },
    select: { id: true },
  });
  if (input.newPhone) {
    await tx.contactPhone.create({
      data: {
        contactId: created.id,
        label: "Primary",
        number: input.newPhone,
        isPrimary: true,
        order: 0,
      },
    });
  }
  return {
    representationContactId: created.id,
    representationName: input.newName,
    representationFirm: input.newFirm || null,
    representationEmail: input.newEmail || null,
    representationPhone: input.newPhone || null,
  };
}

/** Parse the JSON-stringified phones array coming from the form.
 *  Returns [] if the field is missing or malformed. */
function parsePhonesJson(raw: string | undefined): PhoneEntry[] {
  if (!raw) return [];
  try {
    const decoded = JSON.parse(raw);
    if (!Array.isArray(decoded)) return [];
    const result: PhoneEntry[] = [];
    for (const item of decoded) {
      const parsed = phoneEntrySchema.safeParse(item);
      if (parsed.success) result.push(parsed.data);
    }
    return result;
  } catch {
    return [];
  }
}

const partySchema = z
  .object({
    category: z.enum(PARTY_CATEGORIES),
    /** Either the id of an existing contact, or the sentinel
     *  CREATE_NEW to signal the new-contact fields should be used. */
    contactMode: z.enum([PICK_EXISTING, CREATE_NEW]).default(CREATE_NEW),
    contactId: z.string().trim().optional().or(z.literal("")),
    newContactName: z.string().trim().max(200).optional().or(z.literal("")),
    newContactEmail: z.string().trim().max(200).optional().or(z.literal("")),
    newContactPhone: z.string().trim().max(80).optional().or(z.literal("")),
    newContactOrganization: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    role: z.string().trim().max(80).optional().or(z.literal("")),
    notes: z.string().trim().max(4000).optional().or(z.literal("")),
    /** Representation status: "unknown" | "yes" | "no". "yes" unlocks
     *  the rep contact picker below. "no" means pro se. */
    representation: z.enum(["unknown", "yes", "no"]).default("unknown"),
    /** Either pick an existing Contact (rep is the firm's record of
     *  some attorney) or create a new one inline. Same pattern as
     *  the main party picker. */
    representationContactMode: z
      .enum([PICK_EXISTING, CREATE_NEW])
      .default(CREATE_NEW),
    representationContactId: z.string().trim().optional().or(z.literal("")),
    /** Inline-create fields used when representationContactMode === CREATE_NEW.
     *  The created Contact gets type "opposing_counsel". */
    newRepresentationName: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    newRepresentationFirm: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    newRepresentationEmail: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    newRepresentationPhone: z
      .string()
      .trim()
      .max(80)
      .optional()
      .or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.contactMode === PICK_EXISTING) {
      if (!data.contactId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contactId"],
          message: "Pick an existing contact or switch to new",
        });
      }
    } else {
      if (!data.newContactName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newContactName"],
          message: "Name is required for a new contact",
        });
      }
      if (
        data.newContactEmail &&
        !data.newContactEmail.includes("@")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newContactEmail"],
          message: "That doesn't look like an email",
        });
      }
    }

    // Representation validation only matters when explicitly "yes" —
    // unknown / pro se don't need a rep contact at all.
    if (data.category !== "client" && data.representation === "yes") {
      if (data.representationContactMode === PICK_EXISTING) {
        if (!data.representationContactId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["representationContactId"],
            message: "Pick a representing contact or create a new one",
          });
        }
      } else if (!data.newRepresentationName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newRepresentationName"],
          message: "Attorney name is required",
        });
      }
      if (
        data.newRepresentationEmail &&
        !data.newRepresentationEmail.includes("@")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newRepresentationEmail"],
          message: "That doesn't look like an email",
        });
      }
    }
  });

export async function createMatterContact(
  matterId: string,
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
  const userId = await requirePermission("parties.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = partySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }
  const data = parsed.data;

  // Guard that the matter exists.
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) {
    return {
      status: "error",
      errors: { contactId: ["Matter not found"] },
      values: raw,
    };
  }

  // Re-adding a contact already listed in this section used to upsert
  // and overwrite the existing row's role / notes / representation
  // with the composer's (usually blank) values. Refuse instead: the
  // person should edit the existing row. Checked before the
  // transaction so a CREATE_NEW contact is never rolled back for it.
  if (data.contactMode === PICK_EXISTING && data.contactId) {
    const already = await prisma.matterContact.findUnique({
      where: {
        matterId_contactId_category: {
          matterId,
          contactId: data.contactId,
          category: data.category,
        },
      },
      select: { id: true },
    });
    if (already) {
      return {
        status: "error",
        errors: {
          contactId: [
            "Already listed in this section — edit that row instead",
          ],
        },
        values: raw,
      };
    }
  }

  let addedName = "";
  await prisma.$transaction(async (tx) => {
    let contactId = data.contactId || null;

    if (data.contactMode === CREATE_NEW) {
      // Default contact.type guess from category — the firm can edit
      // the underlying contact later. "opposing" party contact type
      // maps to the existing Contact enum "opposing_counsel" when the
      // subrole says so, else "other"; expert witnesses map to "expert",
      // lay witnesses to "witness", clients to "client".
      const contactType =
        data.category === "client"
          ? "client"
          : data.category === "expert_witness"
            ? "expert"
            : data.category === "lay_witness"
              ? "witness"
              : data.category === "opposing"
                ? data.role === "opposing_counsel"
                  ? "opposing_counsel"
                  : "other"
                : "other";

      const created = await tx.contact.create({
        data: {
          name: data.newContactName!,
          email: data.newContactEmail || null,
          phone: data.newContactPhone || null,
          organization: data.newContactOrganization || null,
          type: contactType,
        },
        select: { id: true },
      });
      contactId = created.id;
      addedName = data.newContactName!;
      // Mirror the single phone the composer collected into a
      // ContactPhone row so the contact starts with a first-class
      // primary. Additional phones can be added via Edit.
      if (data.newContactPhone) {
        await tx.contactPhone.create({
          data: {
            contactId,
            label: "Primary",
            number: data.newContactPhone,
            isPrimary: true,
            order: 0,
          },
        });
      }
    } else if (contactId) {
      // Verify the picked contact exists; stale client values
      // shouldn't silently create dangling rows.
      const hit = await tx.contact.findUnique({
        where: { id: contactId },
        select: { id: true, name: true },
      });
      if (!hit) throw new Error("Contact not found");
      addedName = hit.name;
    }

    if (!contactId) throw new Error("No contact id resolved");

    // Clients are represented by us — don't persist representation
    // data on that category even if somehow submitted.
    const isClient = data.category === "client";
    const isRepresented = isClient
      ? null
      : data.representation === "yes"
        ? true
        : data.representation === "no"
          ? false
          : null;
    // Resolve representation either to a Contact (FK + mirrored text)
    // or to all-null when not represented / unknown / pro se / client.
    const rep =
      !isClient && isRepresented
        ? await resolveRepresentation(tx, {
            mode: data.representationContactMode,
            pickedId: data.representationContactId || null,
            newName: data.newRepresentationName || null,
            newFirm: data.newRepresentationFirm || null,
            newEmail: data.newRepresentationEmail || null,
            newPhone: data.newRepresentationPhone || null,
          })
        : NULL_REPRESENTATION;

    // Plain create: the unique [matterId, contactId, category] means a
    // concurrent duplicate add fails loudly instead of overwriting.
    await tx.matterContact.create({
      data: {
        matterId,
        contactId,
        category: data.category,
        role: data.role || null,
        notes: data.notes || null,
        isRepresented,
        ...rep,
      },
    });
  });

  await logAuditEntry({
    matterId,
    userId,
    type: "party",
    source: "Parties",
    icon: "user",
    title: `Added ${addedName} to ${PARTY_CATEGORY_LABEL[data.category]}`,
    detail: data.role ? `Role: ${data.role}` : null,
  });

  revalidatePath(`/matters/${matterId}/parties`);
  revalidatePath(`/matters/${matterId}`);
  return { status: "ok" };
}

// ── Update ──────────────────────────────────────────────────────────────

const partyUpdateSchema = z
  .object({
    /** Core contact fields — these live on the global Contact record,
     *  so edits here flow through to every matter the contact appears
     *  on. The UI surfaces that so the user isn't surprised. */
    contactName: z.string().trim().min(1, "Name is required").max(200),
    contactEmail: z.string().trim().max(200).optional().or(z.literal("")),
    contactOrganization: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    /** JSON-stringified array of { label, number, isPrimary }. Replace-
     *  all strategy: whatever the user submits becomes the new phone
     *  list for the contact. Empty array clears all phones. */
    phones: z.string().optional().default("[]"),
    role: z.string().trim().max(80).optional().or(z.literal("")),
    notes: z.string().trim().max(4000).optional().or(z.literal("")),
    representation: z.enum(["unknown", "yes", "no"]).default("unknown"),
    representationContactMode: z
      .enum([PICK_EXISTING, CREATE_NEW])
      .default(CREATE_NEW),
    representationContactId: z.string().trim().optional().or(z.literal("")),
    newRepresentationName: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    newRepresentationFirm: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    newRepresentationEmail: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    newRepresentationPhone: z
      .string()
      .trim()
      .max(80)
      .optional()
      .or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.representation === "yes") {
      if (data.representationContactMode === PICK_EXISTING) {
        if (!data.representationContactId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["representationContactId"],
            message: "Pick a representing contact or create a new one",
          });
        }
      } else if (!data.newRepresentationName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newRepresentationName"],
          message: "Attorney name is required",
        });
      }
    }
  });

/** Edits the MatterContact join row in place — subrole, notes, and
 *  representation info — and, for convenience, the shared Contact's
 *  name / email / organization / phones (which flow to every matter).
 *
 *  The shared-Contact fields are gated on `contacts.edit` as well as
 *  `parties.edit`: a role denied contacts.edit must not be able to
 *  rewrite the firm-wide directory record through the Parties tab. The
 *  gate only applies when a submitted contact value actually differs
 *  from the stored one, so a user with parties.edit alone can still
 *  save role / notes / representation (the form always posts the
 *  contact fields back unchanged). Does NOT change the category
 *  (structural; use add/remove). */
export async function updateMatterContact(
  matterContactId: string,
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
  const userId = await requirePermission("parties.edit");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = partyUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const row = await prisma.matterContact.findUnique({
    where: { id: matterContactId },
    select: {
      id: true,
      matterId: true,
      contactId: true,
      category: true,
      contact: {
        select: {
          name: true,
          email: true,
          organization: true,
          phone: true,
          phones: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            select: { label: true, number: true, isPrimary: true },
          },
        },
      },
    },
  });
  if (!row) {
    return {
      status: "error",
      errors: { contactName: ["Party not found"] },
      values: raw,
    };
  }

  const isClient = row.category === "client";
  const data = parsed.data;
  const isRepresented = isClient
    ? null
    : data.representation === "yes"
      ? true
      : data.representation === "no"
        ? false
        : null;

  const phones = parsePhonesJson(data.phones);

  // What did the submit change on the shared Contact? Compared against
  // the stored phone list, falling back to the legacy Contact.phone for
  // contacts that predate ContactPhone rows (the form seeds the editor
  // from it, so an untouched legacy number is not a change).
  const stored = row.contact;
  const storedRaw =
    stored.phones.length > 0
      ? stored.phones.map((p) => ({
          label: p.label ?? "",
          number: p.number,
          isPrimary: p.isPrimary,
        }))
      : stored.phone
        ? [{ label: "", number: stored.phone, isPrimary: true }]
        : [];
  // Normalize the stored list the same way as the submitted one (first
  // primary wins, else first) so odd stored data - several primaries,
  // or none - doesn't read as a change and block a notes-only save.
  const storedPrimary = Math.max(
    0,
    storedRaw.findIndex((x) => x.isPrimary)
  );
  const storedPhones = storedRaw.map((p, i) => ({
    ...p,
    isPrimary: i === storedPrimary,
  }));
  // syncContactPhones' normalization: first primary wins, else first.
  const submittedPrimary = Math.max(
    0,
    phones.findIndex((x) => x.isPrimary)
  );
  const submittedPhones = phones.map((p, i) => ({
    label: p.label ?? "",
    number: p.number,
    isPrimary: i === submittedPrimary,
  }));
  const changedContactFields: string[] = [];
  if (stored.name !== data.contactName) changedContactFields.push("name");
  if ((stored.email ?? "") !== (data.contactEmail ?? ""))
    changedContactFields.push("email");
  if ((stored.organization ?? "") !== (data.contactOrganization ?? ""))
    changedContactFields.push("organization");
  if (JSON.stringify(storedPhones) !== JSON.stringify(submittedPhones))
    changedContactFields.push("phones");

  const canEditContact =
    changedContactFields.length === 0 ||
    (await currentUserHasPermission("contacts.edit"));
  if (!canEditContact) {
    return {
      status: "error",
      errors: {
        contactName: [
          `Changing the contact's ${changedContactFields.join(", ")} edits the firm-wide contact record and needs the contacts.edit permission. Revert those fields to save the rest.`,
        ],
      },
      values: raw,
    };
  }

  // Single transaction — Contact + phones + MatterContact — so we
  // never leave one updated and the other stale. Contact edits here
  // propagate to every matter this contact appears on; the UI
  // surfaces that.
  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: row.contactId },
      data: {
        name: data.contactName,
        email: data.contactEmail || null,
        organization: data.contactOrganization || null,
      },
    });
    // syncContactPhones also rewrites Contact.phone to the primary.
    // Skip it only when the phone list is unchanged AND the contact has
    // no ContactPhone rows (a legacy-only Contact.phone that the form
    // echoed back untouched) - syncing would turn that echo into rows
    // or null it. A changed list (including a cleared legacy number)
    // always syncs, so a user can remove a legacy-only number.
    if (changedContactFields.includes("phones") || stored.phones.length > 0) {
      await syncContactPhones(tx, row.contactId, phones);
    }

    const rep =
      !isClient && isRepresented
        ? await resolveRepresentation(tx, {
            mode: data.representationContactMode,
            pickedId: data.representationContactId || null,
            newName: data.newRepresentationName || null,
            newFirm: data.newRepresentationFirm || null,
            newEmail: data.newRepresentationEmail || null,
            newPhone: data.newRepresentationPhone || null,
          })
        : NULL_REPRESENTATION;

    await tx.matterContact.update({
      where: { id: matterContactId },
      data: {
        role: data.role || null,
        notes: data.notes || null,
        isRepresented,
        ...rep,
      },
    });
  });

  await logAuditEntry({
    matterId: row.matterId,
    userId,
    type: "party",
    source: "Parties",
    icon: "user",
    title: `Updated party ${data.contactName}`,
    detail:
      changedContactFields.length > 0
        ? `Contact record changed (${changedContactFields.join(", ")}); party role, notes and representation saved.`
        : "Party role, notes and representation saved.",
  });

  revalidatePath(`/matters/${row.matterId}/parties`);
  revalidatePath(`/matters/${row.matterId}`);
  // Contact may appear on other matters — bust their caches too. The
  // dashboard layout revalidation catches sidebar + matters list.
  revalidatePath("/", "layout");
  return { status: "ok" };
}

export async function removeMatterContact(
  matterContactId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("parties.delete");
  const row = await prisma.matterContact.findUnique({
    where: { id: matterContactId },
    select: {
      id: true,
      matterId: true,
      contactId: true,
      category: true,
      contact: { select: { name: true } },
      matter: { select: { clientId: true } },
    },
  });
  if (!row) return { ok: false, error: "Party not found" };

  // Invariant guard: don't let the UI delete the primary client's
  // MatterContact row — the matter's clientId still points to this
  // contact, so the row would reappear on next load (plus the user
  // expects the Parties tab to always reflect the matter's client).
  // The proper way to change it is via Matter → Edit.
  if (
    row.category === "client" &&
    row.matter?.clientId === row.contactId
  ) {
    return {
      ok: false,
      error:
        "Can't remove the matter's primary client here. Change the client via Matter → Edit first.",
    };
  }

  await prisma.matterContact.delete({ where: { id: matterContactId } });

  await logAuditEntry({
    matterId: row.matterId,
    userId,
    type: "party",
    source: "Parties",
    icon: "user",
    title: `Removed ${row.contact.name} from ${
      PARTY_CATEGORY_LABEL[row.category as keyof typeof PARTY_CATEGORY_LABEL] ??
      row.category
    }`,
  });

  revalidatePath(`/matters/${row.matterId}/parties`);
  revalidatePath(`/matters/${row.matterId}`);
  return { ok: true };
}
