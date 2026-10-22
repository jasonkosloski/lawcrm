/**
 * Signer / recipient options for the generate dialog. They must mirror
 * what loadTemplateData accepts, so the picker never offers a choice the
 * server refuses.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/scope-access", () => ({ assertScopeAccess: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { assertScopeAccess } from "@/lib/scope-access";
import { prisma } from "@/lib/prisma";
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
import { loadGenerateOptions } from "./generate-options";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let me: string;
let other: string;
let matterId: string;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  me = (await seedUser({ firmId, name: "Me Attorney" })).userId;
  other = (await seedUser({ firmId, name: "Zed Paralegal" })).userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(me);
  const { areaId, stageId } = await seedPracticeArea({ name: "Civil" });
  matterId = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: me })).matterId;
});

describe("loadGenerateOptions", () => {
  test("matter: client, linked contacts and opposing counsel, labelled; team = current user + active members", async () => {
    const client = await seedContact({ name: "Maria Alvarez" });
    const witness = await seedContact({ name: "Wes Witness" });
    const opp = await seedContact({ name: "Olga Opposing" });
    const counsel = await seedContact({ name: "Pat Counsel" });
    await prisma.matter.update({ where: { id: matterId }, data: { clientId: client.contactId } });
    await seedMatterContact({ matterId, contactId: witness.contactId, category: "lay_witness" });
    const mc = await seedMatterContact({
      matterId,
      contactId: opp.contactId,
      category: "opposing",
    });
    await prisma.matterContact.update({
      where: { id: mc.matterContactId },
      data: { representationContactId: counsel.contactId },
    });
    await prisma.matterTeamMember.create({
      data: { matterId, userId: other, role: "paralegal" },
    });

    const res = await loadGenerateOptions({ kind: "matter", matterId });
    expect(assertScopeAccess).toHaveBeenCalledWith({ kind: "matter", matterId });
    const label = (id: string) => res.contacts.find((c) => c.id === id)?.role;
    expect(label(client.contactId)).toBe("client");
    expect(label(witness.contactId)).toBe("lay witness");
    expect(label(counsel.contactId)).toBe("opposing counsel");
    expect(res.contacts.map((c) => c.id).sort()).toEqual(
      [client.contactId, witness.contactId, opp.contactId, counsel.contactId].sort(),
    );
    expect(res.team.map((t) => t.id).sort()).toEqual([me, other].sort());
    expect(res.currentUserId).toBe(me);
  });

  test("matter: removed team members are not offered", async () => {
    await prisma.matterTeamMember.create({
      data: { matterId, userId: other, role: "paralegal", removedAt: new Date() },
    });
    const res = await loadGenerateOptions({ kind: "matter", matterId });
    expect(res.team.map((t) => t.id)).toEqual([me]);
  });

  test("lead: only the lead's contact; team = current user + lead team", async () => {
    const c = await seedContact({ name: "Lee Lead" });
    const { leadId } = await seedLead({ contactId: c.contactId, teamUserIds: [other] });
    const res = await loadGenerateOptions({ kind: "lead", leadId });
    expect(res.contacts).toEqual([
      expect.objectContaining({ id: c.contactId, name: "Lee Lead", role: "client" }),
    ]);
    expect(res.team.map((t) => t.id).sort()).toEqual([me, other].sort());
  });

  test("inactive users and contacts are not offered", async () => {
    const live = await seedContact({ name: "Live Client" });
    const dead = await seedContact({ name: "Dead Witness" });
    await prisma.matter.update({ where: { id: matterId }, data: { clientId: live.contactId } });
    await seedMatterContact({ matterId, contactId: dead.contactId, category: "lay_witness" });
    await prisma.contact.update({ where: { id: dead.contactId }, data: { isActive: false } });
    await prisma.user.update({ where: { id: other }, data: { isActive: false } });
    await prisma.matterTeamMember.create({ data: { matterId, userId: other, role: "paralegal" } });

    const res = await loadGenerateOptions({ kind: "matter", matterId });
    expect(res.contacts.map((c) => c.id)).toEqual([live.contactId]);
    expect(res.team.map((t) => t.id)).toEqual([me]);
  });
});
