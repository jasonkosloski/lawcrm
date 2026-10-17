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
 *
 * Refusals that a stale tab can cause (party removed, contact merged
 * or deactivated, duplicate add) come back as form state, never as a
 * thrown error that would replace the dashboard with the error page.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { assertChildMatterAccess, assertMatterAccess } from "@/lib/matter-access";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { logAuditEntry } from "@/lib/audit-entry";
import {
  parsePhonesJson,
  phonesSignature,
  replaceContactPhones,
} from "@/lib/contact-phones";
import type { ContactPhoneEntry } from "@/lib/contact-form";
import {
  CREATE_NEW,
  PARTY_CATEGORIES,
  PARTY_CATEGORY_LABEL,
  PICK_EXISTING,
  isLenientEmail,
  isOpposingCounselRole,
  representationFlag,
  type PartyFormState,
} from "@/lib/party-constants";

/** A refusal raised inside a transaction (rolling it back) that maps
 *  to a field error on the form instead of an error-boundary crash. */
class PartyActionError extends Error {
  constructor(
    readonly field: string,
    message: string
  ) {
    super(message);
    this.name = "PartyActionError";
  }
}

const GONE_MESSAGE =
  "This party or contact no longer exists. Reload the page and try again.";

/** Map a transaction failure to form state. Known not-found / FK /
 *  duplicate races become inline errors; anything else is rethrown. */
function partyErrorState(err: unknown): PartyFormState {
  if (err instanceof PartyActionError) {
    return { status: "error", errors: { [err.field]: [err.message] } };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025" || err.code === "P2003") {
      return { status: "error", errors: { _form: [GONE_MESSAGE] } };
    }
    if (err.code === "P2002") {
      return {
        status: "error",
        errors: {
          contactId: ["Already listed in this section — edit that row instead"],
        },
      };
    }
  }
  throw err;
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
 *  MatterContact row. Throws PartyActionError for a missing, merged or
 *  deactivated pick (caller rolls back the surrounding transaction).
 *  `currentRepId` is the party's already-linked rep: keeping that link
 *  is always allowed, so a notes-only save on a party whose attorney
 *  was later deactivated does not start failing. */
async function resolveRepresentation(
  tx: Tx,
  input: {
    mode: typeof PICK_EXISTING | typeof CREATE_NEW;
    pickedId: string | null;
    newName: string | null;
    newFirm: string | null;
    newEmail: string | null;
    newPhone: string | null;
    currentRepId?: string | null;
  }
): Promise<ResolvedRepresentation> {
  if (input.mode === PICK_EXISTING) {
    if (!input.pickedId) {
      throw new PartyActionError(
        "representationContactId",
        "Pick a representing contact or create a new one"
      );
    }
    const c = await tx.contact.findUnique({
      where: { id: input.pickedId },
      select: {
        id: true,
        name: true,
        organization: true,
        email: true,
        phone: true,
        isActive: true,
        mergedIntoId: true,
      },
    });
    if (!c) {
      throw new PartyActionError(
        "representationContactId",
        "That attorney contact no longer exists. Pick another."
      );
    }
    if ((c.mergedIntoId || !c.isActive) && c.id !== input.currentRepId) {
      throw new PartyActionError(
        "representationContactId",
        c.mergedIntoId
          ? "That attorney contact was merged into another. Reload and pick the current one."
          : "That attorney contact is inactive. Pick another."
      );
    }
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
  if (!input.newName) {
    throw new PartyActionError(
      "newRepresentationName",
      "Attorney name is required"
    );
  }
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

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

/** Fields shared by the create and update schemas. */
const representationFields = {
  /** Representation status: "unknown" | "yes" | "no". "yes" unlocks
   *  the rep contact picker below. "no" means pro se. */
  representation: z.enum(["unknown", "yes", "no"]).default("unknown"),
  /** Either pick an existing Contact (rep is the firm's record of
   *  some attorney) or create a new one inline. Same pattern as
   *  the main party picker. */
  representationContactMode: z
    .enum([PICK_EXISTING, CREATE_NEW])
    .default(CREATE_NEW),
  representationContactId: optionalText(100),
  /** Inline-create fields used when representationContactMode === CREATE_NEW.
   *  The created Contact gets type "opposing_counsel". */
  newRepresentationName: optionalText(200),
  newRepresentationFirm: optionalText(200),
  newRepresentationEmail: optionalText(200),
  newRepresentationPhone: optionalText(80),
};

type RepresentationInput = {
  representation: "unknown" | "yes" | "no";
  representationContactMode: typeof PICK_EXISTING | typeof CREATE_NEW;
  representationContactId?: string;
  newRepresentationName?: string;
  newRepresentationEmail?: string;
};

/** Representation validation only matters when explicitly "yes" —
 *  unknown / pro se don't need a rep contact at all. */
function validateRepresentation(
  data: RepresentationInput,
  ctx: z.RefinementCtx
) {
  if (data.representation !== "yes") return;
  if (data.representationContactMode === PICK_EXISTING) {
    if (!data.representationContactId) {
      ctx.addIssue({
        code: "custom",
        path: ["representationContactId"],
        message: "Pick a representing contact or create a new one",
      });
    }
    return;
  }
  if (!data.newRepresentationName) {
    ctx.addIssue({
      code: "custom",
      path: ["newRepresentationName"],
      message: "Attorney name is required",
    });
  }
  if (
    data.newRepresentationEmail &&
    !isLenientEmail(data.newRepresentationEmail)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["newRepresentationEmail"],
      message: "That doesn't look like an email",
    });
  }
}

