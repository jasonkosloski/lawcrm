import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedDocument,
  seedDocumentFolder,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import {
  canPortalDownload,
  listPortalSharedDocuments,
  listPortalUploads,
} from "./document-visibility.server";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let matterId: string;
let otherMatterId: string;
let identityId: string;
let otherIdentityId: string;
let userId: string;

async function identity(email: string, matters: string[]) {
  const { contactId } = await seedContact({ email });
  const id = (await prisma.portalIdentity.create({ data: { contactId, email } })).id;
  for (const m of matters) {
    await prisma.portalMatterAccess.create({ data: { identityId: id, matterId: m, invitedById: userId } });
  }
  return id;
}

async function names(matter = matterId) {
  return (await listPortalSharedDocuments(identityId, matter)).map((d) => d.name).sort();
}

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  ({ userId } = await seedUser({ firmId }));
  const { stageId, areaId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
  ({ matterId: otherMatterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "Other" }));
  identityId = await identity("a@example.com", [matterId]);
  otherIdentityId = await identity("b@example.com", [matterId]);
});

describe("listPortalSharedDocuments / canPortalDownload", () => {
  test("folder share lists files; archived excluded", async () => {
    const { folderId } = await seedDocumentFolder({ matterId, name: "Shared" });
    await prisma.documentFolder.update({ where: { id: folderId }, data: { clientShared: true } });
    await seedDocument({ matterId, name: "in.pdf", folderId });
    const { documentId } = await seedDocument({ matterId, name: "gone.pdf", folderId });
    await prisma.document.update({ where: { id: documentId }, data: { status: "archived" } });
    const rows = await listPortalSharedDocuments(identityId, matterId);
    expect(rows.map((r) => r.name)).toEqual(["in.pdf"]);
    expect(rows[0].folderName).toBe("Shared");
    expect(await canPortalDownload(identityId, documentId)).toBeNull();
  });

  test("lead document is never listed", async () => {
    const { leadId } = await seedLead();
    await prisma.document.create({
      data: { leadId, name: "lead.pdf", category: "other", source: "upload", clientShare: "shared", fileUrl: "x" },
    });
    expect(await names()).toEqual([]);
    const d = await prisma.document.findFirstOrThrow({ where: { leadId } });
    expect(await canPortalDownload(identityId, d.id)).toBeNull();
  });

  test("revoked access returns [] and download null", async () => {
    const { documentId } = await seedDocument({ matterId, name: "s.pdf" });
    await prisma.document.update({ where: { id: documentId }, data: { clientShare: "shared", fileUrl: "f" } });
    expect(await names()).toEqual(["s.pdf"]);
    await prisma.portalMatterAccess.updateMany({ data: { revokedAt: new Date() } });
    expect(await names()).toEqual([]);
    expect(await canPortalDownload(identityId, documentId)).toBeNull();
  });

  test("portal off returns [] and null", async () => {
    const { documentId } = await seedDocument({ matterId, name: "s.pdf" });
    await prisma.document.update({ where: { id: documentId }, data: { clientShare: "shared", fileUrl: "f" } });
    await prisma.firm.updateMany({ data: { portalEnabled: false } });
    expect(await names()).toEqual([]);
    expect(await canPortalDownload(identityId, documentId)).toBeNull();
  });

  test("moving a file from a shared to an unshared folder removes it", async () => {
    const shared = (await seedDocumentFolder({ matterId, name: "Shared" })).folderId;
    const plain = (await seedDocumentFolder({ matterId, name: "Plain" })).folderId;
    await prisma.documentFolder.update({ where: { id: shared }, data: { clientShared: true } });
    const { documentId } = await seedDocument({ matterId, name: "m.pdf", folderId: shared });
    await prisma.document.update({ where: { id: documentId }, data: { fileUrl: "f" } });
    expect(await names()).toEqual(["m.pdf"]);
    expect(await canPortalDownload(identityId, documentId)).not.toBeNull();
    await prisma.document.update({ where: { id: documentId }, data: { folderId: plain } });
    expect(await names()).toEqual([]);
    expect(await canPortalDownload(identityId, documentId)).toBeNull();
  });

  test("hidden file stays hidden after folder unshared then re-shared", async () => {
    const folderId = (await seedDocumentFolder({ matterId, name: "F" })).folderId;
    await prisma.documentFolder.update({ where: { id: folderId }, data: { clientShared: true } });
    const { documentId } = await seedDocument({ matterId, name: "h.pdf", folderId });
    await prisma.document.update({ where: { id: documentId }, data: { clientShare: "hidden", fileUrl: "f" } });
    expect(await names()).toEqual([]);
    await prisma.documentFolder.update({ where: { id: folderId }, data: { clientShared: false } });
    await prisma.documentFolder.update({ where: { id: folderId }, data: { clientShared: true } });
    expect(await names()).toEqual([]);
    expect(await canPortalDownload(identityId, documentId)).toBeNull();
  });

  test("download returns file info", async () => {
    const { documentId } = await seedDocument({ matterId, name: "d.pdf", contentType: "application/pdf" });
    await prisma.document.update({ where: { id: documentId }, data: { clientShare: "shared", fileUrl: "/u/d.pdf" } });
    expect(await canPortalDownload(identityId, documentId)).toEqual({
      fileUrl: "/u/d.pdf",
      name: "d.pdf",
      contentType: "application/pdf",
    });
  });

  test("own-matter upload downloadable though unshared; other-matter not", async () => {
    const mine = await prisma.document.create({
      data: { matterId, name: "up.pdf", category: "other", source: "upload", fileUrl: "f", portalUploaderId: otherIdentityId },
    });
    expect(await names()).toEqual([]);
    expect(await canPortalDownload(identityId, mine.id)).not.toBeNull();
    const theirs = await prisma.document.create({
      data: { matterId: otherMatterId, name: "x.pdf", category: "other", source: "upload", fileUrl: "f", portalUploaderId: otherIdentityId },
    });
    expect(await canPortalDownload(identityId, theirs.id)).toBeNull();
  });
});

describe("listPortalUploads", () => {
  test("lists matter-wide uploads from any live identity, with request title", async () => {
    const req = await prisma.documentRequest.create({
      data: { matterId, title: "W-2s", createdById: userId },
    });
    await prisma.document.create({
      data: { matterId, name: "a.pdf", category: "other", source: "upload", fileUrl: "f", fileSize: 5, portalUploaderId: otherIdentityId, documentRequestId: req.id },
    });
    await prisma.document.create({
      data: { matterId: otherMatterId, name: "n.pdf", category: "other", source: "upload", fileUrl: "f", portalUploaderId: otherIdentityId },
    });
    const rows = await listPortalUploads(identityId, matterId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "a.pdf", requestTitle: "W-2s", uploaderEmail: "b@example.com", fileSize: 5 });
    await prisma.portalMatterAccess.updateMany({ where: { identityId }, data: { revokedAt: new Date() } });
    expect(await listPortalUploads(identityId, matterId)).toEqual([]);
  });
});
