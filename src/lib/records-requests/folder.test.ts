/**
 * Integration tests for resolveRecordsFolder (real Postgres).
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveRecordsFolder, resolveRecordsUpload } from "@/lib/records-requests/folder";
import {
  resetDb,
  seedContact,
  seedDocument,
  seedDocumentFolder,
  seedMatter,
  seedPracticeArea,
  seedFirm,
  seedLead,
  seedUser,
} from "@/test/integration-helpers";

let matterId: string;
let custodianId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId, name: "Atty" });
  const { areaId, stageId } = await seedPracticeArea();
  matterId = (
    await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId })
  ).matterId;
  custodianId = (await seedContact({ name: "Memorial Hospital" })).contactId;
});

async function mkRequest() {
  return prisma.recordsRequest.create({
    data: {
      matterId,
      custodianContactId: custodianId,
      adHocTypeName: "CORA",
      subject: "s",
    },
    select: { id: true },
  });
}

const args = (id: string) => ({
  id,
  matterId,
  leadId: null,
  custodianName: "Memorial Hospital",
  typeName: "CORA",
});

describe("resolveRecordsFolder", () => {
  test("creates Records/<custodian — type> and is idempotent", async () => {
    const r = await mkRequest();
    const a = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const b = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    expect(b).toBe(a);
    const folder = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: a },
      include: { parent: true },
    });
    expect(folder.name).toBe("Memorial Hospital — CORA");
    expect(folder.parent?.name).toBe("Records");
    expect(folder.parent?.parentId).toBeNull();
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(2);
  });

  test("reuses a pre-existing root Records folder", async () => {
    const root = await seedDocumentFolder({ matterId, name: "records" });
    const r = await mkRequest();
    const id = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const f = await prisma.documentFolder.findUniqueOrThrow({ where: { id } });
    expect(f.parentId).toBe(root.folderId);
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(2);
  });

  test("a child claimed by another request gets (2); the own folder is reused", async () => {
    const r1 = await mkRequest();
    const r2 = await mkRequest();
    const f1 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r1.id)));
    await prisma.document.update({
      where: { id: (await seedDocument({ matterId, folderId: f1 })).documentId },
      data: { recordsRequestId: r1.id, recordsRequestRole: "received_records" },
    });
    const f2 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r2.id)));
    expect(f2).not.toBe(f1);
    const second = await prisma.documentFolder.findUniqueOrThrow({ where: { id: f2 } });
    expect(second.name).toBe("Memorial Hospital — CORA (2)");
    // Each request keeps resolving to its own folder.
    const again1 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r1.id)));
    expect(again1).toBe(f1);
    await prisma.document.update({
      where: { id: (await seedDocument({ matterId, folderId: f2 })).documentId },
      data: { recordsRequestId: r2.id, recordsRequestRole: "received_records" },
    });
    const again2 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r2.id)));
    expect(again2).toBe(f2);
  });
});

describe("resolveRecordsUpload", () => {
  const M = () => ({ kind: "matter" as const, matterId });

  test("in-scope request: tagged and filed in the request folder", async () => {
    const r = await mkRequest();
    const tag = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, M(), null)
    );
    expect(tag).toMatchObject({
      recordsRequestId: r.id,
      recordsRequestRole: "received_records",
    });
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: tag!.folderId },
    });
    expect(f.name).toBe("Memorial Hospital — CORA");
  });

  test("a request from another scope -> null", async () => {
    const { leadId } = await seedLead();
    const r = await prisma.recordsRequest.create({
      data: {
        leadId,
        custodianContactId: custodianId,
        adHocTypeName: "CORA",
        subject: "s",
      },
      select: { id: true },
    });
    const tag = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, M(), null)
    );
    expect(tag).toBeNull();
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(0);
  });

  test("an explicit folderId is kept and no records folder is created", async () => {
    const r = await mkRequest();
    const { folderId } = await seedDocumentFolder({ matterId, name: "Mine" });
    const tag = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, M(), folderId)
    );
    expect(tag?.folderId).toBe(folderId);
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(1);
  });

  test("a null folderId falls back to resolveRecordsFolder", async () => {
    const r = await mkRequest();
    const direct = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const tag = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, M(), null)
    );
    expect(tag?.folderId).toBe(direct);
  });

  test("lead request re-homed by conversion: tagged under the matter scope, not the lead scope", async () => {
    const { leadId } = await seedLead();
    const r = await prisma.recordsRequest.create({
      data: {
        leadId,
        custodianContactId: custodianId,
        adHocTypeName: "CORA",
        subject: "s",
      },
      select: { id: true },
    });
    await prisma.recordsRequest.update({
      where: { id: r.id },
      data: { matterId, leadId: null },
    });
    const tag = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, M(), null)
    );
    expect(tag?.recordsRequestId).toBe(r.id);
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: tag!.folderId },
    });
    expect(f.matterId).toBe(matterId);
    // The stale lead scope no longer matches.
    const stale = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, { kind: "lead", leadId }, null)
    );
    expect(stale).toBeNull();
  });

  test("deleted request -> null, so the upload files untagged", async () => {
    const r = await mkRequest();
    await prisma.recordsRequest.delete({ where: { id: r.id } });
    const tag = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, M(), null)
    );
    expect(tag).toBeNull();
  });
});