const partySchema = z
  .object({
    category: z.enum(PARTY_CATEGORIES),
    /** Either the id of an existing contact, or the sentinel
     *  CREATE_NEW to signal the new-contact fields should be used. */
    contactMode: z.enum([PICK_EXISTING, CREATE_NEW]).default(CREATE_NEW),
    contactId: z.string().trim().optional().or(z.literal("")),
    newContactName: optionalText(200),
    newContactEmail: optionalText(200),
    newContactPhone: optionalText(80),
    newContactOrganization: optionalText(200),
    role: optionalText(80),
    notes: optionalText(4000),
    ...representationFields,
  })
  .superRefine((data, ctx) => {
    if (data.contactMode === PICK_EXISTING) {
      if (!data.contactId) {
        ctx.addIssue({
          code: "custom",
          path: ["contactId"],
          message: "Pick an existing contact or switch to new",
        });
      }
    } else {
      if (!data.newContactName) {
        ctx.addIssue({
          code: "custom",
          path: ["newContactName"],
          message: "Name is required for a new contact",
        });
      }
      if (data.newContactEmail && !isLenientEmail(data.newContactEmail)) {
        ctx.addIssue({
          code: "custom",
          path: ["newContactEmail"],
          message: "That doesn't look like an email",
        });
      }
    }

    // Clients are represented by us; their representation never persists.
    if (data.category !== "client") validateRepresentation(data, ctx);
  });

