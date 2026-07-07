/**
 * Integration tests for the contact directory actions.
 *
 * Covers:
 *   - permission gates: every mutation invokes requirePermission with
 *     its granular contacts.* key (create / edit / delete / merge)
 *     BEFORE touching the DB. The gate's own resolution logic is
 *     covered elsewhere; here we pin the key and the bail-out.
 *   - create: contact + primary ContactPhone row, redirect target
 *   - update phone sync: primary-row upsert, max(order)+1 placement
 *     when non-primary rows already exist (no order-0 collision),
 *     and clear-phone promoting the lowest-order survivor so the
 *     one-primary / Contact.phone-mirror invariant holds
 *   - updateContactPhones: replace-all list management (reorder,
 *     relabel, set-primary, clear) with the same invariants
 *   - setContactConflictStatus: justification required, audit-log fan-out
 *   - mergeContacts: reference re-pointing (incl. the MatterContact
 *     unique-collision dedupe), phone move + dedupe, scalar backfill,
 *     loser retirement via isActive=false + mergedIntoId
 *   - delete: unconditional soft-delete via isActive=false
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createContact,
  deleteContact,
  mergeContacts,
  setContactConflictStatus,
  updateContact,
  updateContactPhones,
} from "@/app/actions/contacts";
import { contactFormInitialState } from "@/lib/contact-form";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedRequirePermission = vi.mocked(requirePermission);

let userId: string;

function contactForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: "Dana Whitfield",
    type: "client",
    email: "dana@example.com",
    phone: "",
    organization: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    notes: "",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  // Gate passes by default; it returns the actor id like the real
  // implementation so the audit-log writes can chain it.
  mockedRequirePermission.mockResolvedValue(userId);
});

// ── Permission gates ────────────────────────────────────────────────────

describe("permission gates", () => {
  test("each action asks for its granular contacts.* key", async () => {
    await createContact(contactFormInitialState, contactForm());
    expect(mockedRequirePermission).toHaveBeenLastCalledWith(
      "contacts.create"
    );

    const { contactId } = await seedContact();
    await updateContact(contactId, contactFormInitialState, contactForm());
    expect(mockedRequirePermission).toHaveBeenLastCalledWith("contacts.edit");

    await updateContactPhones(contactId, []);
    expect(mockedRequirePermission).toHaveBeenLastCalledWith("contacts.edit");

    await setContactConflictStatus(contactId, "flagged", "why");
    expect(mockedRequirePermission).toHaveBeenLastCalledWith("contacts.edit");

    await mergeContacts(contactId, contactId); // self-merge errors AFTER the gate
    expect(mockedRequirePermission).toHaveBeenLastCalledWith(
      "contacts.merge"
    );

    await deleteContact(contactId);
    expect(mockedRequirePermission).toHaveBeenLastCalledWith(
      "contacts.delete"
    );
  });

  // requirePermission redirects ungranted users — simulate the throw
  // and verify the mutations bail before any DB write.
  const bounce = new Error("NEXT_REDIRECT:/");

  test("createContact bails before writing when the gate throws", async () => {
    mockedRequirePermission.mockRejectedValue(bounce);
    await expect(
      createContact(contactFormInitialState, contactForm())
    ).rejects.toThrow(bounce);
    expect(await prisma.contact.count()).toBe(0);
  });

  test("mergeContacts bails before writing when the gate throws", async () => {
    const { contactId: loserId } = await seedContact({ name: "Loser" });
    const { contactId: survivorId } = await seedContact({ name: "Survivor" });
    mockedRequirePermission.mockRejectedValue(bounce);
    await expect(mergeContacts(loserId, survivorId)).rejects.toThrow(bounce);
    const loser = await prisma.contact.findUniqueOrThrow({
      where: { id: loserId },
    });
    expect(loser.isActive).toBe(true);
    expect(loser.mergedIntoId).toBeNull();
  });

  test("deleteContact bails before writing when the gate throws", async () => {
    const { contactId } = await seedContact();
    mockedRequirePermission.mockRejectedValue(bounce);
    await expect(deleteContact(contactId)).rejects.toThrow(bounce);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.isActive).toBe(true);
  });
});

// ── Create ──────────────────────────────────────────────────────────────

describe("createContact", () => {
  test("creates the contact plus a primary phone row and redirects", async () => {
    await createContact(
      contactFormInitialState,
      contactForm({ phone: "(303) 555-0101" })
    );

    const c = await prisma.contact.findFirstOrThrow({
      include: { phones: true },
    });
    expect(c.name).toBe("Dana Whitfield");
    expect(c.phone).toBe("(303) 555-0101");
    expect(c.conflictStatus).toBe("clear");
    expect(c.phones).toHaveLength(1);
    expect(c.phones[0]).toMatchObject({
      number: "(303) 555-0101",
      isPrimary: true,
      order: 0,
    });
    expect(redirect).toHaveBeenCalledWith(`/contacts/${c.id}`);
  });

  test("no phone row is written when phone is blank", async () => {
    await createContact(contactFormInitialState, contactForm());
    expect(await prisma.contactPhone.count()).toBe(0);
  });

  test("returns field errors instead of writing on invalid input", async () => {
    const res = await createContact(
      contactFormInitialState,
      contactForm({ name: "" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.name).toBeTruthy();
    expect(await prisma.contact.count()).toBe(0);
  });
});

// ── Update (profile form) ───────────────────────────────────────────────

describe("updateContact phone sync", () => {
  test("updates the existing primary row in place", async () => {
    const { contactId } = await seedContact();
    await prisma.contactPhone.create({
      data: {
        contactId,
        number: "111",
        isPrimary: true,
        order: 0,
      },
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ phone: "222" })
    );
    expect(res.status).toBe("ok");

    const phones = await prisma.contactPhone.findMany({ where: { contactId } });
    expect(phones).toHaveLength(1);
    expect(phones[0]).toMatchObject({ number: "222", isPrimary: true });
  });

  test("new primary lands at max(order)+1 when non-primary rows exist", async () => {
    // Parties-tab writes start at order 0 — the directory form must
    // not collide with them.
    const { contactId } = await seedContact();
    await prisma.contactPhone.createMany({
      data: [
        { contactId, label: "Office", number: "111", isPrimary: false, order: 0 },
        { contactId, label: "Fax", number: "222", isPrimary: false, order: 1 },
      ],
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ phone: "333" })
    );
    expect(res.status).toBe("ok");

    const phones = await prisma.contactPhone.findMany({
      where: { contactId },
      orderBy: { order: "asc" },
    });
    expect(phones.map((p) => p.order)).toEqual([0, 1, 2]);
    const primary = phones.filter((p) => p.isPrimary);
    expect(primary).toHaveLength(1);
    expect(primary[0]).toMatchObject({ number: "333", order: 2 });
  });

  test("clearing the phone promotes the lowest-order survivor to primary", async () => {
    const { contactId } = await seedContact();
    await prisma.contact.update({
      where: { id: contactId },
      data: { phone: "111" },
    });
    await prisma.contactPhone.createMany({
      data: [
        { contactId, label: "Cell", number: "111", isPrimary: true, order: 0 },
        { contactId, label: "Office", number: "222", isPrimary: false, order: 1 },
        { contactId, label: "Fax", number: "333", isPrimary: false, order: 2 },
      ],
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ phone: "" })
    );
    expect(res.status).toBe("ok");

    const phones = await prisma.contactPhone.findMany({
      where: { contactId },
      orderBy: { order: "asc" },
    });
    // Old primary is gone; exactly one survivor is primary and the
    // denormalized column mirrors it.
    expect(phones).toHaveLength(2);
    expect(phones.filter((p) => p.isPrimary)).toHaveLength(1);
    expect(phones[0]).toMatchObject({ number: "222", isPrimary: true });

    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBe("222");
  });

  test("clearing the only phone leaves no rows and a null Contact.phone", async () => {
    const { contactId } = await seedContact();
    await prisma.contact.update({
      where: { id: contactId },
      data: { phone: "111" },
    });
    await prisma.contactPhone.create({
      data: { contactId, number: "111", isPrimary: true, order: 0 },
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ phone: "" })
    );
    expect(res.status).toBe("ok");

    expect(await prisma.contactPhone.count({ where: { contactId } })).toBe(0);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBeNull();
  });

  test("does not touch conflictStatus — that path requires a justification", async () => {
    const { contactId } = await seedContact();
    await prisma.contact.update({
      where: { id: contactId },
      data: { conflictStatus: "flagged" },
    });

    const res = await updateContact(
      contactId,
      contactFormInitialState,
      contactForm({ name: "Renamed" })
    );
    expect(res.status).toBe("ok");

    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.conflictStatus).toBe("flagged");
  });

  test("errors when the contact no longer exists", async () => {
    const res = await updateContact(
      "gone",
      contactFormInitialState,
      contactForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/no longer exists/i);
  });
});

// ── Phone list (replace-all) ────────────────────────────────────────────

describe("updateContactPhones", () => {
  test("replace-all: reorder + relabel + set-primary in one submit", async () => {
    const { contactId } = await seedContact();
    await prisma.contactPhone.createMany({
      data: [
        { contactId, label: "Cell", number: "111", isPrimary: true, order: 0 },
        { contactId, label: "Office", number: "222", isPrimary: false, order: 1 },
      ],
    });

    const res = await updateContactPhones(contactId, [
      { label: "Work", number: "222", isPrimary: true },
      { label: "Mobile", number: "111", isPrimary: false },
      { label: "", number: "333", isPrimary: false },
    ]);
    expect(res).toEqual({ ok: true });

    const phones = await prisma.contactPhone.findMany({
      where: { contactId },
      orderBy: { order: "asc" },
    });
    expect(phones.map((p) => p.number)).toEqual(["222", "111", "333"]);
    expect(phones.map((p) => p.label)).toEqual(["Work", "Mobile", null]);
    expect(phones.map((p) => p.isPrimary)).toEqual([true, false, false]);
    expect(phones.map((p) => p.order)).toEqual([0, 1, 2]);

    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBe("222");
  });

  test("promotes the first entry when none is marked primary", async () => {
    const { contactId } = await seedContact();
    const res = await updateContactPhones(contactId, [
      { label: "", number: "111", isPrimary: false },
      { label: "", number: "222", isPrimary: false },
    ]);
    expect(res.ok).toBe(true);

    const phones = await prisma.contactPhone.findMany({
      where: { contactId },
      orderBy: { order: "asc" },
    });
    expect(phones.map((p) => p.isPrimary)).toEqual([true, false]);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBe("111");
  });

  test("an empty list clears every row and nulls the mirror", async () => {
    const { contactId } = await seedContact();
    await prisma.contact.update({
      where: { id: contactId },
      data: { phone: "111" },
    });
    await prisma.contactPhone.create({
      data: { contactId, number: "111", isPrimary: true, order: 0 },
    });

    const res = await updateContactPhones(contactId, []);
    expect(res.ok).toBe(true);

    expect(await prisma.contactPhone.count({ where: { contactId } })).toBe(0);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBeNull();
  });

  test("rejects a malformed payload without writing", async () => {
    const { contactId } = await seedContact();
    await prisma.contactPhone.create({
      data: { contactId, number: "111", isPrimary: true, order: 0 },
    });

    const res = await updateContactPhones(contactId, "not-an-array");
    expect(res.ok).toBe(false);
    expect(await prisma.contactPhone.count({ where: { contactId } })).toBe(1);
  });

  test("errors when the contact doesn't exist", async () => {
    const res = await updateContactPhones("gone", []);
    expect(res).toEqual({ ok: false, error: "Contact not found" });
  });
});

// ── Conflict flag ───────────────────────────────────────────────────────

describe("setContactConflictStatus", () => {
  test("sets the status and writes a justified audit entry", async () => {
    const { contactId } = await seedContact({ name: "Riley Chen" });

    const res = await setContactConflictStatus(
      contactId,
      "flagged",
      "Adverse party on Smith v. Jones"
    );
    expect(res).toEqual({ ok: true });

    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.conflictStatus).toBe("flagged");

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { type: "conflict" },
    });
    expect(entry.userId).toBe(userId);
    expect(entry.title).toContain("Riley Chen");
    expect(entry.detail).toBe("Adverse party on Smith v. Jones");
    expect(entry.matterId).toBeNull();
  });

  test("requires a non-empty justification", async () => {
    const { contactId } = await seedContact();
    const res = await setContactConflictStatus(contactId, "flagged", "   ");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/justification/i);

    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.conflictStatus).toBe("clear");
    expect(await prisma.activityLog.count()).toBe(0);
  });

  test("rejects an unknown status", async () => {
    const { contactId } = await seedContact();
    const res = await setContactConflictStatus(contactId, "maybe", "because");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown/i);
  });

  test("errors when the contact doesn't exist", async () => {
    const res = await setContactConflictStatus("gone", "clear", "why");
    expect(res).toEqual({ ok: false, error: "Contact not found" });
  });
});

// ── Merge ───────────────────────────────────────────────────────────────

describe("mergeContacts", () => {
  test("re-points party rows and drops the loser's duplicates on unique collision", async () => {
    const { areaId, stageId } = await seedPracticeArea();
    const m1 = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Matter One",
    });
    const m2 = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Matter Two",
    });
    const { contactId: loserId } = await seedContact({ name: "Dup" });
    const { contactId: survivorId } = await seedContact({ name: "Canonical" });

    // Collision: both on m1 as "opposing" → loser's row must be dropped.
    await seedMatterContact({
      matterId: m1.matterId,
      contactId: loserId,
      category: "opposing",
    });
    await seedMatterContact({
      matterId: m1.matterId,
      contactId: survivorId,
      category: "opposing",
    });
    // No collision: loser on m2 as witness → re-pointed.
    await seedMatterContact({
      matterId: m2.matterId,
      contactId: loserId,
      category: "lay_witness",
    });

    const res = await mergeContacts(loserId, survivorId);
    expect(res).toEqual({ ok: true });

    expect(
      await prisma.matterContact.count({ where: { contactId: loserId } })
    ).toBe(0);
    const m1Rows = await prisma.matterContact.findMany({
      where: { matterId: m1.matterId },
    });
    expect(m1Rows).toHaveLength(1);
    expect(m1Rows[0]).toMatchObject({
      contactId: survivorId,
      category: "opposing",
    });
    const m2Row = await prisma.matterContact.findFirstOrThrow({
      where: { matterId: m2.matterId },
    });
    expect(m2Row).toMatchObject({
      contactId: survivorId,
      category: "lay_witness",
    });
  });

  test("re-points every other loser reference (client, rep, lead, thread, attendee, invoice)", async () => {
    const { areaId, stageId } = await seedPracticeArea();
    const m = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const { contactId: loserId } = await seedContact({ name: "Dup" });
    const { contactId: survivorId } = await seedContact({ name: "Canonical" });
    const { contactId: partyId } = await seedContact({
      name: "Some Party",
      type: "other",
    });

    await prisma.matter.update({
      where: { id: m.matterId },
      data: { clientId: loserId },
    });
    const repRow = await prisma.matterContact.create({
      data: {
        matterId: m.matterId,
        contactId: partyId,
        category: "opposing",
        representationContactId: loserId,
      },
      select: { id: true },
    });
    const lead = await prisma.lead.create({
      data: { name: "Old intake", contactId: loserId },
      select: { id: true },
    });
    const account = await prisma.messengerAccount.create({
      data: { phoneNumber: "+13035550000" },
      select: { id: true },
    });
    const thread = await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+17205550199",
        contactId: loserId,
        lastItemAt: new Date(),
      },
      select: { id: true },
    });
    const event = await prisma.calendarEvent.create({
      data: {
        title: "Deposition",
        startTime: new Date("2026-07-10T10:00:00Z"),
        endTime: new Date("2026-07-10T11:00:00Z"),
      },
      select: { id: true },
    });
    const attendee = await prisma.calendarAttendee.create({
      data: { eventId: event.id, contactId: loserId, name: "Dup" },
      select: { id: true },
    });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-001",
        matterId: m.matterId,
        clientId: loserId,
        issueDate: new Date(),
        dueDate: new Date(),
      },
      select: { id: true },
    });

    const res = await mergeContacts(loserId, survivorId);
    expect(res).toEqual({ ok: true });

    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: m.matterId } }))
        .clientId
    ).toBe(survivorId);
    expect(
      (
        await prisma.matterContact.findUniqueOrThrow({
          where: { id: repRow.id },
        })
      ).representationContactId
    ).toBe(survivorId);
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }))
        .contactId
    ).toBe(survivorId);
    expect(
      (
        await prisma.messengerThread.findUniqueOrThrow({
          where: { id: thread.id },
        })
      ).contactId
    ).toBe(survivorId);
    expect(
      (
        await prisma.calendarAttendee.findUniqueOrThrow({
          where: { id: attendee.id },
        })
      ).contactId
    ).toBe(survivorId);
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
        .clientId
    ).toBe(survivorId);
  });

  test("moves phones, dedupes formatting-insensitively, keeps the survivor's primary", async () => {
    const { contactId: loserId } = await seedContact({ name: "Dup" });
    const { contactId: survivorId } = await seedContact({ name: "Canonical" });
    await prisma.contact.update({
      where: { id: survivorId },
      data: { phone: "(303) 555-0101" },
    });
    await prisma.contactPhone.create({
      data: {
        contactId: survivorId,
        label: "Cell",
        number: "(303) 555-0101",
        isPrimary: true,
        order: 0,
      },
    });
    await prisma.contactPhone.createMany({
      data: [
        // Same number, different formatting → dropped, not duplicated.
        {
          contactId: loserId,
          label: "Mobile",
          number: "303.555.0101",
          isPrimary: true,
          order: 0,
        },
        {
          contactId: loserId,
          label: "Office",
          number: "720-555-0199",
          isPrimary: false,
          order: 1,
        },
      ],
    });

    const res = await mergeContacts(loserId, survivorId);
    expect(res).toEqual({ ok: true });

    expect(
      await prisma.contactPhone.count({ where: { contactId: loserId } })
    ).toBe(0);
    const phones = await prisma.contactPhone.findMany({
      where: { contactId: survivorId },
      orderBy: { order: "asc" },
    });
    expect(phones).toHaveLength(2);
    expect(phones[0]).toMatchObject({
      number: "(303) 555-0101",
      isPrimary: true,
      order: 0,
    });
    expect(phones[1]).toMatchObject({
      number: "720-555-0199",
      isPrimary: false,
      order: 1,
    });

    const survivor = await prisma.contact.findUniqueOrThrow({
      where: { id: survivorId },
    });
    expect(survivor.phone).toBe("(303) 555-0101");
  });

  test("promotes an incoming phone to primary when the survivor had none", async () => {
    const { contactId: loserId } = await seedContact({ name: "Dup" });
    const { contactId: survivorId } = await seedContact({ name: "Canonical" });
    await prisma.contact.update({
      where: { id: loserId },
      data: { phone: "111" },
    });
    await prisma.contactPhone.create({
      data: { contactId: loserId, number: "111", isPrimary: true, order: 0 },
    });

    const res = await mergeContacts(loserId, survivorId);
    expect(res).toEqual({ ok: true });

    const phones = await prisma.contactPhone.findMany({
      where: { contactId: survivorId },
    });
    expect(phones).toHaveLength(1);
    expect(phones[0]).toMatchObject({ number: "111", isPrimary: true });

    const survivor = await prisma.contact.findUniqueOrThrow({
      where: { id: survivorId },
    });
    expect(survivor.phone).toBe("111");
  });

  test("backfills only the survivor's null scalars from the loser", async () => {
    const { contactId: loserId } = await seedContact({
      name: "Dup",
      email: "dup@example.com",
      organization: "Duplicate LLC",
    });
    await prisma.contact.update({
      where: { id: loserId },
      data: { address: "1 Main St", city: "Denver", state: "CO", zip: "80202" },
    });
    const { contactId: survivorId } = await seedContact({
      name: "Canonical",
      email: null,
      organization: "Canonical Corp",
    });

    const res = await mergeContacts(loserId, survivorId);
    expect(res).toEqual({ ok: true });

    const survivor = await prisma.contact.findUniqueOrThrow({
      where: { id: survivorId },
    });
    // Null gaps filled…
    expect(survivor.email).toBe("dup@example.com");
    expect(survivor.address).toBe("1 Main St");
    expect(survivor.city).toBe("Denver");
    expect(survivor.state).toBe("CO");
    expect(survivor.zip).toBe("80202");
    // …but existing values never overwritten.
    expect(survivor.organization).toBe("Canonical Corp");
  });

  test("retires the loser and writes an audit entry naming both", async () => {
    const { contactId: loserId } = await seedContact({ name: "Dup" });
    const { contactId: survivorId } = await seedContact({ name: "Canonical" });

    const res = await mergeContacts(loserId, survivorId);
    expect(res).toEqual({ ok: true });

    const loser = await prisma.contact.findUniqueOrThrow({
      where: { id: loserId },
    });
    expect(loser.isActive).toBe(false);
    expect(loser.mergedIntoId).toBe(survivorId);

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { type: "merge" },
    });
    expect(entry.userId).toBe(userId);
    expect(entry.title).toContain("Dup");
    expect(entry.title).toContain("Canonical");
  });

  test("guards: self-merge, missing contacts, re-merge, retired survivor", async () => {
    const { contactId } = await seedContact({ name: "Solo" });
    expect((await mergeContacts(contactId, contactId)).ok).toBe(false);
    expect((await mergeContacts(contactId, "gone")).ok).toBe(false);
    expect((await mergeContacts("gone", contactId)).ok).toBe(false);

    const { contactId: survivorId } = await seedContact({ name: "Canonical" });
    await mergeContacts(contactId, survivorId);
    // The loser can't be merged twice…
    expect((await mergeContacts(contactId, survivorId)).ok).toBe(false);
    // …and a merged-away / inactive record can't be a survivor.
    const { contactId: freshId } = await seedContact({ name: "Fresh" });
    expect((await mergeContacts(freshId, contactId)).ok).toBe(false);

    const fresh = await prisma.contact.findUniqueOrThrow({
      where: { id: freshId },
    });
    expect(fresh.isActive).toBe(true);
    expect(fresh.mergedIntoId).toBeNull();
  });
});

// ── Delete (soft) ───────────────────────────────────────────────────────

describe("deleteContact", () => {
  test("always soft-deletes — the row survives with isActive=false", async () => {
    const { contactId } = await seedContact();
    const res = await deleteContact(contactId);
    expect(res.ok).toBe(true);

    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.isActive).toBe(false);
  });

  test("reports a missing contact", async () => {
    const res = await deleteContact("gone");
    expect(res).toEqual({ ok: false, error: "Contact not found" });
  });
});
