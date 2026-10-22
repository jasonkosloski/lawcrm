/**
 * Integration tests for the contact directory queries.
 *
 * Pins:
 *   - listContacts: case-insensitive, trimmed search over name / email /
 *     organization; type filter; inactive rows hidden; the row cap;
 *     matterCount = DISTINCT matters (a client's matter is both
 *     Matter.clientId and a category "client" party row - it counts
 *     once), including representation links.
 *   - getContactById: the client matter is listed once (not again as a
 *     party row) while a co-client row still shows; representation
 *     links surface as `representing`; isActive / isArchived flow
 *     through; matterCount is distinct.
 *   - listContactPickerOptions: a matter's own people are always
 *     present and first - even when they fall outside the alphabetical
 *     cap - both halves A-Z, inactive contacts excluded.
 *   - searchMergeCandidates: server-side, case-insensitive, never the
 *     excluded / inactive / merged-away records, capped.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// The wall-aware queries resolve the viewer; the seeded matter lead
// stands in (FIRM mode: everyone sees everything).
const viewer = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => viewer.id),
}));
import { prisma } from "@/lib/prisma";
import {
  CONTACT_LIST_LIMIT,
  CONTACT_PICKER_LIMIT,
  MERGE_SEARCH_LIMIT,
} from "@/lib/contact-constants";
import {
  getContactById,
  listContactPickerOptions,
  listContacts,
  searchMergeCandidates,
} from "@/lib/queries/contacts";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let leadUserId: string;
let areaId: string;
let stageId: string;

async function matter(name: string, clientId?: string, isArchived = false) {
  const { matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId,
    name,
  });
  if (clientId || isArchived) {
    await prisma.matter.update({
      where: { id: matterId },
      data: { clientId: clientId ?? null, isArchived },
    });
  }
  return matterId;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  leadUserId = (await seedUser({ firmId })).userId;
  viewer.id = leadUserId;
  const area = await seedPracticeArea();
  areaId = area.areaId;
  stageId = area.stageId;
});

describe("listContacts search", () => {
  test("a lowercase query finds mixed-case name, organization and email", async () => {
    await seedContact({
      name: "Dana Whitfield",
      organization: "Acme LLC",
      email: "Dana.W@Example.com",
    });
    await seedContact({ name: "Someone Else" });

    expect((await listContacts({ search: "whitfield" })).map((c) => c.name)).toEqual([
      "Dana Whitfield",
    ]);
    expect((await listContacts({ search: "acme" })).map((c) => c.name)).toEqual(["Dana Whitfield"]);
    expect((await listContacts({ search: "dana.w@example" })).map((c) => c.name)).toEqual([
      "Dana Whitfield",
    ]);
    expect((await listContacts({ search: "WHITFIELD" })).length).toBe(1);
  });

  test("the query is trimmed; whitespace-only means no filter", async () => {
    await seedContact({ name: "Dana Whitfield" });
    await seedContact({ name: "Other Person" });

    expect((await listContacts({ search: "  whitfield  " })).length).toBe(1);
    expect((await listContacts({ search: "   " })).length).toBe(2);
  });

  test("type filter combines with search; inactive contacts are hidden", async () => {
    await seedContact({ name: "Smith Client", type: "client" });
    await seedContact({ name: "Smith Witness", type: "witness" });
    await seedContact({ name: "Smith Gone", type: "client", isActive: false });

    const rows = await listContacts({ search: "smith", type: "client" });
    expect(rows.map((c) => c.name)).toEqual(["Smith Client"]);
  });

  test("caps the result at CONTACT_LIST_LIMIT, A-Z", async () => {
    await prisma.contact.createMany({
      data: Array.from({ length: CONTACT_LIST_LIMIT + 5 }, (_, i) => ({
        name: `Person ${String(i).padStart(4, "0")}`,
        type: "other",
      })),
    });
    const rows = await listContacts({});
    expect(rows).toHaveLength(CONTACT_LIST_LIMIT);
    expect(rows[0].name).toBe("Person 0000");
  });
});

describe("matterCount (distinct matters)", () => {
  test("a client's matter counts once, not twice", async () => {
    const { contactId } = await seedContact({ name: "Client One" });
    const m = await matter("Client One v. City", contactId);
    // createMatter / updateMatter keep this category "client" row.
    await seedMatterContact({ matterId: m, contactId, category: "client" });

    const rows = await listContacts({});
    expect(rows.find((c) => c.id === contactId)?.matterCount).toBe(1);
  });

  test("client + opposing + representation across matters count distinct matters", async () => {
    const { contactId: counsel } = await seedContact({
      name: "Opposing Counsel",
      type: "opposing_counsel",
    });
    const { contactId: defendant } = await seedContact({ name: "Defendant" });
    const m1 = await matter("Matter One");
    const m2 = await matter("Matter Two");
    const { matterContactId } = await seedMatterContact({
      matterId: m1,
      contactId: defendant,
      category: "opposing",
    });
    await prisma.matterContact.update({
      where: { id: matterContactId },
      data: { representationContactId: counsel },
    });
    // The same counsel is ALSO a direct party on m1, and on m2.
    await seedMatterContact({ matterId: m1, contactId: counsel, category: "opposing" });
    await seedMatterContact({ matterId: m2, contactId: counsel, category: "opposing" });

    const rows = await listContacts({ search: "Opposing Counsel" });
    expect(rows[0].matterCount).toBe(2);
  });

  test("a counsel who only represents parties still shows their matters", async () => {
    const { contactId: counsel } = await seedContact({ name: "Rep Only" });
    const { contactId: party } = await seedContact({ name: "Party" });
    const m = await matter("Some Matter");
    const { matterContactId } = await seedMatterContact({
      matterId: m,
      contactId: party,
      category: "opposing",
    });
    await prisma.matterContact.update({
      where: { id: matterContactId },
      data: { representationContactId: counsel },
    });

    const rows = await listContacts({ search: "Rep Only" });
    expect(rows[0].matterCount).toBe(1);
  });
});

describe("getContactById", () => {
  test("the client matter is listed once; a co-client row still shows", async () => {
    const { contactId: client } = await seedContact({ name: "Main Client" });
    const { contactId: coClient } = await seedContact({ name: "Co Client" });
    const m = await matter("Joint Matter", client);
    await seedMatterContact({ matterId: m, contactId: client, category: "client" });
    await seedMatterContact({ matterId: m, contactId: coClient, category: "client" });

    const c = await getContactById(client);
    expect(c?.asClientMatters.map((x) => x.id)).toEqual([m]);
    expect(c?.asPartyMatters).toEqual([]);
    expect(c?.matterCount).toBe(1);

    const co = await getContactById(coClient);
    expect(co?.asClientMatters).toEqual([]);
    expect(co?.asPartyMatters.map((x) => x.matterId)).toEqual([m]);
    expect(co?.matterCount).toBe(1);
  });

  test("representation links surface as `representing`", async () => {
    const { contactId: counsel } = await seedContact({
      name: "Opposing Counsel",
      type: "opposing_counsel",
    });
    const { contactId: party } = await seedContact({ name: "City of Denver" });
    const m = await matter("Whitfield v. City");
    const { matterContactId } = await seedMatterContact({
      matterId: m,
      contactId: party,
      category: "opposing",
    });
    await prisma.matterContact.update({
      where: { id: matterContactId },
      data: { representationContactId: counsel },
    });

    const c = await getContactById(counsel);
    expect(c?.representing).toMatchObject([
      { matterId: m, matterName: "Whitfield v. City", partyName: "City of Denver" },
    ]);
    expect(c?.asClientMatters).toEqual([]);
    expect(c?.asPartyMatters).toEqual([]);
    expect(c?.matterCount).toBe(1);
  });

  test("archived matters are listed (and flagged), and isActive is carried", async () => {
    const { contactId } = await seedContact({ name: "Old Client", isActive: false });
    await matter("Closed Matter", contactId, true);

    const c = await getContactById(contactId);
    expect(c?.isActive).toBe(false);
    expect(c?.asClientMatters).toMatchObject([{ name: "Closed Matter", isArchived: true }]);
  });

  test("returns null for an unknown id", async () => {
    expect(await getContactById("nope")).toBeNull();
  });
});

describe("listContactPickerOptions", () => {
  test("matter people float first, both halves A-Z; inactive excluded", async () => {
    const { contactId: zed } = await seedContact({ name: "Zed Client" });
    const { contactId: mid } = await seedContact({ name: "Mid Witness" });
    await seedContact({ name: "Aaron Other" });
    await seedContact({ name: "Gone", isActive: false });
    const m = await matter("M", zed);
    await seedMatterContact({ matterId: m, contactId: mid, category: "lay_witness" });

    const rows = await listContactPickerOptions({ priorityMatterId: m });
    expect(rows.map((r) => r.name)).toEqual(["Mid Witness", "Zed Client", "Aaron Other"]);
  });

  test("without a priority matter: plain A-Z", async () => {
    await seedContact({ name: "Beta" });
    await seedContact({ name: "Alpha" });
    expect((await listContactPickerOptions()).map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });

  test("the matter's client is present even past the alphabetical cap", async () => {
    await prisma.contact.createMany({
      data: Array.from({ length: CONTACT_PICKER_LIMIT + 3 }, (_, i) => ({
        name: `Person ${String(i).padStart(4, "0")}`,
        type: "other",
      })),
    });
    const { contactId: zim } = await seedContact({ name: "Zimmerman, Paul" });
    const m = await matter("Zimmerman matter", zim);

    const without = await listContactPickerOptions();
    expect(without.some((r) => r.id === zim)).toBe(false);

    const rows = await listContactPickerOptions({ priorityMatterId: m });
    expect(rows[0].id).toBe(zim);
    expect(rows.filter((r) => r.id === zim)).toHaveLength(1);
    expect(rows).toHaveLength(CONTACT_PICKER_LIMIT + 1);
  });

  test("uses the primary ContactPhone, falling back to Contact.phone", async () => {
    const { contactId: a } = await seedContact({ name: "A With Rows" });
    const { contactId: b } = await seedContact({ name: "B Legacy" });
    await prisma.contact.update({ where: { id: a }, data: { phone: "old" } });
    await prisma.contactPhone.create({
      data: { contactId: a, number: "(303) 555-0101", isPrimary: true, order: 0 },
    });
    await prisma.contact.update({ where: { id: b }, data: { phone: "legacy" } });

    const rows = await listContactPickerOptions();
    expect(rows.find((r) => r.id === a)?.phone).toBe("(303) 555-0101");
    expect(rows.find((r) => r.id === b)?.phone).toBe("legacy");
  });
});

describe("searchMergeCandidates", () => {
  test("case-insensitive over name / organization / email; returns type, phone, email", async () => {
    const { contactId } = await seedContact({
      name: "John Smith",
      type: "opposing_counsel",
      email: "js@firm.com",
    });
    await prisma.contact.update({ where: { id: contactId }, data: { phone: "303" } });
    await seedContact({ name: "Unrelated" });

    const byName = await searchMergeCandidates({ query: "smith", excludeId: "x" });
    expect(byName).toEqual([
      {
        id: contactId,
        name: "John Smith",
        type: "opposing_counsel",
        organization: null,
        phone: "303",
        email: "js@firm.com",
      },
    ]);
    expect((await searchMergeCandidates({ query: "JS@FIRM", excludeId: "x" })).length).toBe(1);
  });

  test("excludes the contact itself, inactive and merged-away records; empty query = none", async () => {
    const { contactId: self } = await seedContact({ name: "Smith Self" });
    await seedContact({ name: "Smith Inactive", isActive: false });
    const { contactId: merged } = await seedContact({ name: "Smith Merged" });
    await prisma.contact.update({
      where: { id: merged },
      data: { mergedIntoId: self },
    });
    const { contactId: ok } = await seedContact({ name: "Smith Ok" });

    const rows = await searchMergeCandidates({ query: "smith", excludeId: self });
    expect(rows.map((r) => r.id)).toEqual([ok]);
    expect(await searchMergeCandidates({ query: "  ", excludeId: self })).toEqual([]);
  });

  test("returns at most MERGE_SEARCH_LIMIT rows", async () => {
    await prisma.contact.createMany({
      data: Array.from({ length: MERGE_SEARCH_LIMIT + 5 }, (_, i) => ({
        name: `Smith ${i}`,
        type: "other",
      })),
    });
    expect((await searchMergeCandidates({ query: "smith", excludeId: "x" })).length).toBe(
      MERGE_SEARCH_LIMIT,
    );
  });
});
