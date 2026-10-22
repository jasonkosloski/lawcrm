/**
 * Integration tests for the party actions' integrity paths
 * (src/app/actions/parties.ts), complementing parties.test.ts:
 *
 *   - permission keys: parties.create / parties.edit / parties.delete
 *   - contact-type inference from category + free-text subrole
 *   - representation: pick / create / pro se / client / unknown
 *   - stale or tampered ids come back as form errors, never throws
 *   - inactive / merged contacts are refused (an already-linked
 *     inactive attorney stays linked)
 *   - phones: malformed / over-long lists are errors (never "clear
 *     all"), missing field leaves phones alone, one primary, mirror
 *   - a notes-only save never rewrites the shared Contact, and a
 *     concurrent edit to a field the user changed is a conflict, not
 *     a silent revert
 *   - primary-client removal guard
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

import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
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
  matterId = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId })).matterId;
  mockedRequirePermission.mockResolvedValue(userId);
  mockedHasPermission.mockResolvedValue(true);
});

const add = (fields: Record<string, string>) =>
  createMatterContact(matterId, partyInitialState, form({ contactMode: "__new__", ...fields }));

describe("permission keys", () => {
  test("each action gates on its own granular key", async () => {
    const { contactId } = await seedContact({ name: "X" });
    const mc = await prisma.matterContact.create({
      data: { matterId, contactId, category: "other" },
    });
    await add({ category: "other", newContactName: "Y" });
    expect(mockedRequirePermission).toHaveBeenLastCalledWith("parties.create");
    await updateMatterContact(mc.id, partyInitialState, form({ contactName: "X" }));
    expect(mockedRequirePermission).toHaveBeenLastCalledWith("parties.edit");
    await removeMatterContact(mc.id);
    expect(mockedRequirePermission).toHaveBeenLastCalledWith("parties.delete");
  });

  test("a denied gate stops before touching the database", async () => {
    mockedRequirePermission.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(add({ category: "other", newContactName: "Nope" })).rejects.toThrow();
    expect(await prisma.contact.count()).toBe(0);
  });
});

describe("createMatterContact - new contact type", () => {
  const typeOf = async (fields: Record<string, string>) => {
    const res = await add(fields);
    expect(res.status).toBe("ok");
    return (
      await prisma.contact.findFirstOrThrow({
        where: { name: fields.newContactName },
      })
    ).type;
  };

  test.each([
    ["opposing_counsel"],
    ["Opposing counsel"],
    ["opposing counsel"],
    ["  OPPOSING-COUNSEL "],
  ])("opposing subrole %j creates an opposing_counsel contact", async (role) => {
    expect(await typeOf({ category: "opposing", newContactName: "Jane", role })).toBe(
      "opposing_counsel",
    );
  });

  test("other opposing subroles stay 'other' (defendant is not counsel)", async () => {
    expect(
      await typeOf({
        category: "opposing",
        newContactName: "Acme",
        role: "Defendant",
      }),
    ).toBe("other");
  });

  test("categories map to client / expert / witness", async () => {
    expect(await typeOf({ category: "client", newContactName: "C" })).toBe("client");
    expect(await typeOf({ category: "expert_witness", newContactName: "E" })).toBe("expert");
    expect(await typeOf({ category: "lay_witness", newContactName: "W" })).toBe("witness");
  });

  test("the single phone becomes a primary ContactPhone row", async () => {
    await add({
      category: "other",
      newContactName: "Pat",
      newContactPhone: "(303) 555-0100",
    });
    const c = await prisma.contact.findFirstOrThrow({
      where: { name: "Pat" },
      include: { phones: true },
    });
    expect(c.phone).toBe("(303) 555-0100");
    expect(c.phones).toHaveLength(1);
    expect(c.phones[0].isPrimary).toBe(true);
  });

  test("a bad new-contact email is a field error and creates nothing", async () => {
    const res = await add({
      category: "other",
      newContactName: "Pat",
      newContactEmail: "not-an-email",
    });
    expect(res.status).toBe("error");
    expect(res.errors?.newContactEmail).toBeDefined();
    expect(await prisma.contact.count()).toBe(0);
  });
});

describe("createMatterContact - representation", () => {
  test("pick an existing attorney: FK + mirrored fields", async () => {
    const { contactId: atty } = await seedContact({
      name: "Sonia Steele",
      organization: "Steele & Marsh",
      email: "sonia@steelemarsh.example",
      type: "opposing_counsel",
    });
    const res = await add({
      category: "opposing",
      newContactName: "Dana",
      representation: "yes",
      representationContactMode: "__existing__",
      representationContactId: atty,
    });
    expect(res.status).toBe("ok");
    const mc = await prisma.matterContact.findFirstOrThrow({
      where: { matterId },
    });
    expect(mc).toMatchObject({
      isRepresented: true,
      representationContactId: atty,
      representationName: "Sonia Steele",
      representationFirm: "Steele & Marsh",
    });
  });

  test("create a new attorney inline as opposing_counsel", async () => {
    await add({
      category: "opposing",
      newContactName: "Dana",
      representation: "yes",
      representationContactMode: "__new__",
      newRepresentationName: "New Atty",
      newRepresentationPhone: "(720) 555-0100",
    });
    const atty = await prisma.contact.findFirstOrThrow({
      where: { name: "New Atty" },
      include: { phones: true },
    });
    expect(atty.type).toBe("opposing_counsel");
    expect(atty.phones).toHaveLength(1);
    const mc = await prisma.matterContact.findFirstOrThrow({
      where: { matterId },
    });
    expect(mc.representationContactId).toBe(atty.id);
  });

  test("pro se and unknown persist no attorney", async () => {
    await add({
      category: "opposing",
      newContactName: "Pro Se Guy",
      representation: "no",
    });
    await add({
      category: "opposing",
      newContactName: "Unknown Guy",
      representation: "unknown",
    });
    const rows = await prisma.matterContact.findMany({
      where: { matterId },
      include: { contact: true },
    });
    const byName = Object.fromEntries(rows.map((r) => [r.contact.name, r]));
    expect(byName["Pro Se Guy"].isRepresented).toBe(false);
    expect(byName["Unknown Guy"].isRepresented).toBeNull();
    expect(byName["Pro Se Guy"].representationContactId).toBeNull();
  });

  test("clients never persist representation even if posted", async () => {
    await add({
      category: "client",
      newContactName: "Client Person",
      representation: "yes",
      newRepresentationName: "Should Not Exist",
    });
    const mc = await prisma.matterContact.findFirstOrThrow({
      where: { matterId },
    });
    expect(mc.isRepresented).toBeNull();
    expect(mc.representationContactId).toBeNull();
    expect(await prisma.contact.count({ where: { name: "Should Not Exist" } })).toBe(0);
  });

  test("an unknown attorney id rolls the whole add back (no orphan contact)", async () => {
    const res = await add({
      category: "opposing",
      newContactName: "Orphan Risk",
      representation: "yes",
      representationContactMode: "__existing__",
      representationContactId: "does-not-exist",
    });
    expect(res.status).toBe("error");
    expect(res.errors?.representationContactId?.[0]).toMatch(/no longer exists/i);
    expect(await prisma.contact.count({ where: { name: "Orphan Risk" } })).toBe(0);
    expect(await prisma.matterContact.count({ where: { matterId } })).toBe(0);
  });

  test("an inactive or merged attorney cannot be newly linked", async () => {
    const { contactId: inactive } = await seedContact({
      name: "Retired Atty",
      type: "opposing_counsel",
      isActive: false,
    });
    const res = await add({
      category: "opposing",
      newContactName: "Dana",
      representation: "yes",
      representationContactMode: "__existing__",
      representationContactId: inactive,
    });
    expect(res.status).toBe("error");
    expect(res.errors?.representationContactId?.[0]).toMatch(/inactive/i);

    const { contactId: survivor } = await seedContact({ name: "Survivor" });
    const { contactId: merged } = await seedContact({
      name: "Merged Atty",
      isActive: false,
    });
    await prisma.contact.update({
      where: { id: merged },
      data: { mergedIntoId: survivor },
    });
    const res2 = await add({
      category: "opposing",
      newContactName: "Dana",
      representation: "yes",
      representationContactMode: "__existing__",
      representationContactId: merged,
    });
    expect(res2.errors?.representationContactId?.[0]).toMatch(/merged/i);
  });
});

describe("createMatterContact - stale picks", () => {
  test("picking a deleted / merged / inactive contact returns a field error", async () => {
    const missing = await createMatterContact(
      matterId,
      partyInitialState,
      form({
        category: "lay_witness",
        contactMode: "__existing__",
        contactId: "gone",
      }),
    );
    expect(missing.status).toBe("error");
    expect(missing.errors?.contactId?.[0]).toMatch(/no longer exists/i);

    const { contactId: inactive } = await seedContact({ isActive: false });
    const res = await createMatterContact(
      matterId,
      partyInitialState,
      form({
        category: "lay_witness",
        contactMode: "__existing__",
        contactId: inactive,
      }),
    );
    expect(res.errors?.contactId?.[0]).toMatch(/inactive/i);

    const { contactId: target } = await seedContact({ name: "Target" });
    const { contactId: merged } = await seedContact({ isActive: false });
    await prisma.contact.update({
      where: { id: merged },
      data: { mergedIntoId: target },
    });
    const res2 = await createMatterContact(
      matterId,
      partyInitialState,
      form({
        category: "lay_witness",
        contactMode: "__existing__",
        contactId: merged,
      }),
    );
    expect(res2.errors?.contactId?.[0]).toMatch(/merged/i);
    expect(await prisma.matterContact.count({ where: { matterId } })).toBe(0);
  });

  test("an unknown matter is a form error, not a throw", async () => {
    const res = await createMatterContact(
      "no-such-matter",
      partyInitialState,
      form({
        category: "other",
        contactMode: "__new__",
        newContactName: "Z",
      }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/matter not found/i);
  });
});

async function seedParty(opts: {
  category?: string;
  phones?: Array<{ label?: string; number: string; isPrimary: boolean }>;
  email?: string | null;
  representationContactId?: string | null;
}) {
  const c = await prisma.contact.create({
    data: {
      name: "Maria Alvarez",
      type: "client",
      email: opts.email === undefined ? "maria@example.com" : opts.email,
      phone: opts.phones?.find((p) => p.isPrimary)?.number ?? null,
    },
  });
  if (opts.phones?.length) {
    await prisma.contactPhone.createMany({
      data: opts.phones.map((p, i) => ({
        contactId: c.id,
        label: p.label ?? null,
        number: p.number,
        isPrimary: p.isPrimary,
        order: i,
      })),
    });
  }
  const mc = await prisma.matterContact.create({
    data: {
      matterId,
      contactId: c.id,
      category: opts.category ?? "opposing",
      ...(opts.representationContactId
        ? { isRepresented: true, representationContactId: opts.representationContactId }
        : {}),
    },
  });
  return { contactId: c.id, matterContactId: mc.id };
}

function editForm(over: Record<string, string> = {}): FormData {
  return form({
    contactName: "Maria Alvarez",
    contactEmail: "maria@example.com",
    contactOrganization: "",
    role: "",
    notes: "",
    representation: "unknown",
    ...over,
  });
}

const phoneJson = (entries: Array<{ label?: string; number: string; isPrimary?: boolean }>) =>
  JSON.stringify(
    entries.map((e) => ({
      label: e.label ?? "",
      number: e.number,
      isPrimary: e.isPrimary ?? false,
    })),
  );

describe("updateMatterContact - phones", () => {
  const two = [
    { label: "Mobile", number: "(303) 555-0100", isPrimary: true },
    { label: "Office", number: "(303) 555-0101", isPrimary: false },
  ];

  test("malformed phones JSON is an error and every phone survives", async () => {
    const { contactId, matterContactId } = await seedParty({ phones: two });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({ phones: "{not json" }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.phones).toBeDefined();
    expect(await prisma.contactPhone.count({ where: { contactId } })).toBe(2);
  });

  test("a label over 40 characters is an error, not a silently dropped phone", async () => {
    const { contactId, matterContactId } = await seedParty({ phones: two });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        phones: phoneJson([
          { number: "(303) 555-0100", isPrimary: true },
          {
            label: "Office - front desk, ask for records custodian",
            number: "(303) 555-0101",
          },
        ]),
      }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.phones?.[0]).toMatch(/40/);
    expect(await prisma.contactPhone.count({ where: { contactId } })).toBe(2);
  });

  test("more than 20 phones is rejected", async () => {
    const { matterContactId } = await seedParty({ phones: two });
    const many = Array.from({ length: 21 }, (_, i) => ({
      number: `555-01${String(i).padStart(2, "0")}`,
    }));
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({ phones: phoneJson(many) }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.phones).toBeDefined();
  });

  test("a missing phones field leaves the phones untouched", async () => {
    const { contactId, matterContactId } = await seedParty({ phones: two });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({ notes: "no phones field posted" }),
    );
    expect(res.status).toBe("ok");
    expect(await prisma.contactPhone.count({ where: { contactId } })).toBe(2);
  });

  test("replace-all keeps exactly one primary, order, and the Contact.phone mirror", async () => {
    const { contactId, matterContactId } = await seedParty({ phones: two });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        phones: phoneJson([
          { number: "(720) 555-0001", isPrimary: true },
          { number: "(720) 555-0002", isPrimary: true },
          { number: "(720) 555-0003" },
        ]),
      }),
    );
    expect(res.status).toBe("ok");
    const rows = await prisma.contactPhone.findMany({
      where: { contactId },
      orderBy: { order: "asc" },
    });
    expect(rows.map((r) => r.number)).toEqual([
      "(720) 555-0001",
      "(720) 555-0002",
      "(720) 555-0003",
    ]);
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    expect(rows[0].isPrimary).toBe(true);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.phone).toBe("(720) 555-0001");
  });
});

describe("updateMatterContact - concurrent contact edits", () => {
  const phones = [{ label: "Mobile", number: "(303) 555-0100", isPrimary: true }];
  const loaded = {
    origContactName: "Maria Alvarez",
    origContactEmail: "maria@example.com",
    origContactOrganization: "",
    origPhones: phoneJson(phones),
  };

  test("a notes-only save does not revert a contact edit made since the form loaded", async () => {
    const { contactId, matterContactId } = await seedParty({ phones });
    // Someone else, after this user opened the form: new email + a 2nd phone.
    await prisma.contact.update({
      where: { id: contactId },
      data: { email: "maria.new@example.com" },
    });
    await prisma.contactPhone.create({
      data: {
        contactId,
        number: "(303) 555-0199",
        isPrimary: false,
        order: 1,
      },
    });

    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        ...loaded,
        notes: "only notes changed",
        phones: phoneJson(phones), // stale snapshot
      }),
    );
    expect(res.status).toBe("ok");
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
      include: { phones: true },
    });
    expect(c.email).toBe("maria.new@example.com");
    expect(c.phones).toHaveLength(2);
    const mc = await prisma.matterContact.findUniqueOrThrow({
      where: { id: matterContactId },
    });
    expect(mc.notes).toBe("only notes changed");
  });

  test("editing a field that someone else changed meanwhile is a conflict and writes nothing", async () => {
    const { contactId, matterContactId } = await seedParty({ phones });
    await prisma.contact.update({
      where: { id: contactId },
      data: { email: "maria.new@example.com" },
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        ...loaded,
        contactEmail: "mine@example.com",
        notes: "should not land",
        phones: phoneJson(phones),
      }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/email changed since you opened/i);
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.email).toBe("maria.new@example.com");
    const mc = await prisma.matterContact.findUniqueOrThrow({
      where: { id: matterContactId },
    });
    expect(mc.notes).toBeNull();
  });

  test("only the changed contact field is written; phones are not rewritten", async () => {
    const { contactId, matterContactId } = await seedParty({ phones });
    const before = await prisma.contactPhone.findFirstOrThrow({
      where: { contactId },
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        ...loaded,
        contactOrganization: "Alvarez Co",
        phones: phoneJson(phones),
      }),
    );
    expect(res.status).toBe("ok");
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.organization).toBe("Alvarez Co");
    const after = await prisma.contactPhone.findFirstOrThrow({
      where: { contactId },
    });
    // Same row (not deleted + recreated).
    expect(after.id).toBe(before.id);
  });

  test("an invalid email being written is rejected; an existing odd email is not re-validated", async () => {
    const { contactId, matterContactId } = await seedParty({
      phones,
      email: "legacy-odd-email",
    });
    const odd = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        contactEmail: "legacy-odd-email",
        origContactEmail: "legacy-odd-email",
        notes: "still saves",
        phones: phoneJson(phones),
        origPhones: phoneJson(phones),
      }),
    );
    expect(odd.status).toBe("ok");

    const bad = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        contactEmail: "still-not-an-email",
        origContactEmail: "legacy-odd-email",
        phones: phoneJson(phones),
        origPhones: phoneJson(phones),
      }),
    );
    expect(bad.status).toBe("error");
    expect(bad.errors?.contactEmail).toBeDefined();
    const c = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(c.email).toBe("legacy-odd-email");
  });
});

describe("updateMatterContact - stale party and representation", () => {
  test("saving a party that was removed meanwhile is a form error, not a throw", async () => {
    const { matterContactId } = await seedParty({});
    await prisma.matterContact.delete({ where: { id: matterContactId } });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({ notes: "x" }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/removed/i);
  });

  test("a party removed between the read and the write maps P2025 to a form error", async () => {
    const { matterContactId } = await seedParty({});
    // Simulate the race: the pre-read sees the row, the update does not.
    const real = prisma.matterContact.findUnique.bind(prisma.matterContact);
    const spy = vi.spyOn(prisma.matterContact, "findUnique").mockImplementationOnce(((
      args: Parameters<typeof real>[0],
    ) =>
      real(args).then(async (r) => {
        await prisma.matterContact.delete({ where: { id: matterContactId } });
        return r;
      })) as typeof real);
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({ notes: "x" }),
    );
    spy.mockRestore();
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/no longer exists/i);
  });

  test("a party whose linked attorney was deactivated can still be saved (link kept, no duplicate)", async () => {
    const { contactId: atty } = await seedContact({
      name: "Retired Atty",
      type: "opposing_counsel",
      isActive: false,
    });
    const { matterContactId } = await seedParty({
      representationContactId: atty,
    });
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        notes: "notes only",
        representation: "yes",
        representationContactMode: "__existing__",
        representationContactId: atty,
      }),
    );
    expect(res.status).toBe("ok");
    const mc = await prisma.matterContact.findUniqueOrThrow({
      where: { id: matterContactId },
    });
    expect(mc.representationContactId).toBe(atty);
    expect(await prisma.contact.count({ where: { type: "opposing_counsel" } })).toBe(1);
  });

  test("switching to a different, inactive attorney is refused", async () => {
    const { contactId: other } = await seedContact({
      name: "Other Retired",
      type: "opposing_counsel",
      isActive: false,
    });
    const { matterContactId } = await seedParty({});
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        representation: "yes",
        representationContactMode: "__existing__",
        representationContactId: other,
      }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.representationContactId?.[0]).toMatch(/inactive/i);
  });

  test("a bad new-attorney email is a field error", async () => {
    const { matterContactId } = await seedParty({});
    const res = await updateMatterContact(
      matterContactId,
      partyInitialState,
      editForm({
        representation: "yes",
        representationContactMode: "__new__",
        newRepresentationName: "Atty",
        newRepresentationEmail: "nope",
      }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.newRepresentationEmail).toBeDefined();
  });
});

describe("removeMatterContact", () => {
  test("refuses to remove the matter's primary client row", async () => {
    const { contactId } = await seedContact({ name: "Primary Client" });
    await prisma.matter.update({
      where: { id: matterId },
      data: { clientId: contactId },
    });
    const mc = await prisma.matterContact.create({
      data: { matterId, contactId, category: "client" },
    });
    const res = await removeMatterContact(mc.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/primary client/i);
    expect(await prisma.matterContact.count({ where: { id: mc.id } })).toBe(1);
  });

  test("a secondary client row can be removed", async () => {
    const { contactId: primary } = await seedContact({ name: "Primary" });
    await prisma.matter.update({
      where: { id: matterId },
      data: { clientId: primary },
    });
    const { contactId: second } = await seedContact({ name: "Second" });
    const mc = await prisma.matterContact.create({
      data: { matterId, contactId: second, category: "client" },
    });
    expect((await removeMatterContact(mc.id)).ok).toBe(true);
  });

  test("removing an already-removed party reports it instead of throwing", async () => {
    const { contactId } = await seedContact({});
    const mc = await prisma.matterContact.create({
      data: { matterId, contactId, category: "other" },
    });
    await prisma.matterContact.delete({ where: { id: mc.id } });
    const res = await removeMatterContact(mc.id);
    expect(res).toEqual({ ok: false, error: "Party not found" });
  });
});