export async function createMatterContact(
  matterId: string,
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
  const userId = await requirePermission("parties.create");
  await assertMatterAccess(matterId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = partySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
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
      errors: { _form: ["Matter not found"] },
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
      };
    }
  }

  let addedName = "";
  try {
    await prisma.$transaction(async (tx) => {
      let contactId = data.contactId || null;

      if (data.contactMode === CREATE_NEW) {
        // Default contact.type guess from category — the firm can edit
        // the underlying contact later. The "opposing" category maps to
        // the Contact type "opposing_counsel" when the subrole names
        // opposing counsel (any casing / spacing), else "other"; expert
        // witnesses map to "expert", lay witnesses to "witness",
        // clients to "client".
        const contactType =
          data.category === "client"
            ? "client"
            : data.category === "expert_witness"
              ? "expert"
              : data.category === "lay_witness"
                ? "witness"
                : data.category === "opposing" &&
                    isOpposingCounselRole(data.role)
                  ? "opposing_counsel"
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
        // Verify the picked contact is still current; a stale client
        // list must not link a deleted, merged or deactivated record.
        const hit = await tx.contact.findUnique({
          where: { id: contactId },
          select: { id: true, name: true, isActive: true, mergedIntoId: true },
        });
        if (!hit) {
          throw new PartyActionError(
            "contactId",
            "That contact no longer exists. Reload the page and pick again."
          );
        }
        if (hit.mergedIntoId) {
          throw new PartyActionError(
            "contactId",
            "That contact was merged into another. Reload the page and pick the current one."
          );
        }
        if (!hit.isActive) {
          throw new PartyActionError(
            "contactId",
            "That contact is inactive. Reload the page and pick another."
          );
        }
        addedName = hit.name;
      }

      if (!contactId) {
        throw new PartyActionError("contactId", "Pick a contact first");
      }

      // Clients are represented by us — don't persist representation
      // data on that category even if somehow submitted.
      const isClient = data.category === "client";
      const isRepresented = representationFlag(data.representation, isClient);
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
  } catch (err) {
    return partyErrorState(err);
  }

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
    contactEmail: optionalText(200),
    contactOrganization: optionalText(200),
    /** JSON-stringified array of { label, number, isPrimary }. Replace-
     *  all strategy: whatever the user submits becomes the new phone
     *  list for the contact. `[]` clears all phones; a missing field
     *  leaves them untouched; a malformed one is rejected. */
    phones: z.string().optional(),
    /** The Contact values the form was loaded with. Only fields the
     *  user changed relative to these are written, and a field that
     *  changed on the server in the meantime is reported as a conflict
     *  rather than reverted. Optional: absent (older bundles) means
     *  "compare against what is stored now". */
    origContactName: z.string().optional(),
    origContactEmail: z.string().optional(),
    origContactOrganization: z.string().optional(),
    origPhones: z.string().optional(),
    role: optionalText(80),
    notes: optionalText(4000),
    ...representationFields,
  })
  .superRefine((data, ctx) => validateRepresentation(data, ctx));

/** Edits the MatterContact join row in place — subrole, notes, and
 *  representation info — and, for convenience, the shared Contact's
 *  name / email / organization / phones (which flow to every matter).
 *
 *  The shared-Contact fields are gated on `contacts.edit` as well as
 *  `parties.edit`: a role denied contacts.edit must not be able to
 *  rewrite the firm-wide directory record through the Parties tab. The
 *  gate only applies to fields the user actually changed, so a user
 *  with parties.edit alone can still save role / notes / representation
 *  (the form always posts the contact fields back unchanged).
 *
 *  Only fields changed relative to the values the form was loaded with
 *  are written; if someone else changed that same field since, the save
 *  is refused with a conflict instead of reverting their edit. Does NOT
 *  change the category (structural; use add/remove). */
