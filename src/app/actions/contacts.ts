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
 * `contacts.delete` (deleteContact, bulkDeactivateContacts,
 * reactivateContact), and `contacts.merge` (mergeContacts,
 * searchMergeCandidatesAction). Admins short-circuit; other
 * roles need explicit grants via the matrix. `exportContactsCsv`
 * mutates nothing but bulk-exports the directory, so it needs
 * `contacts.export`.
 *
 * Deactivating (single or bulk) is refused for the client of an open
 * matter or the subject of a live lead; a deactivated contact can be
 * brought back with reactivateContact (never a merged-away one).
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { actorSeesAllPortalMatters } from "@/lib/portal/identity-scope";
import {
  requirePermission,
  requirePermissionResult,
} from "@/lib/permission-check";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { todayKey } from "@/lib/format-date";
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
import {
  searchMergeCandidates,
  type MergeCandidateOption,
} from "@/lib/queries/contacts";
import {
  mergeConflictStatus,
  mergeContactNotes,
  mergePartyDetails,
  PARTY_NOTES_MAX,
} from "@/lib/contact-merge";

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

/** Lenient shape check: something@something.tld, no whitespace. Not a
 *  deliverability test - it only catches typos like "dana@" or
 *  "dana example.com". */
const LENIENT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A field error for a malformed email, or null. On edit, an email
 *  that is unchanged from the stored value is never rejected, so old
 *  records that predate this check stay editable. */
