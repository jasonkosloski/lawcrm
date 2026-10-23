/** Integration tests for the scoped template data loader. */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { prisma } from "@/lib/prisma";
import { loadTemplateData } from "./load-data";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedLead,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const FIRM = {
  id: "firm-1",
  name: "Test Firm LLC",
  shortName: null,
  ein: null,
  website: null,
  phone: "(303) 555-0100",
  email: "info@testfirm.example",
  addressLine1: "100 Main St",
  addressLine2: null,
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
  establishedAt: null,
  logoUrl: null,
};

let firmId: string;
let userId: string;
let areaId: string;
let stageId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  ({ firmId } = await seedFirm());
  ({ userId } = await seedUser({ firmId, name: "Test Attorney" }));
  await prisma.user.update({
    where: { id: userId },
    data: { jobTitle: "Partner", phone: "(303) 555-0111" },
  });
  await prisma.barAdmission.create({ data: { userId, state: "CO", number: "12345" } });
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentFirm).mockResolvedValue(FIRM);
  ({ areaId, stageId } = await seedPracticeArea({ name: "Civil Rights" }));
});

async function matterWithParties() {
  const { contactId: clientId } = await seedContact({ name: "Maria Alvarez" });
  const { matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Alvarez v. Aurora",
  });
  await prisma.matter.update({ where: { id: matterId }, data: { clientId } });
  const { contactId: city } = await seedContact({ name: "City of Aurora", type: "government" });
  const { contactId: dan } = await seedContact({ name: "Dan Defendant", type: "other" });
  const { contactId: counsel } = await seedContact({
    name: "Pat Counsel",
    type: "opposing_counsel",
    email: "pat@law.example",
  });
  const mc1 = await seedMatterContact({ matterId, contactId: city, category: "opposing" });
  await prisma.matterContact.update({
    where: { id: mc1.matterContactId },
    data: { role: "defendant", representationContactId: counsel },
  });
  const mc2 = await seedMatterContact({ matterId, contactId: dan, category: "opposing" });
  await prisma.matterContact.update({
    where: { id: mc2.matterContactId },
    data: {
      role: "Defendant",
      representationName: "Legacy Lawyer",
      representationEmail: "l@x.example",
    },
  });
  return { matterId, clientId, counsel };
}

