/**
 * Contact directory server actions — create, update, delete, phone
 * management, conflict flagging, and merge.
 *
 * Soft-delete via `isActive = false`. Hard-delete is risky because
 * contacts can be parties on closed matters and we don't want to
 * cascade those off the record. The list query filters `isActive`.
 *
 * Phone is stored both as the denormalized `Contact.phone` and as a
 * primary `ContactPhone` row (matching the parties.ts pattern) so
 * existing reads keep working. Invariant (see the ContactPhone schema
 * comment): when any rows exist, exactly one is primary and its
 * number mirrors onto `Contact.phone`.
 *
 * Auth: gated on the granular contacts.* catalog keys —
 * `contacts.create` (createContact), `contacts.edit` (updateContact,
 * updateContactPhones, setContactConflictStatus, bulkSetContactType),
 * `contacts.delete` (deleteContact, bulkDeactivateContacts), and
 * `contacts.merge` (mergeContacts). Admins short-circuit; other
 * roles need explicit grants via the matrix. `exportContactsCsv`
 * mutates nothing, so it only requires a signed-in session.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { getCurrentUserId } from "@/lib/current-user";
import { buildCsv } from "@/lib/csv";
import {
  BULK_CONTACT_LIMIT,
  CONTACT_TYPES,
  CONTACT_TYPE_LABEL,
  type ContactType,
} from "@/lib/contact-constants";
import {
  normalizeContactPhones,
  phoneDedupeKey,
  type ContactFormState,
} from "@/lib/contact-form";

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
});

/**
 * Firm-scope audit entry for contact-level events (conflict flags,
 * merges). Same fire-and-forget contract as `logActivity`: a failed
 * audit write must never roll back the user's action.
 */
async function logContactActivity(input: {
  userId: string;
  type: string;
  icon: string;
  title: string;
  detail?: string | null;
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        matterId: null,
        userId: input.userId,
        type: input.type,
        icon: input.icon,
        source: "Contacts",
        title: input.title,
        detail: input.detail ?? null,
      },
    });
    // Dashboard "Recent activity" reads this table on every request.
    revalidatePath("/");
  } catch (err) {
    console.warn("[contacts] failed to write activity entry", err);
  }
}

// ── Create ──────────────────────────────────────────────────────────────

export async function createContact(
  _prev: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  await requirePermission("contacts.create");

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
  await requirePermission("contacts.edit");

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
  // one transaction so both stay aligned. This form only edits "the"
  // phone; extra rows added via the Parties tab or the phone manager
  // are preserved, so clearing the field promotes the next row to
  // primary rather than leaving a primary-less set.
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
        // No unique constraint on (contactId, order), so slot the new
        // row after the existing ones — isPrimary alone marks it as
        // "the" phone. Hardcoding order 0 would collide with a
        // non-primary row already at 0 (Parties-tab writes start there).
        const maxOrder = await tx.contactPhone.aggregate({
          where: { contactId },
          _max: { order: true },
        });
        await tx.contactPhone.create({
          data: {
            contactId,
            label: "Primary",
            number: parsed.data.phone,
            isPrimary: true,
            order: (maxOrder._max.order ?? -1) + 1,
          },
        });
      }
    } else {
      await tx.contactPhone.deleteMany({
        where: { contactId, isPrimary: true },
      });
      // Promote the lowest-order survivor so the one-primary invariant
      // holds, and mirror it back onto Contact.phone (the update above
      // nulled it). No survivors → contact genuinely has no phone.
      const next = await tx.contactPhone.findFirst({
        where: { contactId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, number: true },
      });
      if (next) {
        await tx.contactPhone.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
        await tx.contact.update({
          where: { id: contactId },
          data: { phone: next.number },
        });
      }
    }
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return { status: "ok", contactId };
}

// ── Phone list (replace-all) ────────────────────────────────────────────

const phonesInputSchema = z
  .array(
    z.object({
      label: z.string().trim().max(40).catch(""),
      number: z.string().trim().max(80),
      isPrimary: z.boolean().catch(false),
    })
  )
  .max(20, "Too many phone numbers");

/**
 * Replace-all phone management for the contact detail page —
 * add/remove/relabel/reorder/set-primary in one submit. Same
 * strategy as the Parties tab's syncContactPhones: whatever the user
 * submits becomes the contact's phone list (array order = display
 * order), normalized so exactly one entry is primary when any exist,
 * with the primary mirrored onto Contact.phone.
 */
