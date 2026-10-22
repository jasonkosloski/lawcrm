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
  matterId = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId })).matterId;
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
  test("creates Investigation/Records Requests/<custodian — type> and is idempotent", async () => {
    const r = await mkRequest();
    const a = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const b = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    expect(b).toBe(a);
    const folder = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: a },
      include: { parent: { include: { parent: true } } },
    });
    expect(folder.name).toBe("Memorial Hospital — CORA");
    expect(folder.parent?.name).toBe("Records Requests");
    expect(folder.parent?.parent?.name).toBe("Investigation");
    expect(folder.parent?.parent?.parentId).toBeNull();
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(3);
  });

  test("reuses a pre-existing root Investigation folder (any case)", async () => {
    const inv = await seedDocumentFolder({ matterId, name: "investigation" });
    const r = await mkRequest();
    const id = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id },
      include: { parent: true },
    });
    expect(f.parent?.parentId).toBe(inv.folderId);
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(3);
  });

  test("a legacy root Records folder holding request files moves under Investigation as Records Requests", async () => {
    const legacy = await seedDocumentFolder({ matterId, name: "Records" });
    const reqFolder = await seedDocumentFolder({
      matterId,
      name: "Memorial Hospital — CORA",
      parentId: legacy.folderId,
    });
    const r = await mkRequest();
    const subA = await seedDocumentFolder({
      matterId,
      name: "Request documents",
      parentId: reqFolder.folderId,
    });
    const subB = await seedDocumentFolder({
      matterId,
      name: "Responsive documents",
      parentId: reqFolder.folderId,
    });
    await prisma.document.update({
      where: {
        id: (await seedDocument({ matterId, folderId: reqFolder.folderId })).documentId,
      },
      data: { recordsRequestId: r.id, recordsRequestRole: "received_records" },
    });
    const id = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    expect(id).toBe(reqFolder.folderId);
    const moved = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: legacy.folderId },
      include: { parent: true },
    });
    expect(moved.name).toBe("Records Requests");
    expect(moved.parent?.name).toBe("Investigation");
    expect(moved.systemKind).toBe("records_root");
    // Adopted children are linked, not duplicated as "(2)".
    expect(
      await prisma.documentFolder.findUniqueOrThrow({ where: { id: reqFolder.folderId } }),
    ).toMatchObject({ systemKind: "records_request", recordsRequestId: r.id });
    expect(
      await prisma.documentFolder.findUniqueOrThrow({ where: { id: subA.folderId } }),
    ).toMatchObject({ systemKind: "records_request_docs", recordsRequestId: r.id });
    expect(
      await prisma.documentFolder.findUniqueOrThrow({ where: { id: subB.folderId } }),
    ).toMatchObject({ systemKind: "records_responsive_docs", recordsRequestId: r.id });
  });

  test("a root Records folder with no request files is left alone", async () => {
    const own = await seedDocumentFolder({ matterId, name: "Records" });
    const r = await mkRequest();
    const id = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const untouched = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: own.folderId },
    });
    expect(untouched.name).toBe("Records");
    expect(untouched.parentId).toBeNull();
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id },
      include: { parent: true },
    });
    expect(f.parent?.name).toBe("Records Requests");
  });

  test("same custodian and type: second request gets (2), each linked to its own request", async () => {
    const r1 = await mkRequest();
    const r2 = await mkRequest();
    const f1 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r1.id)));
    const f2 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r2.id)));
    expect(f2).not.toBe(f1);
    const first = await prisma.documentFolder.findUniqueOrThrow({ where: { id: f1 } });
    const second = await prisma.documentFolder.findUniqueOrThrow({ where: { id: f2 } });
    expect(first).toMatchObject({ name: "Memorial Hospital — CORA", recordsRequestId: r1.id });
    expect(second).toMatchObject({
      name: "Memorial Hospital — CORA (2)",
      recordsRequestId: r2.id,
    });
    expect(await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r1.id)))).toBe(f1);
    expect(await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r2.id)))).toBe(f2);
  });

  test("created folders carry kinds and links", async () => {
    const r = await mkRequest();
    const id = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id },
      include: { parent: true },
    });
    expect(f).toMatchObject({ systemKind: "records_request", recordsRequestId: r.id });
    expect(f.parent?.systemKind).toBe("records_root");
    const letter = await prisma.$transaction((tx) =>
      resolveRecordsRoleFolder(tx, args(r.id), "request_letter"),
    );
    const resp = await prisma.$transaction((tx) =>
      resolveRecordsRoleFolder(tx, args(r.id), "received_records"),
    );
    expect(await prisma.documentFolder.findUniqueOrThrow({ where: { id: letter } })).toMatchObject({
      systemKind: "records_request_docs",
      recordsRequestId: r.id,
    });
    expect(await prisma.documentFolder.findUniqueOrThrow({ where: { id: resp } })).toMatchObject({
      systemKind: "records_responsive_docs",
      recordsRequestId: r.id,
    });
  });

  test("a renamed linked folder is returned as is; nothing new is created", async () => {
    const r = await mkRequest();
    const id = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    await prisma.documentFolder.update({ where: { id }, data: { name: "Old name" } });
    const before = await prisma.documentFolder.count({ where: { matterId } });
    expect(await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)))).toBe(id);
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(before);
  });

  test("renaming Investigation does not spawn a second tree", async () => {
    const r = await mkRequest();
    const id = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id },
      include: { parent: true },
    });
    await prisma.documentFolder.update({
      where: { id: f.parent!.parentId! },
      data: { name: "Case work" },
    });
    const before = await prisma.documentFolder.count({ where: { matterId } });
    expect(await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)))).toBe(id);
    const r2 = await mkRequest();
    const id2 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r2.id)));
    const f2 = await prisma.documentFolder.findUniqueOrThrow({ where: { id: id2 } });
    expect(f2.parentId).toBe(f.parentId);
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(before + 1);
    expect(
      await prisma.documentFolder.count({ where: { matterId, systemKind: "records_root" } }),
    ).toBe(1);
  });

  test("moving Investigation under another folder does not spawn a second tree", async () => {
    const r = await mkRequest();
    const id = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id },
      include: { parent: true },
    });
    const other = await seedDocumentFolder({ matterId, name: "Archive" });
    await prisma.documentFolder.update({
      where: { id: f.parent!.parentId! },
      data: { parentId: other.folderId },
    });
    const before = await prisma.documentFolder.count({ where: { matterId } });
    const r2 = await mkRequest();
    const id2 = await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r2.id)));
    const f2 = await prisma.documentFolder.findUniqueOrThrow({ where: { id: id2 } });
    expect(f2.parentId).toBe(f.parentId);
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(before + 1);
    expect(await prisma.documentFolder.count({ where: { matterId, name: "Investigation" } })).toBe(
      1,
    );
  });

  test("an existing Records Requests folder found by name is stamped records_root", async () => {
    const inv = await seedDocumentFolder({ matterId, name: "Investigation" });
    const root = await seedDocumentFolder({
      matterId,
      name: "Records Requests",
      parentId: inv.folderId,
    });
    const r = await mkRequest();
    await prisma.$transaction((tx) => resolveRecordsFolder(tx, args(r.id)));
    const stamped = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: root.folderId },
    });
    expect(stamped.systemKind).toBe("records_root");
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
    // Investigation + Records Requests + request folder + 2 subfolders.
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(5);
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
    const tag = await prisma.$transaction((tx) => resolveRecordsUpload(tx, r.id, M(), null));
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
      resolveRecordsUpload(tx, r.id, M(), null, "request_letter"),
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
    const tag = await prisma.$transaction((tx) => resolveRecordsUpload(tx, r.id, M(), null));
    expect(tag).toBeNull();
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(0);
  });

  test("an explicit folderId is kept and no records folder is created", async () => {
    const r = await mkRequest();
    const { folderId } = await seedDocumentFolder({ matterId, name: "Mine" });
    const tag = await prisma.$transaction((tx) => resolveRecordsUpload(tx, r.id, M(), folderId));
    expect(tag?.folderId).toBe(folderId);
    expect(await prisma.documentFolder.count({ where: { matterId } })).toBe(1);
  });

  test("a null folderId falls back to the role folder", async () => {
    const r = await mkRequest();
    const direct = await prisma.$transaction((tx) =>
      resolveRecordsRoleFolder(tx, args(r.id), "received_records"),
    );
    const tag = await prisma.$transaction((tx) => resolveRecordsUpload(tx, r.id, M(), null));
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
    const tag = await prisma.$transaction((tx) => resolveRecordsUpload(tx, r.id, M(), null));
    expect(tag?.recordsRequestId).toBe(r.id);
    const f = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: tag!.folderId },
    });
    expect(f.matterId).toBe(matterId);
    // The stale lead scope no longer matches.
    const stale = await prisma.$transaction((tx) =>
      resolveRecordsUpload(tx, r.id, { kind: "lead", leadId }, null),
    );
    expect(stale).toBeNull();
  });

  test("deleted request -> null, so the upload files untagged", async () => {
    const r = await mkRequest();
    await prisma.recordsRequest.delete({ where: { id: r.id } });
    const tag = await prisma.$transaction((tx) => resolveRecordsUpload(tx, r.id, M(), null));
    expect(tag).toBeNull();
  });
});