describe("loadTemplateData — matter scope", () => {
  test("loads matter, client, parties with counsel, team, signer", async () => {
    const { matterId } = await matterWithParties();
    const r = await loadTemplateData({ scope: { kind: "matter", matterId } });
    if (!r.ok) throw new Error(r.error);
    expect(r.recordName).toBe("Alvarez v. Aurora");
    expect(r.data.scope).toBe("matter");
    expect(r.data.matter?.name).toBe("Alvarez v. Aurora");
    expect(r.data.matter?.practiceArea).toBe("Civil Rights");
    expect(r.data.lead).toBeNull();
    expect(r.data.client?.name).toBe("Maria Alvarez");
    expect(r.data.parties.clients.map((p) => p.name)).toEqual(["Maria Alvarez"]);
    expect(r.data.parties.defendants.map((p) => p.name)).toEqual([
      "City of Aurora",
      "Dan Defendant",
    ]);
    expect(r.data.parties.defendants[0].isOrganization).toBe(true);
    expect(r.data.parties.defendants[1].isOrganization).toBe(false);
    expect(r.data.parties.defendants[0].counsel?.name).toBe("Pat Counsel");
    expect(r.data.parties.defendants[1].counsel?.name).toBe("Legacy Lawyer");
    expect(r.data.parties.opposingCounsel.map((p) => p.name)).toEqual([
      "Pat Counsel",
      "Legacy Lawyer",
    ]);
    expect(r.data.parties.plaintiffs).toEqual([]);
    expect(r.data.signer).toMatchObject({
      name: "Test Attorney",
      title: "Partner",
      barNumber: "12345",
    });
    expect(r.data.team.map((t) => t.name)).toEqual(["Test Attorney"]);
    expect(r.data.firm.name).toBe("Test Firm LLC");
  });

  test("signer outside the team is refused; a team member is allowed", async () => {
    const { matterId } = await matterWithParties();
    const { userId: other } = await seedUser({ firmId, name: "Outsider" });
    const { userId: mate } = await seedUser({ firmId, name: "Teammate" });
    await prisma.matterTeamMember.create({ data: { matterId, userId: mate, role: "paralegal" } });
    const scope = { kind: "matter", matterId } as const;
    expect(await loadTemplateData({ scope, signerId: other })).toEqual({
      ok: false,
      error: "That signer isn't on this record's team.",
    });
    const ok = await loadTemplateData({ scope, signerId: mate });
    expect(ok.ok && ok.data.signer?.name).toBe("Teammate");
  });

  test("recipient must be linked to the record", async () => {
    const { matterId, counsel } = await matterWithParties();
    const { contactId: stranger } = await seedContact({ name: "Stranger" });
    const scope = { kind: "matter", matterId } as const;
    expect(await loadTemplateData({ scope, recipientContactId: stranger })).toEqual({
      ok: false,
      error: "That recipient isn't a contact on this record.",
    });
    // A contact of ANOTHER matter is not linked here either.
    const other = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
    await seedMatterContact({
      matterId: other.matterId,
      contactId: stranger,
      category: "opposing",
    });
    expect((await loadTemplateData({ scope, recipientContactId: stranger })).ok).toBe(false);
    // Opposing counsel via an opposing party's representation is allowed.
    const ok = await loadTemplateData({ scope, recipientContactId: counsel });
    expect(ok.ok && ok.data.recipient?.name).toBe("Pat Counsel");
    // ...but not when the representing row isn't an opposing party.
    await prisma.matterContact.updateMany({ where: { matterId }, data: { category: "other" } });
    expect((await loadTemplateData({ scope, recipientContactId: counsel })).ok).toBe(false);
  });

  test("inactive signer / merged contact and foreign request are refused", async () => {
    const { matterId, clientId } = await matterWithParties();
    const scope = { kind: "matter", matterId } as const;
    const { userId: gone } = await seedUser({ firmId, name: "Gone", isActive: false });
    await prisma.matterTeamMember.create({ data: { matterId, userId: gone, role: "paralegal" } });
    expect(await loadTemplateData({ scope, signerId: gone })).toEqual({
      ok: false,
      error: "That signer isn't on this record's team.",
    });
    await prisma.contact.update({ where: { id: clientId }, data: { isActive: false } });
    expect((await loadTemplateData({ scope, recipientContactId: clientId })).ok).toBe(false);
    const foreign = { matterId: "other", leadId: null } as never;
    expect(await loadTemplateData({ scope, request: foreign })).toEqual({
      ok: false,
      error: "Records request not found.",
    });
  });

  test("a MatterContact or the client is an allowed recipient", async () => {
    const { matterId, clientId } = await matterWithParties();
    const scope = { kind: "matter", matterId } as const;
    const r1 = await loadTemplateData({ scope, recipientContactId: clientId });
    expect(r1.ok && r1.data.recipient?.name).toBe("Maria Alvarez");
    const dan = await prisma.contact.findFirstOrThrow({ where: { name: "Dan Defendant" } });
    const r2 = await loadTemplateData({ scope, recipientContactId: dan.id });
    expect(r2.ok && r2.data.recipient?.name).toBe("Dan Defendant");
  });

  test("a user without access: the guard's rejection propagates", async () => {
    const { matterId } = await matterWithParties();
    await prisma.matter.update({ where: { id: matterId }, data: { restricted: true } });
    const { userId: outsider } = await seedUser({ firmId, name: "Outsider" });
    vi.mocked(getCurrentUserId).mockResolvedValue(outsider);
    await expect(loadTemplateData({ scope: { kind: "matter", matterId } })).rejects.toThrow();
  });
});

describe("loadTemplateData — lead scope", () => {
  test("fills lead.*, client from the lead contact, matter null, empty parties", async () => {
    const { contactId } = await seedContact({ name: "Lee Prospect", email: "lee@example.com" });
    const { leadId } = await seedLead({ name: "Legacy Name", contactId });
    await prisma.lead.update({
      where: { id: leadId },
      data: { location: "Denver", source: "web", summary: "Crash", stage: "contacted" },
    });
    const r = await loadTemplateData({ scope: { kind: "lead", leadId } });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.scope).toBe("lead");
    expect(r.data.matter).toBeNull();
    expect(r.data.lead).toMatchObject({
      location: "Denver",
      source: "web",
      summary: "Crash",
      stage: "contacted",
    });
    expect(r.data.client).toMatchObject({ name: "Lee Prospect", email: "lee@example.com" });
    expect(r.data.parties.defendants).toEqual([]);
    expect(r.recordName).toBe("Lee Prospect");
  });

  test("falls back to the lead's own name/email/phone without a contact", async () => {
    const { leadId } = await seedLead({ name: "Solo Lead", email: "solo@example.com" });
    const r = await loadTemplateData({ scope: { kind: "lead", leadId } });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.client).toMatchObject({ name: "Solo Lead", email: "solo@example.com" });
  });

  test("lead recipient is the lead's contact only; signer must be on the lead team", async () => {
    const { contactId } = await seedContact({ name: "Lee Prospect" });
    const { contactId: other } = await seedContact({ name: "Other" });
    const { leadId } = await seedLead({ name: "L", contactId });
    const scope = { kind: "lead", leadId } as const;
    const ok = await loadTemplateData({ scope, recipientContactId: contactId });
    expect(ok.ok && ok.data.recipient?.name).toBe("Lee Prospect");
    const bad = await loadTemplateData({ scope, recipientContactId: other });
    expect(bad.ok).toBe(false);
    const { userId: outsider } = await seedUser({ firmId, name: "Outsider" });
    const s = await loadTemplateData({ scope, signerId: outsider });
    expect(s).toEqual({ ok: false, error: "That signer isn't on this record's team." });
  });
});

