/**
 * Integration tests for resolveRecordsFolder (real Postgres).
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resolveRecordsFolder,
  resolveRecordsRoleFolder,
  resolveRecordsUpload,
} from "@/lib/records-requests/folder";
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

describe("resolveRecordsRoleFolder", () => {
  const role = (id: string, r: "request_letter" | "received_records") =>
    prisma.$transaction((tx) => resolveRecordsRoleFolder(tx, args(id), r));

  test("creates both-named subfolders under the request folder, idempotently", async () => {
    const r = await mkRequest();
    const parent = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const a = await role(r.id, "request_letter");
    const b = await role(r.id, "received_records");
    expect(await role(r.id, "request_letter")).toBe(a);
    expect(await role(r.id, "received_records")).toBe(b);
    const fa = await prisma.documentFolder.findUniqueOrThrow({ where: { id: a } });
    const fb = await prisma.documentFolder.findUniqueOrThrow({ where: { id: b } });
    expect(fa).toMatchObject({ name: "Request documents", parentId: parent });
    expect(fb).toMatchObject({ name: "Responsive documents", parentId: parent });
    // Records + request folder + 2 subfolders.
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(4);
  });

  test("ownership inference counts tagged documents inside the subfolders", async () => {
    const r1 = await mkRequest();
    const r2 = await mkRequest();
    const sub = await role(r1.id, "received_records");
    await prisma.document.update({
      where: { id: (await seedDocument({ matterId, folderId: sub })).documentId },
      data: { recordsRequestId: r1.id, recordsRequestRole: "received_records" },
    });
    const parent1 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r1.id)));
    const parent2 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r2.id)));
    expect(parent2).not.toBe(parent1);
    const f2 = await prisma.documentFolder.findUniqueOrThrow({ where: { id: parent2 } });
    expect(f2.name).toBe("Memorial Hospital — CORA (2)");
    expect(await role(r1.id, "received_records")).toBe(sub);
  });

  test("tidy moves this request's flat documents by role and leaves role-null ones", async () => {
    const r = await mkRequest();
    const other = await mkRequest();
    const parent = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const mk = async (data: object) =>
      (
        await prisma.document.update({
          where: { id: (await seedDocument({ matterId, folderId: parent })).documentId },
          data,
          select: { id: true },
        })
      ).id;
    const letter = await mk({ recordsRequestId: r.id, recordsRequestRole: "request_letter" });
    const resp = await mk({ recordsRequestId: r.id, recordsRequestRole: "received_records" });
    const untagged = await mk({});
    const foreign = await mk({
      recordsRequestId: other.id,
      recordsRequestRole: "received_records",
    });
    const reqSub = await role(r.id, "request_letter");
    const respSub = await role(r.id, "received_records");
    const folderOf = async (id: string) =>
      (await prisma.document.findUniqueOrThrow({ where: { id } })).folderId;
    expect(await folderOf(letter)).toBe(reqSub);
    expect(await folderOf(resp)).toBe(respSub);
    expect(await folderOf(untagged)).toBe(parent);
    expect(await folderOf(foreign)).toBe(parent);
    // Idempotent.
    expect(await role(r.id, "request_letter")).toBe(reqSub);
    expect(await folderOf(letter)).toBe(reqSub);
  });
});

describe("resolveRecordsUpload", () => {
  const M = () => ({ kind: "matter" as const, matterId });

  test("in-scope request: tagged and filed in the Responsive documents subfolder", async () => {
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
    expect(f.name).toBe("Responsive documents");
  });

  test("the request_letter role files into Request documents", async () => {
    const r = await mkRequest();
    const tag = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, M(), null, "request_letter")
    );
    expect(tag?.recordsRequestRole).toBe("request_letter");
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: tag!.folderId },
    });
    expect(f.name).toBe("Request documents");
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

  test("a null folderId falls back to the role folder", async () => {
    const r = await mkRequest();
    const direct = await prisma.$transaction((tx) =>
      resolveRecordsRoleFolder(tx, args(r.id), "received_records")
    );
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
