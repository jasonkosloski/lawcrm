/**
 * Party server actions.
 *
 * Accepts either `contactId` (pick existing) or `newContactName`
 * (create a new Contact inline), plus the category + optional
 * subrole. One transaction so a failed MatterContact link doesn't
 * leave an orphaned new Contact behind.
 *
 * TODO (auth): gate once RBAC lands.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  PARTY_CATEGORIES,
  type PartyFormState,
} from "@/lib/party-constants";

const PICK_EXISTING = "__existing__";
const CREATE_NEW = "__new__";

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
     *  the rep contact fields below. "no" means pro se. */
    representation: z.enum(["unknown", "yes", "no"]).default("unknown"),
    representationName: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    representationFirm: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    representationEmail: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal("")),
    representationPhone: z
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
  });

export async function createMatterContact(
  matterId: string,
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
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
    } else if (contactId) {
      // Verify the picked contact exists; stale client values
      // shouldn't silently create dangling rows.
      const hit = await tx.contact.findUnique({
        where: { id: contactId },
        select: { id: true },
      });
      if (!hit) throw new Error("Contact not found");
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
    // Keep the contact fields only if the user explicitly said
    // represented=yes; otherwise null them out so stale data from a
    // prior state doesn't linger.
    const repName =
      !isClient && isRepresented ? data.representationName || null : null;
    const repFirm =
      !isClient && isRepresented ? data.representationFirm || null : null;
    const repEmail =
      !isClient && isRepresented ? data.representationEmail || null : null;
    const repPhone =
      !isClient && isRepresented ? data.representationPhone || null : null;

    // Upsert keyed on [matterId, contactId, category] so re-adding
    // the same person in the same category just updates notes/role.
    await tx.matterContact.upsert({
      where: {
        matterId_contactId_category: {
          matterId,
          contactId,
          category: data.category,
        },
      },
      create: {
        matterId,
        contactId,
        category: data.category,
        role: data.role || null,
        notes: data.notes || null,
        isRepresented,
        representationName: repName,
        representationFirm: repFirm,
        representationEmail: repEmail,
        representationPhone: repPhone,
      },
      update: {
        role: data.role || null,
        notes: data.notes || null,
        isRepresented,
        representationName: repName,
        representationFirm: repFirm,
        representationEmail: repEmail,
        representationPhone: repPhone,
      },
    });
  });

  revalidatePath(`/matters/${matterId}/parties`);
  revalidatePath(`/matters/${matterId}`);
  return { status: "ok" };
}

export async function removeMatterContact(
  matterContactId: string
): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.matterContact.findUnique({
    where: { id: matterContactId },
    select: { id: true, matterId: true },
  });
  if (!row) return { ok: false, error: "Party not found" };

  await prisma.matterContact.delete({ where: { id: matterContactId } });

  revalidatePath(`/matters/${row.matterId}/parties`);
  revalidatePath(`/matters/${row.matterId}`);
  return { ok: true };
}