function emailFieldError(
  email: string | undefined,
  unchangedFrom?: string | null
): string[] | null {
  const v = (email ?? "").trim();
  if (!v || LENIENT_EMAIL.test(v)) return null;
  if (unchangedFrom != null && v === unchangedFrom.trim()) return null;
  return ["Enter a valid email address"];
}

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
  const userId = await requirePermission("contacts.create");

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const emailError = emailFieldError(parsed.data.email);
  if (emailError) {
    return { status: "error", errors: { email: emailError } };
  }

  // Contact.firmId: "new writes always set it via the action layer"
  // (schema comment). Resolved before the transaction; a user with no
  // firm row simply gets null, as before.
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { firmId: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.contact.create({
      data: {
        firmId: owner?.firmId ?? null,
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

  // Log before redirect() — it throws to unwind the action.
  await logContactActivity({
    userId,
    type: "contact",
    icon: "user",
    title: `Contact created — ${parsed.data.name}`,
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
  const userId = await requirePermission("contacts.edit");

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
    select: {
      id: true,
      name: true,
      type: true,
      email: true,
      phone: true,
      organization: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      notes: true,
    },
  });
  if (!existing) {
    return {
      status: "error",
      errors: { _form: ["Contact no longer exists"] },
    };
  }
  const emailError = emailFieldError(parsed.data.email, existing.email);
  if (emailError) {
    return { status: "error", errors: { email: emailError } };
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

  // Field NAMES only — the log must not become a second copy of PII.
  const changed = (
    [
      ["name", existing.name, parsed.data.name],
      ["type", existing.type, parsed.data.type],
      ["email", existing.email, parsed.data.email || null],
      ["phone", existing.phone, parsed.data.phone || null],
      ["organization", existing.organization, parsed.data.organization || null],
      ["address", existing.address, parsed.data.address || null],
      ["city", existing.city, parsed.data.city || null],
      ["state", existing.state, parsed.data.state || null],
      ["zip", existing.zip, parsed.data.zip || null],
      ["notes", existing.notes, parsed.data.notes || null],
    ] as const
  )
    .filter(([, before, after]) => before !== after)
    .map(([field]) => field);
  if (changed.length > 0) {
    await logContactActivity({
      userId,
      type: "contact",
      icon: "user",
      title: `Contact updated — ${parsed.data.name}`,
      detail: `Changed: ${changed.join(", ")}`,
    });
  }

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
  const userId = await requirePermission("contacts.edit");

  const parsed = phonesInputSchema.safeParse(phonesInput);
  if (!parsed.success) {
    return { ok: false, error: "Invalid phone list" };
  }

  const existing = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, name: true },
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

  await logContactActivity({
    userId,
    type: "contact",
    icon: "user",
    title: `Phone numbers updated — ${existing.name}`,
    detail: `${phones.length} number${phones.length === 1 ? "" : "s"} on file`,
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
 * Manually set / clear a contact's conflict flag. The flag is
 * manual-only: nothing else writes `Contact.conflictStatus`, and the
 * intake conflict matcher (src/lib/conflict-check.ts) does not read it
 * yet - it is a directory-level marker for staff. A short
 * justification is required - it lands in the firm activity log so the
 * audit trail explains WHY a human overrode (or raised) the flag.
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

const MERGE_NOTES_TOO_LONG =
  "The combined internal notes are too long to merge — shorten the notes on one contact first";

/** Thrown inside the merge transaction to roll it back with a
 *  user-facing message (mapped to `{ ok: false }` by the caller). */
class MergeAbort extends Error {}

/**
 * How many matters have one of the two contacts on the client side
 * (Matter.clientId or a category "client" party row) and the other on
 * the opposing side (category "opposing"). Both directions count.
 */
async function countOppositeSideMatters(
  aId: string,
  bId: string
): Promise<number> {
  const [parties, clientOf] = await Promise.all([
    prisma.matterContact.findMany({
      where: { contactId: { in: [aId, bId] } },
      select: { matterId: true, contactId: true, category: true },
    }),
    prisma.matter.findMany({
      where: { clientId: { in: [aId, bId] } },
      select: { id: true, clientId: true },
    }),
  ]);
  const sides = new Map<string, { client: Set<string>; opposing: Set<string> }>();
  const slot = (matterId: string) => {
    let s = sides.get(matterId);
    if (!s) {
      s = { client: new Set(), opposing: new Set() };
      sides.set(matterId, s);
    }
    return s;
  };
  for (const p of parties) {
    if (p.category === "client") slot(p.matterId).client.add(p.contactId);
    if (p.category === "opposing") slot(p.matterId).opposing.add(p.contactId);
  }
  for (const m of clientOf) {
    if (m.clientId) slot(m.id).client.add(m.clientId);
  }
  let count = 0;
  for (const s of sides.values()) {
    const crossed = [aId, bId].some(
      (x) =>
        s.client.has(x) && [...s.opposing].some((other) => other !== x)
    );
    if (crossed) count++;
  }
  return count;
}

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
 * are never overwritten. The loser's internal notes are appended to
 * the survivor's, and the stricter conflict flag wins (flagged >
 * override > clear) so a deliberate attorney flag is never lost.
 */
export async function mergeContacts(
  loserId: string,
  survivorId: string,
  opts?: {
    /** The user saw the "opposite sides of a matter" warning and
     *  wants to merge anyway (e.g. a client who was once adverse). */
    confirmOppositeSides?: boolean;
  }
): Promise<{
  ok: boolean;
  error?: string;
  /** "opposite_sides": the two records sit on opposite sides of a
   *  matter - resubmit with `confirmOppositeSides` to proceed. */
  code?: "opposite_sides";
}> {
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

  // The retired contact's internal notes + conflict flag carry over
  // (its detail page redirects to the survivor, so anything left on
  // the loser would be unreachable). Refuse rather than truncate.
  // (Re-checked against fresh rows inside the transaction below.)
  const mergedNotes = mergeContactNotes(survivor.notes, loser.notes, loser.name);
  if (mergedNotes.tooLong) {
    return { ok: false, error: MERGE_NOTES_TOO_LONG };
  }

  // Merging a client's record into an opposing party's (or the other
  // way round) moves the client's matters, leads and phones onto the
  // wrong person and can't be undone. Warn first; the caller may
  // confirm explicitly (a former adverse party can become a client).
  if (!opts?.confirmOppositeSides) {
    const overlap = await countOppositeSideMatters(loserId, survivorId);
    if (overlap > 0) {
      return {
        ok: false,
        code: "opposite_sides",
        error: `"${loser.name}" and "${survivor.name}" are on opposite sides of ${overlap} matter${overlap === 1 ? "" : "s"} (client vs. opposing party). Merging would make the opposing party the client of record.`,
      };
    }
  }

  // Same refusal for folded party-row notes: the party forms cap notes
  // at PARTY_NOTES_MAX, so a longer merged value would make the row
  // fail validation on its next edit until trimmed by hand.
  const preLoserParties = await prisma.matterContact.findMany({
    where: { contactId: loserId },
  });
  for (const row of preLoserParties) {
    const dupe = await prisma.matterContact.findUnique({
      where: {
        matterId_contactId_category: {
          matterId: row.matterId,
          contactId: survivorId,
          category: row.category,
        },
      },
    });
    if (
      dupe &&
      (mergePartyDetails(dupe, row, loser.name).notes?.length ?? 0) >
        PARTY_NOTES_MAX
    ) {
      return {
        ok: false,
        error:
          "The combined notes on a shared matter party are too long to merge — shorten the party notes on one contact first",
      };
    }
  }

  // Folding two portal identities is an identity-wide change: it moves the
  // loser's portal access (and kills its sign-ins) across every matter it
  // touches. A walled actor must not do that to matters they can't see
  // (ADR-039), so both identities' live matters must all be visible.
  const [preLoserIdentity, preSurvivorIdentity] = await Promise.all([
    prisma.portalIdentity.findUnique({
      where: { contactId: loserId },
      select: { id: true },
    }),
    prisma.portalIdentity.findUnique({
      where: { contactId: survivorId },
      select: { id: true },
    }),
  ]);
  if (preLoserIdentity && preSurvivorIdentity) {
    const [seesLoser, seesSurvivor] = await Promise.all([
      actorSeesAllPortalMatters(userId, preLoserIdentity.id),
      actorSeesAllPortalMatters(userId, preSurvivorIdentity.id),
    ]);
    if (!seesLoser || !seesSurvivor) {
      return {
        ok: false,
        error:
          "Both contacts have client portal access on matters you can't see. Ask someone who can see all of them to merge.",
      };
    }
  }

  let mergedConflict: string;
  /** Portal outcome for the audit row: null = neither had an identity. */
  let portalFold: { moved: true } | { folded: number } | null = null;
  try {
    mergedConflict = await prisma.$transaction(async (tx) => {
      // The checks above ran outside the transaction. Lock both rows
      // (in id order, so two merges can't deadlock) and re-assert the
      // preconditions: a concurrent A→B / B→C merge would otherwise
      // re-point A's references onto a record that was just retired.
      for (const id of [loserId, survivorId].sort()) {
        const locked = await tx.contact.updateMany({
          where:
            id === survivorId
              ? { id, isActive: true, mergedIntoId: null }
              : { id, mergedIntoId: null },
          data: { updatedAt: new Date() },
        });
        if (locked.count !== 1) {
          throw new MergeAbort(
            id === survivorId
              ? "The contact to merge into was changed or merged by someone else — refresh and try again"
              : "This contact was already merged"
          );
        }
      }
      // Merge from the rows as they are NOW (an edit may have landed
      // between the pre-check and the lock).
      const [loser, survivor] = await Promise.all([
        tx.contact.findUniqueOrThrow({ where: { id: loserId } }),
        tx.contact.findUniqueOrThrow({ where: { id: survivorId } }),
      ]);
      const mergedNotes = mergeContactNotes(
        survivor.notes,
        loser.notes,
        loser.name
      );
      if (mergedNotes.tooLong) throw new MergeAbort(MERGE_NOTES_TOO_LONG);
      const nextConflict = mergeConflictStatus(
        survivor.conflictStatus,
        loser.conflictStatus
      );

      // MatterContact — per-row because of the (matterId, contactId,
      // category) unique: survivor already on the matter in the same
      // category ⇒ fold the loser's row details (role, notes,
      // representation) into the survivor's row, then drop the duplicate.
      const loserParties = await tx.matterContact.findMany({
        where: { contactId: loserId },
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
        });
        if (dupe) {
          const merged = mergePartyDetails(dupe, row, loser.name);
          await tx.matterContact.update({
            where: { id: dupe.id },
            data: {
              role: merged.role,
              notes: merged.notes,
              isRepresented: merged.isRepresented,
              representationContactId: merged.representationContactId,
              representationName: merged.representationName,
              representationFirm: merged.representationFirm,
              representationEmail: merged.representationEmail,
              representationPhone: merged.representationPhone,
            },
          });
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
      // Restrict FK: without this a custodian merge would fail.
      await tx.recordsRequest.updateMany({
        where: { custodianContactId: loserId },
        data: { custodianContactId: survivorId },
      });

      // Portal identity (one per contact). Loser-only: re-point it.
      // Both: the survivor's identity keeps its own email and disabled
      // state; the loser's matter access folds in (live if either side
      // was live), then its sessions/tokens/identity go.
      const [loserIdentity, survivorIdentity] = await Promise.all([
        tx.portalIdentity.findUnique({ where: { contactId: loserId } }),
        tx.portalIdentity.findUnique({ where: { contactId: survivorId } }),
      ]);
      if (loserIdentity && !survivorIdentity) {
        await tx.portalIdentity.update({
          where: { id: loserIdentity.id },
          data: { contactId: survivorId },
        });
        portalFold = { moved: true };
      } else if (loserIdentity && survivorIdentity) {
        const loserAccess = await tx.portalMatterAccess.findMany({
          where: { identityId: loserIdentity.id },
        });
        portalFold = { folded: loserAccess.length };
        for (const row of loserAccess) {
          const keep = await tx.portalMatterAccess.findUnique({
            where: {
              identityId_matterId: {
                identityId: survivorIdentity.id,
                matterId: row.matterId,
              },
            },
          });
          if (!keep) {
            await tx.portalMatterAccess.update({
              where: { id: row.id },
              data: { identityId: survivorIdentity.id },
            });
            continue;
          }
          if (keep.revokedAt && !row.revokedAt) {
            await tx.portalMatterAccess.update({
              where: { id: keep.id },
              data: { revokedAt: null, revokedById: null },
            });
          }
          await tx.portalMatterAccess.delete({ where: { id: row.id } });
        }
        await tx.portalSession.deleteMany({
          where: { identityId: loserIdentity.id },
        });
        await tx.portalLoginToken.deleteMany({
          where: { identityId: loserIdentity.id },
        });
        // Client uploads keep their uploader (FK is Restrict).
        await tx.document.updateMany({
          where: { portalUploaderId: loserIdentity.id },
          data: { portalUploaderId: survivorIdentity.id },
        });
        await tx.portalIdentity.delete({ where: { id: loserIdentity.id } });
      }

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
          notes: mergedNotes.notes,
          conflictStatus: nextConflict,
        },
      });

      // Retire the loser. phone: null keeps the mirror invariant honest
      // (its ContactPhone rows just moved away).
      await tx.contact.update({
        where: { id: loserId },
        data: { isActive: false, mergedIntoId: survivorId, phone: null },
      });

      return nextConflict;
    });
  } catch (err) {
    if (err instanceof MergeAbort) return { ok: false, error: err.message };
    throw err;
  }

  await logContactActivity({
    userId,
    type: "merge",
    icon: "zap",
    title: `Merged contact "${loser.name}" into "${survivor.name}"`,
    detail:
      "Matters, parties, leads, message threads, calendar invites, invoices, and phone numbers were re-pointed to the surviving record." +
      (mergedConflict !== survivor.conflictStatus
        ? ` Conflict flag is now "${mergedConflict}" (carried over from the merged contact).`
        : "") +
      (loser.notes?.trim()
        ? " Internal notes were appended to the surviving record."
        : "") +
      portalFoldDetail(portalFold),
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${loserId}`);
  revalidatePath(`/contacts/${survivorId}`);
  // The merged contact may surface on matters / dashboards anywhere.
  revalidatePath("/", "layout");
  return { ok: true };
}

function portalFoldDetail(
  fold: { moved: true } | { folded: number } | null
): string {
  if (!fold) return "";
  if ("moved" in fold) {
    return " Client portal access moved to the surviving record.";
  }
  return ` Portal access folded: ${fold.folded} matter${fold.folded === 1 ? "" : "s"}.`;
}

/**
 * Ends client-portal sign-in for deactivated contacts: disables their
 * portal identity (keeping an earlier disabledAt) and deletes its sessions.
 * Re-enabling is a re-invite after reactivation.
 */
function endPortalAccessFor(contactIds: string[]) {
  return [
    prisma.portalIdentity.updateMany({
      where: { contactId: { in: contactIds }, disabledAt: null },
      data: { disabledAt: new Date() },
    }),
    prisma.portalSession.deleteMany({
      where: { identity: { contactId: { in: contactIds } } },
    }),
  ] as const;
}

/**
 * Typeahead behind the merge dialog's "merge into" picker. Searched on
 * the server (name / organization / email, case-insensitive, 20 max)
 * so every active contact is reachable however large the directory is.
 * Same gate as the merge itself.
 */
export async function searchMergeCandidatesAction(
  contactId: string,
  query: string
): Promise<MergeCandidateOption[]> {
  await requirePermission("contacts.merge");
  if (typeof query !== "string") return [];
  return searchMergeCandidates({
    query: query.slice(0, 100),
    excludeId: contactId,
  });
}

// ── Delete (soft) ───────────────────────────────────────────────────────

export async function deleteContact(
  contactId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("contacts.delete");

  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, name: true },
  });
  if (!c) return { ok: false, error: "Contact not found" };

  // A contact who is the client of / a party on an open matter (or
  // has a live intake) would vanish from the directory, pickers and attendee
  // search while Matter.clientId still points at them.
  const blocked = (await findDeactivationBlockers([c]))[0];
  if (blocked) return { ok: false, error: blocked };

  // Always soft-delete (isActive=false). Contacts hang off far more
  // than matters — messenger threads, leads, representation links,
  // calendar attendance — so a hard-delete path (even for "unused"
  // contacts) would need to reason about all of them. Flipping the
  // flag drops the contact from the directory without touching any
  // of those rows.
  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contactId },
      data: { isActive: false },
    }),
    ...endPortalAccessFor([contactId]),
  ]);

  await logContactActivity({
    userId,
    type: "contact",
    icon: "user",
    title: `Contact deactivated — ${c.name}`,
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}

/** Lead stages that no longer need the contact (the intake is over). */
const CLOSED_LEAD_STAGES = ["converted", "declined"];

/**
 * One message per contact that must not be deactivated yet: the client
 * of a non-archived matter, a party (or a party's counsel) on one, or
 * the subject of a live (not converted / declined) lead. Empty when
 * everything is free to deactivate. Party rows block outright: a
 * deactivated party drops out of pickers and attendee search while the
 * matter still lists them, and the user who deactivates rarely knows
 * the contact is on a live case.
 */
async function findDeactivationBlockers(
  contacts: Array<{ id: string; name: string }>
): Promise<string[]> {
  const ids = contacts.map((c) => c.id);
  const [matters, parties, leads] = await Promise.all([
    prisma.matter.findMany({
      where: { clientId: { in: ids }, isArchived: false },
      select: { id: true, clientId: true },
    }),
    prisma.matterContact.findMany({
      where: {
        matter: { isArchived: false },
        OR: [
          { contactId: { in: ids } },
          { representationContactId: { in: ids } },
        ],
      },
      select: { matterId: true, contactId: true, representationContactId: true },
    }),
    prisma.lead.findMany({
      where: { contactId: { in: ids }, stage: { notIn: CLOSED_LEAD_STAGES } },
      select: { contactId: true },
    }),
  ]);
  const tally = (rows: Array<string | null>) => {
    const m = new Map<string, number>();
    for (const id of rows) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const matterCounts = tally(matters.map((m) => m.clientId));
  const leadCounts = tally(leads.map((l) => l.contactId));
  // Distinct open matters per contact where they sit as a party or as
  // counsel, not counting matters they are already the client of (the
  // client's own party row would double-count).
  const clientMatters = new Set(matters.map((m) => `${m.clientId}:${m.id}`));
  const partyMatters = new Map<string, Set<string>>();
  for (const p of parties) {
    for (const id of [p.contactId, p.representationContactId]) {
      if (!id || !ids.includes(id) || clientMatters.has(`${id}:${p.matterId}`)) continue;
      const set = partyMatters.get(id) ?? new Set<string>();
      set.add(p.matterId);
      partyMatters.set(id, set);
    }
  }
  const messages: string[] = [];
  for (const c of contacts) {
    const parts: string[] = [];
    const nm = matterCounts.get(c.id) ?? 0;
    const np = partyMatters.get(c.id)?.size ?? 0;
    const nl = leadCounts.get(c.id) ?? 0;
    if (nm > 0) parts.push(`the client of ${nm} open matter${nm === 1 ? "" : "s"}`);
    if (np > 0) parts.push(`a party on ${np} open matter${np === 1 ? "" : "s"}`);
    if (nl > 0) parts.push(`on ${nl} active lead${nl === 1 ? "" : "s"}`);
    if (parts.length > 0) {
      const fix =
        np > 0 && nm === 0 && nl === 0
          ? "remove them from the matter's Parties tab or archive the matter"
          : `archive or reassign ${nm + np + nl === 1 ? "it" : "them"}`;
      messages.push(`"${c.name}" is ${parts.join(" and ")} — ${fix} before deactivating`);
    }
  }
  return messages;
}

/**
 * Undo a (non-merge) deactivation: the contact returns to the
 * directory, pickers and attendee search. Gated on contacts.delete -
 * the same key that can deactivate. A contact that was merged away
 * stays retired: its references moved to the survivor.
 */
export async function reactivateContact(
  contactId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("contacts.delete");

  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, name: true, isActive: true, mergedIntoId: true },
  });
  if (!c) return { ok: false, error: "Contact not found" };
  if (c.mergedIntoId) {
    return {
      ok: false,
      error: "This contact was merged into another record and can't be reactivated",
    };
  }
  if (c.isActive) return { ok: true };

  await prisma.contact.update({
    where: { id: contactId },
    data: { isActive: true },
  });

  await logContactActivity({
    userId,
    type: "contact",
    icon: "user",
    title: `Contact reactivated — ${c.name}`,
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
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
  type: string;
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
    select: {
      id: true,
      name: true,
      type: true,
      isActive: true,
      mergedIntoId: true,
    },
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

  // The previous types go on the audit entry (grouped counts) - once
  // overwritten they are recorded nowhere else.
  const was = new Map<string, number>();
  for (const c of loaded.contacts) was.set(c.type, (was.get(c.type) ?? 0) + 1);
  const wasText = [...was.entries()]
    .map(([t, n]) => `${n} ${CONTACT_TYPE_LABEL[t as ContactType] ?? t}`)
    .join(", ");

  await logContactActivity({
    userId,
    type: "bulk",
    icon: "zap",
    title: `Set type to "${CONTACT_TYPE_LABEL[parsedType.data]}" on ${pluralContacts(res.count)}`,
    detail: `${summarizeNames(loaded.contacts.map((c) => c.name))} (was: ${wasText})`,
  });

  revalidatePath("/contacts");
  return { ok: true, count: res.count };
}

/**
 * Bulk soft-delete — same semantics as the single `deleteContact`
 * path: flip `isActive` to false and touch nothing else (matter
 * links, threads, leads, invoices all keep their rows), and the same
 * guard (no client of an open matter / live lead - all-or-nothing).
 * Already-inactive rows are a no-op. One summary audit entry for the
 * whole batch.
 */
export async function bulkDeactivateContacts(
  contactIds: string[]
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const userId = await requirePermission("contacts.delete");

  const loaded = await loadBulkContacts(contactIds, { requireActive: false });
  if (!loaded.ok) return loaded;

  // Same guard as the single deleteContact: all-or-nothing, so a
  // client of an open matter can't slip out of the directory in a batch.
  const blockers = await findDeactivationBlockers(
    loaded.contacts.filter((c) => c.isActive)
  );
  if (blockers.length > 0) {
    return {
      ok: false,
      error:
        blockers.slice(0, 3).join("; ") +
        (blockers.length > 3 ? `; and ${blockers.length - 3} more` : ""),
    };
  }

  const ids = loaded.contacts.map((c) => c.id);
  const [res] = await prisma.$transaction([
    prisma.contact.updateMany({
      where: { id: { in: ids } },
      data: { isActive: false },
    }),
    ...endPortalAccessFor(ids),
  ]);

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
 * CSV export of the selected contacts. Gated on `contacts.export`:
 * seeing one contact at a time is open to the firm, pulling the
 * whole client list out of the app is not. The export IS recorded
 * in the firm activity log: for a law firm,
 * "who pulled the contact list" is audit-worthy even without a
 * mutation. Address folds address/city/state/zip into one column.
 */
export async function exportContactsCsv(
  contactIds: string[]
): Promise<
  { ok: true; csv: string; filename: string } | { ok: false; error: string }
> {
  const gate = await requirePermissionResult("contacts.export");
  if (!gate.ok) return gate;
  const { userId } = gate;

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

  // Viewer-zone "today" (ADR-012): a UTC slice would name the file with
  // tomorrow's date for a Denver user exporting after 6 PM.
  const stamp = todayKey(await getCurrentUserTimeZone());
  return { ok: true, csv, filename: `contacts-export-${stamp}.csv` };
}
