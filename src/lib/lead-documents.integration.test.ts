/**
 * rehomeLeadDocuments: a converting lead's folders + documents move to
 * the new matter (matterId set, leadId null), tree links intact, and a
 * root-folder name collision gets a "(n)" suffix.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { rehomeLeadDocuments } from "@/lib/lead-documents";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let matterId: string;
let leadId: string;

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId, email: "a@example.com" });
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
  leadId = (
    await prisma.lead.create({ data: { name: "L" }, select: { id: true } })
  ).id;
});

const run = (lid = leadId) =>
  prisma.$transaction((tx) => rehomeLeadDocuments(tx, lid, matterId));

describe("rehomeLeadDocuments", () => {
  test("moves folders and documents, keeps links, returns doc count", async () => {
    const parent = await prisma.documentFolder.create({
      data: { leadId, name: "Records" },
    });
    const child = await prisma.documentFolder.create({
      data: { leadId, name: "Sub", parentId: parent.id },
    });
    const d1 = await prisma.document.create({
      data: { leadId, name: "a.pdf", folderId: child.id },
    });
    await prisma.document.create({ data: { leadId, name: "b.pdf" } });

    expect(await run()).toBe(2);

    const folders = await prisma.documentFolder.findMany();
    for (const f of folders) {
      expect(f.matterId).toBe(matterId);
      expect(f.leadId).toBeNull();
    }
    const c = await prisma.documentFolder.findUniqueOrThrow({ where: { id: child.id } });
    expect(c.parentId).toBe(parent.id);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: d1.id } });
    expect(doc.matterId).toBe(matterId);
    expect(doc.leadId).toBeNull();
    expect(doc.folderId).toBe(child.id);
  });

  test("returns 0 when the lead has nothing", async () => {
    expect(await run()).toBe(0);
  });

  test("renames colliding root folders, uniquely among themselves", async () => {
    await prisma.documentFolder.create({ data: { matterId, name: "Medical" } });
    const a = await prisma.documentFolder.create({ data: { leadId, name: "medical" } });
    const b = await prisma.documentFolder.create({ data: { leadId, name: "Medical" } });
    const n = await prisma.documentFolder.create({
      data: { leadId, name: "Medical", parentId: a.id },
    });
    await run();
    const names = [a, b].map(
      async (f) =>
        (await prisma.documentFolder.findUniqueOrThrow({ where: { id: f.id } })).name
    );
    const got = (await Promise.all(names)).sort();
    expect(new Set(got.map((s) => s.toLowerCase())).size).toBe(2);
    expect(got.every((s) => /\(\d+\)$/.test(s))).toBe(true);
    // nested folder keeps its name
    expect((await prisma.documentFolder.findUniqueOrThrow({ where: { id: n.id } })).name).toBe("Medical");
  });
});