export async function updateMatterContact(
  matterContactId: string,
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
  const userId = await requirePermission("parties.edit");
  await assertChildMatterAccess("party", matterContactId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = partyUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const row = await prisma.matterContact.findUnique({
    where: { id: matterContactId },
    select: {
      id: true,
      matterId: true,
      contactId: true,
      category: true,
      representationContactId: true,
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
      errors: { _form: ["This party was removed. Reload the page."] },
    };
  }

  const isClient = row.category === "client";
  const data = parsed.data;
  const isRepresented = representationFlag(data.representation, isClient);

  // Phones: missing = untouched, malformed/over-long = error (never
  // "treat as empty", which would delete every phone).
  let submittedPhones: ContactPhoneEntry[] | null = null;
  if (data.phones !== undefined) {
    const p = parsePhonesJson(data.phones);
    if (!p.ok) {
      return { status: "error", errors: { phones: [p.error] } };
    }
    submittedPhones = p.phones;
  }

  // Stored phone list, falling back to the legacy Contact.phone for
  // contacts that predate ContactPhone rows (the form seeds the editor
  // from it, so an untouched legacy number is not a change). Signatures
  // normalize both sides the same way (first primary wins, else first),
  // so odd stored data - several primaries, or none - doesn't read as a
  // change and block a notes-only save.
  const stored = row.contact;
  const storedPhoneList: ContactPhoneEntry[] =
    stored.phones.length > 0
      ? stored.phones.map((p) => ({
          label: p.label ?? "",
          number: p.number,
          isPrimary: p.isPrimary,
        }))
      : stored.phone
        ? [{ label: "", number: stored.phone, isPrimary: true }]
        : [];
  const storedPhonesSig = phonesSignature(storedPhoneList);

  let origPhonesSig = storedPhonesSig;
  if (data.origPhones !== undefined) {
    const o = parsePhonesJson(data.origPhones);
    if (o.ok) origPhonesSig = phonesSignature(o.phones);
  }

  // Per field: what the form loaded, what is stored now, what was
  // submitted. `write` = the user changed it and it isn't already the
  // stored value; `stale` = ...and the stored value moved since load.
  const fields = [
    {
      key: "name",
      orig: (data.origContactName ?? stored.name).trim(),
      current: stored.name.trim(),
      next: data.contactName,
    },
    {
      key: "email",
      orig: (data.origContactEmail ?? stored.email ?? "").trim(),
      current: (stored.email ?? "").trim(),
      next: data.contactEmail ?? "",
    },
    {
      key: "organization",
      orig: (data.origContactOrganization ?? stored.organization ?? "").trim(),
      current: (stored.organization ?? "").trim(),
      next: data.contactOrganization ?? "",
    },
    {
      key: "phones",
      orig: origPhonesSig,
      current: storedPhonesSig,
      next: submittedPhones ? phonesSignature(submittedPhones) : origPhonesSig,
    },
  ].map((f) => {
    const write = f.next !== f.orig && f.next !== f.current;
    return { ...f, write, stale: write && f.current !== f.orig };
  });
  const changedContactFields = fields.filter((f) => f.write).map((f) => f.key);

  const stale = fields.filter((f) => f.stale).map((f) => f.key);
  if (stale.length > 0) {
    return {
      status: "error",
      errors: {
        _form: [
          `This contact's ${stale.join(", ")} changed since you opened this form. Reload the page to see the latest, then re-apply your edit.`,
        ],
      },
    };
  }

  const emailField = fields.find((f) => f.key === "email")!;
  if (emailField.write && emailField.next && !isLenientEmail(emailField.next)) {
    return {
      status: "error",
      errors: { contactEmail: ["That doesn't look like an email"] },
    };
  }

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
    };
  }

  // Single transaction — Contact + phones + MatterContact — so we
  // never leave one updated and the other stale. Contact edits here
  // propagate to every matter this contact appears on; the UI
  // surfaces that. Untouched contact fields are not rewritten, so a
  // notes-only save can't revert a concurrent edit to the contact.
  try {
    await prisma.$transaction(async (tx) => {
      const contactData: Prisma.ContactUpdateInput = {};
      for (const f of fields) {
        if (!f.write) continue;
        if (f.key === "name") contactData.name = data.contactName;
        if (f.key === "email") contactData.email = data.contactEmail || null;
        if (f.key === "organization")
          contactData.organization = data.contactOrganization || null;
      }
      if (Object.keys(contactData).length > 0) {
        await tx.contact.update({
          where: { id: row.contactId },
          data: contactData,
        });
      }
      // replaceContactPhones also rewrites Contact.phone to the primary.
      if (changedContactFields.includes("phones") && submittedPhones) {
        await replaceContactPhones(tx, row.contactId, submittedPhones);
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
              currentRepId: row.representationContactId,
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
  } catch (err) {
    return partyErrorState(err);
  }

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
  // dashboard layout revalidation catches sidebar + matters list. Only
  // needed when the shared Contact itself changed.
  if (changedContactFields.length > 0) revalidatePath("/", "layout");
  return { status: "ok" };
}

export async function removeMatterContact(
  matterContactId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("parties.delete");
  await assertChildMatterAccess("party", matterContactId);
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

  // deleteMany: a concurrent removal is "already gone", not a P2025.
  const { count } = await prisma.matterContact.deleteMany({
    where: { id: matterContactId },
  });
  if (count === 0) return { ok: false, error: "Party not found" };

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