export async function updateContactPhones(
  contactId: string,
  phonesInput: unknown
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("contacts.edit");

  const parsed = phonesInputSchema.safeParse(phonesInput);
  if (!parsed.success) {
    return { ok: false, error: "Invalid phone list" };
  }

  const existing = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Contact not found" };

  const phones = normalizeContactPhones(parsed.data);

  await prisma.$transaction(async (tx) => {
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
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

// ── Conflict flag ───────────────────────────────────────────────────────

const CONFLICT_STATUSES = ["clear", "flagged", "override"] as const;

const CONFLICT_TITLE: Record<(typeof CONFLICT_STATUSES)[number], string> = {
  clear: "Conflict flag cleared",
  flagged: "Contact flagged for conflict",
  override: "Conflict override recorded",
};

/**
 * Manually set / clear the conflict flag the conflict checker
 * normally maintains. A short justification is required — it lands
 * in the firm activity log so the audit trail explains WHY a human
 * overrode (or raised) the flag.
 */
export async function setContactConflictStatus(
  contactId: string,
  status: string,
  justification: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("contacts.edit");

  const parsedStatus = z.enum(CONFLICT_STATUSES).safeParse(status);
  if (!parsedStatus.success) {
    return { ok: false, error: "Unknown conflict status" };
  }
  const reason = justification.trim();
  if (!reason) {
    return { ok: false, error: "A short justification is required" };
  }
  if (reason.length > 500) {
    return { ok: false, error: "Justification is too long (500 chars max)" };
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, name: true },
  });
  if (!contact) return { ok: false, error: "Contact not found" };

  await prisma.contact.update({
    where: { id: contactId },
    data: { conflictStatus: parsedStatus.data },
  });

  await logContactActivity({
    userId,
    type: "conflict",
    icon: "gavel",
    title: `${CONFLICT_TITLE[parsedStatus.data]} — ${contact.name}`,
    detail: reason,
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

// ── Merge ───────────────────────────────────────────────────────────────

/**
 * Merge the `loser` contact into the `survivor`: every reference to
 * the loser is re-pointed at the survivor in one transaction, then
 * the loser is soft-deleted with `mergedIntoId` set so its detail
 * page redirects and old audit entries still resolve.
 *
 * References enumerated from prisma/schema.prisma:
 *   - MatterContact.contactId — respects @@unique([matterId,
 *     contactId, category]): when the survivor already has a row on
 *     the same matter+category, the loser's duplicate is dropped
 *     instead of re-pointed.
 *   - MatterContact.representationContactId (plain updateMany; the
 *     legacy representationName/… text snapshots are left as-is)
 *   - Matter.clientId
 *   - Lead.contactId
 *   - MessengerThread.contactId (unique is (accountId, contactPhone),
 *     not contact — safe to bulk re-point)
 *   - CalendarAttendee.contactId (name/email snapshots stay — they
 *     record what the chip showed at the time)
 *   - Invoice.clientId (relationless contact-id column)
 *   - ContactPhone rows move to the survivor, deduped by
 *     formatting-insensitive number; the survivor's primary wins.
 *
 * Scalar gaps (null email/organization/address/city/state/zip on the
 * survivor) are backfilled from the loser. Non-null survivor fields
 * are never overwritten.
 */
export async function mergeContacts(
  loserId: string,
  survivorId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("contacts.merge");

  if (loserId === survivorId) {
    return { ok: false, error: "Pick a different contact to merge into" };
  }

  const [loser, survivor] = await Promise.all([
    prisma.contact.findUnique({ where: { id: loserId } }),
    prisma.contact.findUnique({ where: { id: survivorId } }),
  ]);
  if (!loser || !survivor) return { ok: false, error: "Contact not found" };
  if (loser.mergedIntoId) {
    return { ok: false, error: "This contact was already merged" };
  }
  if (survivor.mergedIntoId || !survivor.isActive) {
    return {
      ok: false,
      error: "Can't merge into an inactive or already-merged contact",
    };
  }

  await prisma.$transaction(async (tx) => {
    // MatterContact — per-row because of the (matterId, contactId,
    // category) unique: survivor already on the matter in the same
    // category ⇒ drop the loser's duplicate row.
    const loserParties = await tx.matterContact.findMany({
      where: { contactId: loserId },
      select: { id: true, matterId: true, category: true },
    });
    for (const row of loserParties) {
      const dupe = await tx.matterContact.findUnique({
        where: {
          matterId_contactId_category: {
            matterId: row.matterId,
            contactId: survivorId,
            category: row.category,
          },
        },
        select: { id: true },
      });
      if (dupe) {
        await tx.matterContact.delete({ where: { id: row.id } });
      } else {
        await tx.matterContact.update({
          where: { id: row.id },
          data: { contactId: survivorId },
        });
      }
    }

    await tx.matterContact.updateMany({
      where: { representationContactId: loserId },
      data: { representationContactId: survivorId },
    });
    await tx.matter.updateMany({
      where: { clientId: loserId },
      data: { clientId: survivorId },
    });
    await tx.lead.updateMany({
      where: { contactId: loserId },
      data: { contactId: survivorId },
    });
    await tx.messengerThread.updateMany({
      where: { contactId: loserId },
      data: { contactId: survivorId },
    });
    await tx.calendarAttendee.updateMany({
      where: { contactId: loserId },
      data: { contactId: survivorId },
    });
    await tx.invoice.updateMany({
      where: { clientId: loserId },
      data: { clientId: survivorId },
    });

    // Phones: move the loser's rows over, dropping numbers the
    // survivor already has. Survivor keeps its primary; incoming
    // rows land demoted, after the survivor's existing order range.
    const [survivorPhones, loserPhones] = await Promise.all([
      tx.contactPhone.findMany({
        where: { contactId: survivorId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      tx.contactPhone.findMany({
        where: { contactId: loserId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    const seen = new Set(survivorPhones.map((p) => phoneDedupeKey(p.number)));
    let nextOrder =
      survivorPhones.reduce((max, p) => Math.max(max, p.order), -1) + 1;
    for (const p of loserPhones) {
      const key = phoneDedupeKey(p.number);
      if (seen.has(key)) {
        await tx.contactPhone.delete({ where: { id: p.id } });
        continue;
      }
      seen.add(key);
      await tx.contactPhone.update({
        where: { id: p.id },
        data: { contactId: survivorId, isPrimary: false, order: nextOrder++ },
      });
    }

    // Repair the one-primary invariant (survivor may have had zero
    // rows before the move) and resolve the mirrored Contact.phone.
    const combined = await tx.contactPhone.findMany({
      where: { contactId: survivorId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    let primaryNumber = combined.find((p) => p.isPrimary)?.number ?? null;
    if (!primaryNumber && combined.length > 0) {
      await tx.contactPhone.update({
        where: { id: combined[0].id },
        data: { isPrimary: true },
      });
      primaryNumber = combined[0].number;
    }
    // No rows at all ⇒ fall back to the denormalized columns (some
    // contacts predate ContactPhone rows).
    const phone =
      combined.length > 0 ? primaryNumber : (survivor.phone ?? loser.phone);

    // Scalar gap backfill + phone mirror on the survivor.
    await tx.contact.update({
      where: { id: survivorId },
      data: {
        phone,
        email: survivor.email ?? loser.email,
        organization: survivor.organization ?? loser.organization,
        address: survivor.address ?? loser.address,
        city: survivor.city ?? loser.city,
        state: survivor.state ?? loser.state,
        zip: survivor.zip ?? loser.zip,
      },
    });

    // Retire the loser. phone: null keeps the mirror invariant honest
    // (its ContactPhone rows just moved away).
    await tx.contact.update({
      where: { id: loserId },
      data: { isActive: false, mergedIntoId: survivorId, phone: null },
    });
  });

  await logContactActivity({
    userId,
    type: "merge",
    icon: "zap",
    title: `Merged contact "${loser.name}" into "${survivor.name}"`,
    detail:
      "Matters, parties, leads, message threads, calendar invites, invoices, and phone numbers were re-pointed to the surviving record.",
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${loserId}`);
  revalidatePath(`/contacts/${survivorId}`);
  // The merged contact may surface on matters / dashboards anywhere.
  revalidatePath("/", "layout");
  return { ok: true };
}

// ── Delete (soft) ───────────────────────────────────────────────────────

export async function deleteContact(
  contactId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("contacts.delete");

  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!c) return { ok: false, error: "Contact not found" };

  // Always soft-delete (isActive=false). Contacts hang off far more
  // than matters — messenger threads, leads, representation links,
  // calendar attendance — so a hard-delete path (even for "unused"
  // contacts) would need to reason about all of them. Flipping the
  // flag drops the contact from the directory without touching any
  // of those rows.
  await prisma.contact.update({
    where: { id: contactId },
    data: { isActive: false },
  });

  revalidatePath("/contacts");
  return { ok: true };
}

// ── Bulk operations ─────────────────────────────────────────────────────

const bulkIdsSchema = z
  .array(z.string().min(1))
  .min(1, "No contacts selected")
  .max(
    BULK_CONTACT_LIMIT,
    `Too many contacts selected — bulk actions run on up to ${BULK_CONTACT_LIMIT} at a time`
  );

type BulkContactRow = {
  id: string;
  name: string;
  isActive: boolean;
  mergedIntoId: string | null;
};

/**
 * Shared front door for the bulk actions: validate the id list
 * (non-empty, ≤ BULK_CONTACT_LIMIT after dedupe) and load the rows,
 * refusing when any id doesn't resolve — a stale selection should
 * fail loudly, not half-apply. `requireActive` additionally rejects
 * inactive / merged-away rows (the directory never lists them, so
 * hitting this means the selection went stale mid-flight).
 */
async function loadBulkContacts(
  contactIds: unknown,
  opts: { requireActive: boolean }
): Promise<
  { ok: false; error: string } | { ok: true; contacts: BulkContactRow[] }
> {
  const parsed = bulkIdsSchema.safeParse(contactIds);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid selection",
    };
  }
  const ids = [...new Set(parsed.data)];

  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, isActive: true, mergedIntoId: true },
    orderBy: [{ name: "asc" }],
  });
  if (contacts.length !== ids.length) {
    return {
      ok: false,
      error: "Some selected contacts no longer exist — refresh and try again",
    };
  }
  if (opts.requireActive) {
    const stale = contacts.filter((c) => !c.isActive || c.mergedIntoId);
    if (stale.length > 0) {
      return {
        ok: false,
        error:
          "The selection includes inactive or merged contacts — refresh and try again",
      };
    }
  }
  return { ok: true, contacts };
}

/** "A, B, C and 4 more" for bulk audit-entry details. */
function summarizeNames(names: string[], max = 8): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

function pluralContacts(count: number): string {
  return `${count} contact${count === 1 ? "" : "s"}`;
}

/**
 * Bulk re-type: one updateMany setting `type` on every selected
 * contact. All-or-nothing — any invalid id (or an inactive/merged
 * row) rejects the whole batch. One summary audit entry, not N.
 */
export async function bulkSetContactType(
  contactIds: string[],
  type: string
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const userId = await requirePermission("contacts.edit");

  const parsedType = z.enum(CONTACT_TYPES).safeParse(type);
  if (!parsedType.success) {
    return { ok: false, error: "Unknown contact type" };
  }

  const loaded = await loadBulkContacts(contactIds, { requireActive: true });
  if (!loaded.ok) return loaded;

  const res = await prisma.contact.updateMany({
    where: { id: { in: loaded.contacts.map((c) => c.id) } },
    data: { type: parsedType.data },
  });

  await logContactActivity({
    userId,
    type: "bulk",
    icon: "zap",
    title: `Set type to "${CONTACT_TYPE_LABEL[parsedType.data]}" on ${pluralContacts(res.count)}`,
    detail: summarizeNames(loaded.contacts.map((c) => c.name)),
  });

  revalidatePath("/contacts");
  return { ok: true, count: res.count };
}

/**
 * Bulk soft-delete — same semantics as the single `deleteContact`
 * path: flip `isActive` to false and touch nothing else (matter
 * links, threads, leads, invoices all keep their rows), so it only
 * requires that every id exists. Already-inactive rows are a no-op,
 * matching the single path's unconditional flip. One summary audit
 * entry for the whole batch.
 */
export async function bulkDeactivateContacts(
  contactIds: string[]
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const userId = await requirePermission("contacts.delete");

  const loaded = await loadBulkContacts(contactIds, { requireActive: false });
  if (!loaded.ok) return loaded;

  const res = await prisma.contact.updateMany({
    where: { id: { in: loaded.contacts.map((c) => c.id) } },
    data: { isActive: false },
  });

  await logContactActivity({
    userId,
    type: "bulk",
    icon: "zap",
    title: `Deactivated ${pluralContacts(res.count)}`,
    detail: summarizeNames(loaded.contacts.map((c) => c.name)),
  });

  revalidatePath("/contacts");
  return { ok: true, count: res.count };
}

/**
 * CSV export of the selected contacts. Read-only, so it isn't gated
 * on a contacts.* key — any signed-in user who can see the directory
 * can export it (`getCurrentUserId` bounces signed-out callers).
 * The export IS recorded in the firm activity log: for a law firm,
 * "who pulled the contact list" is audit-worthy even without a
 * mutation. Address folds address/city/state/zip into one column.
 */
export async function exportContactsCsv(
  contactIds: string[]
): Promise<
  { ok: true; csv: string; filename: string } | { ok: false; error: string }
> {
  const userId = await getCurrentUserId();

  const loaded = await loadBulkContacts(contactIds, { requireActive: false });
  if (!loaded.ok) return loaded;

  const rows = await prisma.contact.findMany({
    where: { id: { in: loaded.contacts.map((c) => c.id) } },
    orderBy: [{ name: "asc" }],
    select: {
      name: true,
      type: true,
      organization: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      isActive: true,
    },
  });

  const csv = buildCsv(
    ["Name", "Type", "Organization", "Email", "Primary phone", "Address", "Active"],
    rows.map((c) => [
      c.name,
      CONTACT_TYPE_LABEL[c.type as ContactType] ?? c.type,
      c.organization,
      c.email,
      c.phone,
      [c.address, c.city, [c.state, c.zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", "),
      c.isActive ? "yes" : "no",
    ])
  );

  await logContactActivity({
    userId,
    type: "bulk",
    icon: "document",
    title: `Exported ${pluralContacts(rows.length)} to CSV`,
    detail: summarizeNames(rows.map((c) => c.name)),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return { ok: true, csv, filename: `contacts-export-${stamp}.csv` };
}
