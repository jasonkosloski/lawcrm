/**
 * Contact directory server actions — create, update, delete.
 *
 * Soft-delete via `isActive = false`. Hard-delete is risky because
 * contacts can be parties on closed matters and we don't want to
 * cascade those off the record. The list query filters `isActive`.
 *
 * Phone is stored both as the denormalized `Contact.phone` and as a
 * primary `ContactPhone` row (matching the parties.ts pattern) so
 * existing reads keep working.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CONTACT_TYPES } from "@/lib/queries/contacts";
import type { ContactFormState } from "@/lib/contact-form";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  type: z.enum(CONTACT_TYPES).default("other"),
  email: z.string().trim().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional().or(z.literal("")),
  organization: z.string().trim().max(200).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(80).optional().or(z.literal("")),
  zip: z.string().trim().max(20).optional().or(z.literal("")),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  conflictStatus: z.enum(["clear", "flagged", "override"]).default("clear"),
});

// ── Create ──────────────────────────────────────────────────────────────

export async function createContact(
  _prev: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.contact.create({
      data: {
        name: parsed.data.name,
        type: parsed.data.type,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        organization: parsed.data.organization || null,
        address: parsed.data.address || null,
        city: parsed.data.city || null,
        state: parsed.data.state || null,
        zip: parsed.data.zip || null,
        notes: parsed.data.notes || null,
        conflictStatus: parsed.data.conflictStatus,
      },
      select: { id: true },
    });
    if (parsed.data.phone) {
      await tx.contactPhone.create({
        data: {
          contactId: c.id,
          label: "Primary",
          number: parsed.data.phone,
          isPrimary: true,
          order: 0,
        },
      });
    }
    return c;
  });

  revalidatePath("/contacts");
  redirect(`/contacts/${created.id}`);
}

// ── Update ──────────────────────────────────────────────────────────────

export async function updateContact(
  contactId: string,
  _prev: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const existing = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!existing) {
    return {
      status: "error",
      errors: { _form: ["Contact no longer exists"] },
    };
  }

  // Sync the denormalized phone + the primary ContactPhone row in
  // one transaction so both stay aligned. If phone got cleared, drop
  // the primary phone row (other rows on the contact are left alone).
  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contactId },
      data: {
        name: parsed.data.name,
        type: parsed.data.type,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        organization: parsed.data.organization || null,
        address: parsed.data.address || null,
        city: parsed.data.city || null,
        state: parsed.data.state || null,
        zip: parsed.data.zip || null,
        notes: parsed.data.notes || null,
        conflictStatus: parsed.data.conflictStatus,
      },
    });

    if (parsed.data.phone) {
      // Upsert a primary phone row by (contactId, isPrimary=true).
      const existingPrimary = await tx.contactPhone.findFirst({
        where: { contactId, isPrimary: true },
        select: { id: true },
      });
      if (existingPrimary) {
        await tx.contactPhone.update({
          where: { id: existingPrimary.id },
          data: { number: parsed.data.phone },
        });
      } else {
        await tx.contactPhone.create({
          data: {
            contactId,
            label: "Primary",
            number: parsed.data.phone,
            isPrimary: true,
            order: 0,
          },
        });
      }
    } else {
      await tx.contactPhone.deleteMany({
        where: { contactId, isPrimary: true },
      });
    }
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return { status: "ok", contactId };
}

// ── Delete (soft) ───────────────────────────────────────────────────────

export async function deleteContact(
  contactId: string
): Promise<{ ok: boolean; error?: string }> {
  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      _count: { select: { clientMatters: true, mattersAsClient: true } },
    },
  });
  if (!c) return { ok: false, error: "Contact not found" };

  // If the contact is currently a client or party on any matter,
  // hard-deleting would orphan rows. Soft-delete (isActive=false) so
  // they fall out of the directory without breaking matter pages.
  await prisma.contact.update({
    where: { id: contactId },
    data: { isActive: false },
  });

  revalidatePath("/contacts");
  return { ok: true };
}
