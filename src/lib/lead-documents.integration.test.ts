/**
 * rehomeLeadDocuments: a converting lead's folders + documents move to
 * the new matter (matterId set, leadId null), tree links intact, and a
 * root-folder name collision gets a "(n)" suffix.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { rehomeLeadDocuments, resolveLeadUploadTarget } from "@/lib/lead-documents";
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
  leadId = (await prisma.lead.create({ data: { name: "L" }, select: { id: true } })).id;
});

const run = (lid = leadId) => prisma.$transaction((tx) => rehomeLeadDocuments(tx, lid, matterId));

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

  test("counts only top-level documents but re-homes extracted attachments too", async () => {
    const email = await prisma.document.create({
      data: { leadId, name: "mail.eml" },
    });
    const att1 = await prisma.document.create({
      data: { leadId, name: "a1.pdf", parentDocumentId: email.id },
    });
    const att2 = await prisma.document.create({
      data: { leadId, name: "a2.pdf", parentDocumentId: email.id },
    });

    expect(await run()).toBe(1);

    for (const id of [email.id, att1.id, att2.id]) {
      const d = await prisma.document.findUniqueOrThrow({ where: { id } });
      expect(d.matterId).toBe(matterId);
      expect(d.leadId).toBeNull();
    }
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
      async (f) => (await prisma.documentFolder.findUniqueOrThrow({ where: { id: f.id } })).name,
    );
    const got = (await Promise.all(names)).sort();
    expect(new Set(got.map((s) => s.toLowerCase())).size).toBe(2);
    expect(got.every((s) => /\(\d+\)$/.test(s))).toBe(true);
    // nested folder keeps its name
    expect((await prisma.documentFolder.findUniqueOrThrow({ where: { id: n.id } })).name).toBe(
      "Medical",
    );
  });
});

describe("resolveLeadUploadTarget (real SQL, incl. the FOR SHARE lock)", () => {
  const resolve = (lid: string, userId: string, folderId: string | null, allow = true) =>
    prisma.$transaction((tx) =>
      resolveLeadUploadTarget(tx, lid, userId, folderId, async () => allow),
    );

  test("an open lead files on the lead, keeping a lead folder", async () => {
    const f = await prisma.documentFolder.create({ data: { leadId, name: "F" } });
    expect(await resolve(leadId, "u", f.id)).toEqual({
      kind: "filed",
      scope: { kind: "lead", leadId },
      folderId: f.id,
    });
  });

  test("a missing lead is gone", async () => {
    expect(await resolve("nope", "u", null)).toEqual({ kind: "gone" });
  });

  test("a converted lead reroutes to its matter; a re-homed folder keeps resolving, a stale one falls back to root", async () => {
    const { userId } = await seedUser({
      firmId: (await seedFirm()).firmId,
      email: "z@example.com",
    });
    const f = await prisma.documentFolder.create({ data: { leadId, name: "F" } });
    await prisma.$transaction(async (tx) => {
      await rehomeLeadDocuments(tx, leadId, matterId);
      await tx.lead.update({
        where: { id: leadId },
        data: { stage: "converted", convertedMatterId: matterId },
      });
    });
    const got = await resolve(leadId, userId, f.id);
    expect(got).toMatchObject({
      kind: "filed",
      scope: { kind: "matter", matterId },
      folderId: f.id,
    });
    expect(await resolve(leadId, userId, "stale")).toMatchObject({
      kind: "filed",
      folderId: null,
    });
    expect(await resolve(leadId, userId, f.id, false)).toEqual({
      kind: "forbidden",
      matterId,
    });
  });
});
