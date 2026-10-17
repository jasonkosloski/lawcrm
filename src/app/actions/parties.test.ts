/**
 * Integration tests for the party actions (src/app/actions/parties.ts).
 *
 * Pins the data-loss / authz / audit fixes:
 *   - re-adding a contact already in the same section is refused
 *     instead of overwriting the row's role / notes / representation
 *   - updateMatterContact never nulls a legacy Contact.phone (a contact
 *     with no ContactPhone rows) when the submitted list is empty
 *   - the shared Contact record (name / email / org / phones) needs
 *     contacts.edit WHEN it actually changes; role / notes /
 *     representation only need parties.edit
 *   - create / edit / remove each write a matter-scoped audit row
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Matter-wall asserts are covered in matter-access-writes.test.ts; this
// file exercises other behaviour with no authenticated session user.
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "test-user"),
  assertOptionalMatterAccess: vi.fn(async () => "test-user"),
  assertChildMatterAccess: vi.fn(async () => null),
  canAccessMatter: vi.fn(async () => true),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn(),
}));

import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createMatterContact,
  removeMatterContact,
  updateMatterContact,
} from "@/app/actions/parties";
import { partyInitialState } from "@/lib/party-constants";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedRequirePermission = vi.mocked(requirePermission);
const mockedHasPermission = vi.mocked(currentUserHasPermission);

let userId: string;
let matterId: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId })).userId;
  const { areaId, stageId } = await seedPracticeArea();
  matterId = (
    await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId })
  ).matterId;
  mockedRequirePermission.mockResolvedValue(userId);
  mockedHasPermission.mockResolvedValue(true);
});

describe("createMatterContact re-add", () => {
  test("refuses to re-add a contact already in the section and leaves the row untouched", async () => {
    const { contactId } = await seedContact({ name: "City of Aurora" });
    await prisma.matterContact.create({
      data: {
        matterId,
        contactId,
        category: "opposing",
        role: "Defendant",
        notes: "Served 3/1 via process server",
        isRepresented: true,
        representationName: "Aurora City Attorney",
      },
    });

    const res = await createMatterContact(
      matterId,
      partyInitialState,
      form({
        category: "opposing",
        contactMode: "__existing__",
        contactId,
      })
    );

    expect(res.status).toBe("error");
    expect(res.errors?.contactId?.[0]).toMatch(/already listed/i);
    const row = await prisma.matterContact.findFirstOrThrow({
      where: { matterId, contactId },
    });
    expect(row).toMatchObject({
      role: "Defendant",
      notes: "Served 3/1 via process server",
      isRepresented: true,
      representationName: "Aurora City Attorney",
    });
    expect(await prisma.matterContact.count({ where: { matterId } })).toBe(1);
  });

  test("the same contact can still be added under a different category", async () => {
    const { contactId } = await seedContact({ name: "Dr. Expert" });
    await prisma.matterContact.create({
      data: { matterId, contactId, category: "lay_witness" },
    });
    const res = await createMatterContact(
      matterId,
      partyInitialState,
      form({
        category: "expert_witness",
        contactMode: "__existing__",
        contactId,
      })
    );
    expect(res.status).toBe("ok");
    expect(await prisma.matterContact.count({ where: { matterId } })).toBe(2);
  });

  test("a successful add writes a matter-scoped audit row", async () => {
    const res = await createMatterContact(
      matterId,
      partyInitialState,
      form({
        category: "opposing",
        contactMode: "__new__",
        newContactName: "Officer J. Doe",
        role: "Defendant",
      })
    );
    expect(res.status).toBe("ok");
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, type: "party" },
    });
    expect(entry.title).toBe("Added Officer J. Doe to Opposing parties");
    expect(entry.userId).toBe(userId);
  });
});

async function seedParty(opts: {
  phone?: string | null;
  phones?: Array<{ number: string; isPrimary: boolean }>;
  name?: string;
}) {
  const c = await prisma.contact.create({
    data: {
      name: opts.name ?? "Maria Alvarez",
      type: "client",
      email: "maria@example.com",
      phone: opts.phone ?? null,
    },
  });
  if (opts.phones?.length) {
    await prisma.contactPhone.createMany({
      data: opts.phones.map((p, i) => ({
        contactId: c.id,
        number: p.number,
        isPrimary: p.isPrimary,
        order: i,
      })),
    });
  }
  const mc = await prisma.matterContact.create({
    data: { matterId, contactId: c.id, category: "client" },
  });
  return { contactId: c.id, matterContactId: mc.id };
}

function editForm(over: Record<string, string> = {}): FormData {
  return form({
    contactName: "Maria Alvarez",
    contactEmail: "maria@example.com",
    contactOrganization: "",
    phones: "[]",
    role: "",
    notes: "",
    representation: "unknown",
    ...over,
  });
}

describe("updateMatterContact", () => {
  test("a notes-only save keeps a legacy Contact.phone (no ContactPhone rows)", async () => {
    const { contactId, matterContactId } = await seedParty({
      phone: "(303) 555-0182",
    });
    // The edit form seeds its phone editor from the legacy number, so a
    // notes-only save echoes it back.
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        notes: "Prefers texts",
        phones: JSON.stringify([
          { label: "", number: "(303) 555-0182", isPrimary: true },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBe("(303) 555-0182");
    const mc = await prisma.matterContact.findUniqueOrThrow({
      where: { id: matterContactId },
    });
    expect(mc.notes).toBe("Prefers texts");
  });

  test("a legacy number can be cleared (contacts.edit granted)", async () => {
    const { contactId, matterContactId } = await seedParty({
      phone: "(303) 555-0182",
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({ phones: "[]" })
    );
    expect(res.status).toBe("ok");
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBeNull();
    expect(await prisma.contactPhone.count({ where: { contactId } })).toBe(0);
  });

  test("clearing a legacy-only number without contacts.edit is refused and the number stays", async () => {
    mockedHasPermission.mockResolvedValue(false);
    const { contactId, matterContactId } = await seedParty({
      phone: "(303) 555-0182",
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({ phones: "[]" })
    );
    expect(res.status).toBe("error");
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBe("(303) 555-0182");
  });

  test("a legacy number echoed back unchanged leaves the contact as-is", async () => {
    const { contactId, matterContactId } = await seedParty({
      phone: "(303) 555-0182",
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        phones: JSON.stringify([
          { label: "", number: "(303) 555-0182", isPrimary: true },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBe("(303) 555-0182");
  });

  test("stored data with several primary phones is not a change (notes-only save without contacts.edit)", async () => {
    mockedHasPermission.mockResolvedValue(false);
    const { matterContactId } = await seedParty({
      phones: [
        { number: "(303) 555-0100", isPrimary: true },
        { number: "(303) 555-0101", isPrimary: true },
      ],
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        notes: "only notes",
        phones: JSON.stringify([
          { label: "", number: "(303) 555-0100", isPrimary: true },
          { label: "", number: "(303) 555-0101", isPrimary: false },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    const mc = await prisma.matterContact.findUniqueOrThrow({
      where: { id: matterContactId },
    });
    expect(mc.notes).toBe("only notes");
  });

  test("without contacts.edit, changing the shared contact is refused and nothing is written", async () => {
    mockedHasPermission.mockResolvedValue(false);
    const { contactId, matterContactId } = await seedParty({
      phones: [{ number: "(303) 555-0100", isPrimary: true }],
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        contactName: "Renamed Firm-Wide",
        notes: "new note",
        phones: JSON.stringify([
          { label: "", number: "(303) 555-0100", isPrimary: true },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.contactName?.[0]).toMatch(/contacts\.edit/);
    expect(mockedHasPermission).toHaveBeenCalledWith("contacts.edit");
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.name).toBe("Maria Alvarez");
    const mc = await prisma.matterContact.findUniqueOrThrow({
      where: { id: matterContactId },
    });
    expect(mc.notes).toBeNull();
  });

  test("without contacts.edit, an unchanged-contact save (role/notes only) still works", async () => {
    mockedHasPermission.mockResolvedValue(false);
    const { matterContactId } = await seedParty({
      phones: [{ number: "(303) 555-0100", isPrimary: true }],
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        role: "Plaintiff",
        notes: "ok",
        phones: JSON.stringify([
          { label: "", number: "(303) 555-0100", isPrimary: true },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    expect(mockedHasPermission).not.toHaveBeenCalled();
    const mc = await prisma.matterContact.findUniqueOrThrow({
      where: { id: matterContactId },
    });
    expect(mc).toMatchObject({ role: "Plaintiff", notes: "ok" });
  });

  test("with contacts.edit the contact change goes through and is audited by field name", async () => {
    const { contactId, matterContactId } = await seedParty({});
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({ contactEmail: "new@example.com" })
    );
    expect(res.status).toBe("ok");
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.email).toBe("new@example.com");
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, type: "party" },
    });
    expect(entry.title).toBe("Updated party Maria Alvarez");
    expect(entry.detail).toContain("email");
    expect(entry.detail).not.toContain("new@example.com");
  });
});

describe("removeMatterContact", () => {
  test("removes the row and records who removed which party", async () => {
    const { contactId } = await seedContact({ name: "Officer J. Doe" });
    const mc = await prisma.matterContact.create({
      data: { matterId, contactId, category: "opposing" },
    });
    const res = await removeMatterContact(mc.id);
    expect(res.ok).toBe(true);
    expect(await prisma.matterContact.count({ where: { matterId } })).toBe(0);
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, type: "party" },
    });
    expect(entry.title).toBe("Removed Officer J. Doe from Opposing parties");
    expect(entry.userId).toBe(userId);
  });
});