describe("loadTemplateData — matter.courtCaption", () => {
  test("uses the venue caption name, falling back to the venue name", async () => {
    const { matterId } = await matterWithParties();
    const v = await prisma.venue.create({
      data: { name: "Denver District", nameKey: "denver district", state: "CO" },
    });
    await prisma.matter.update({ where: { id: matterId }, data: { venueId: v.id } });
    const load = async () => {
      const r = await loadTemplateData({ scope: { kind: "matter", matterId } });
      if (!r.ok) throw new Error(r.error);
      return r.data.matter?.courtCaption;
    };
    expect(await load()).toBe("Denver District");
    await prisma.venue.update({ where: { id: v.id }, data: { captionName: "DISTRICT COURT" } });
    expect(await load()).toBe("DISTRICT COURT");
  });
});

describe("loadTemplateData — lead attorney and bar numbers", () => {
  const admit = (uid: string, state: string, number: string) =>
    prisma.barAdmission.upsert({
      where: { userId_state: { userId: uid, state } },
      create: { userId: uid, state, number },
      update: { number },
    });

  async function attorneyMatter(venueState: string | null) {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Attorney Matter",
    });
    await admit(userId, "CO", "111");
    await admit(userId, "WY", "222");
    const { userId: co } = await seedUser({ firmId, name: "Anna CoCounsel" });
    await admit(co, "CO", "333");
    const { userId: para } = await seedUser({ firmId, name: "Para Legal" });
    await admit(para, "CO", "444");
    await prisma.matterTeamMember.create({ data: { matterId, userId: co, role: "co_counsel" } });
    await prisma.matterTeamMember.create({ data: { matterId, userId: para, role: "paralegal" } });
    if (venueState) {
      const v = await prisma.venue.create({
        data: { name: "V", nameKey: "v", state: venueState },
      });
      await prisma.matter.update({ where: { id: matterId }, data: { venueId: v.id } });
    }
    return { matterId, co };
  }

  test("lead attorney and attorneys list use the venue state's bar numbers", async () => {
    const { matterId } = await attorneyMatter("Colorado");
    vi.mocked(getCurrentFirm).mockResolvedValue({ ...FIRM, state: "WY" });
    const r = await loadTemplateData({ scope: { kind: "matter", matterId } });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.matter?.leadAttorney).toMatchObject({
      name: "Test Attorney",
      barNumber: "111",
    });
    expect(r.data.attorneys.map((a) => a.name)).toEqual(["Test Attorney", "Anna CoCounsel"]);
    expect(r.data.attorneys[1].barNumber).toBe("333");
    expect(r.data.signer?.barNumber).toBe("111");
  });

  test("no venue falls back to the firm state; no admission there is null", async () => {
    const { matterId } = await attorneyMatter(null);
    vi.mocked(getCurrentFirm).mockResolvedValue({ ...FIRM, state: "WY" });
    const r = await loadTemplateData({ scope: { kind: "matter", matterId } });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.matter?.leadAttorney?.barNumber).toBe("222");
    expect(r.data.signer?.barNumber).toBe("222");
    vi.mocked(getCurrentFirm).mockResolvedValue({ ...FIRM, state: "TX" });
    const r2 = await loadTemplateData({ scope: { kind: "matter", matterId } });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.data.matter?.leadAttorney?.barNumber).toBeNull();
    expect(r2.data.signer?.barNumber).toBeNull();
  });

  test("no lead on the team gives a null leadAttorney", async () => {
    const { matterId } = await attorneyMatter(null);
    await prisma.matterTeamMember.updateMany({
      where: { matterId, role: "lead" },
      data: { removedAt: new Date() },
    });
    const r = await loadTemplateData({ scope: { kind: "matter", matterId } });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.matter?.leadAttorney).toBeNull();
    expect(r.data.attorneys.map((a) => a.name)).toEqual(["Anna CoCounsel"]);
  });

  test("lead scope: signer bar number by the firm's state", async () => {
    await admit(userId, "CO", "111");
    await admit(userId, "WY", "222");
    const { leadId } = await seedLead({ name: "L" });
    vi.mocked(getCurrentFirm).mockResolvedValue({ ...FIRM, state: "WY" });
    const r = await loadTemplateData({ scope: { kind: "lead", leadId } });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.signer?.barNumber).toBe("222");
    expect(r.data.attorneys).toEqual([]);
  });
});
