import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/file-storage", () => ({ deleteFile: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { portalUploadsInLastDay, recordPortalUpload } from "./record-upload";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;
let userId: string;
let otherUserId: string;
let matterId: string;
let otherMatterId: string;
let identityId: string;
let keyN = 0;

const BATCH = "11111111-1111-4111-8111-111111111111";
const BATCH2 = "22222222-2222-4222-8222-222222222222";

function input(over: Partial<Parameters<typeof recordPortalUpload>[0]> = {}) {
  keyN += 1;
  return {
    identityId,
    matterId,
    requestId: null,
    batchId: BATCH,
    storageKey: `https://store.public.blob.vercel-storage.com/K${keyN}__a.pdf`,
    filename: "a.pdf",
    contentType: "application/pdf",
    size: 1234,
    ...over,
  };
}

async function request(status: string, matter = matterId, returnNote: string | null = null) {
  return (
    await prisma.documentRequest.create({
      data: { matterId: matter, title: "Bank statements", status, returnNote, createdById: userId },
    })
  ).id;
}

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  ({ userId } = await seedUser({ firmId }));
  ({ userId: otherUserId } = await seedUser({ firmId }));
  const { stageId, areaId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "Smith v Jones" }));
  ({ matterId: otherMatterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "Other" }));
  await prisma.matterTeamMember.create({ data: { matterId, userId: otherUserId, role: "paralegal" } });
  const { contactId } = await seedContact({ name: "Pat Client", email: "pat@example.com" });
  identityId = (await prisma.portalIdentity.create({ data: { contactId, email: "pat@example.com" } })).id;
  await prisma.portalMatterAccess.create({ data: { identityId, matterId, invitedById: userId } });
});

afterEach(() => {
  vi.mocked(deleteFile).mockClear();
});

describe("recordPortalUpload", () => {
  test("creates the document in a From client folder", async () => {
    const i = input({ note: "My lease" });
    const r = await recordPortalUpload(i);
    expect(r).toMatchObject({ ok: true, requestClosed: false });
    if (!r.ok) return;
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: r.documentId }, include: { folder: true } });
    expect(doc).toMatchObject({
      matterId,
      leadId: null,
      name: "a.pdf",
      source: "portal",
      uploadedBy: null,
      portalUploaderId: identityId,
      portalBatchId: BATCH,
      documentRequestId: null,
      fileUrl: i.storageKey,
      contentType: "application/pdf",
      fileSize: 1234,
      clientShare: null,
    });
    expect(doc.folder).toMatchObject({
      name: "From client",
      systemKind: "portal_uploads",
      clientShared: false,
      parentId: null,
      matterId,
    });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId, title: "Client uploaded a document" } });
    expect(log.userId).toBeNull();
    expect(log.detail).toContain(identityId);
    expect(log.detail).toContain("My lease");
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test("a second upload reuses the folder", async () => {
    await recordPortalUpload(input());
    await recordPortalUpload(input({ batchId: BATCH2 }));
    expect(await prisma.documentFolder.count({ where: { matterId, systemKind: "portal_uploads" } })).toBe(1);
    expect(await prisma.document.count({ where: { matterId } })).toBe(2);
  });

  test("an existing (oldest) From client folder is used even if a duplicate exists", async () => {
    const oldest = await prisma.documentFolder.create({
      data: { matterId, name: "From client", systemKind: "portal_uploads", createdAt: new Date(Date.now() - 60_000) },
    });
    await prisma.documentFolder.create({ data: { matterId, name: "From client", systemKind: "portal_uploads" } });
    const r = await recordPortalUpload(input());
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: r.documentId } })).folderId).toBe(oldest.id);
  });

  test("concurrent first uploads create exactly one folder and one notification per member", async () => {
    const results = await Promise.all([
      recordPortalUpload(input()),
      recordPortalUpload(input()),
      recordPortalUpload(input()),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma.documentFolder.count({ where: { matterId, systemKind: "portal_uploads" } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "portal_upload" } })).toBe(2);
  });

  test("open request moves to submitted, returnNote cleared, file linked", async () => {
    const requestId = await request("open", matterId, "Page 2 missing");
    const r = await recordPortalUpload(input({ requestId }));
    expect(r).toMatchObject({ ok: true, requestClosed: false });
    if (!r.ok) return;
    expect((await prisma.document.findUniqueOrThrow({ where: { id: r.documentId } })).documentRequestId).toBe(requestId);
    expect(await prisma.documentRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({
      status: "submitted",
      returnNote: null,
    });
  });

  test("later files of the same batch still link to the request it submitted", async () => {
    const requestId = await request("open");
    await recordPortalUpload(input({ requestId }));
    const second = await recordPortalUpload(input({ requestId }));
    expect(second).toMatchObject({ ok: true, requestClosed: false });
    expect(await prisma.document.count({ where: { documentRequestId: requestId } })).toBe(2);
    // A different batch is not part of that submission.
    const other = await recordPortalUpload(input({ requestId, batchId: BATCH2 }));
    expect(other).toMatchObject({ ok: true, requestClosed: true });
  });

  test("cancelled request: file lands unlinked, requestClosed true", async () => {
    const requestId = await request("cancelled");
    const r = await recordPortalUpload(input({ requestId }));
    expect(r).toMatchObject({ ok: true, requestClosed: true });
    if (!r.ok) return;
    expect((await prisma.document.findUniqueOrThrow({ where: { id: r.documentId } })).documentRequestId).toBeNull();
    expect((await prisma.documentRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("cancelled");
  });

  test("a request on another matter is never linked or moved", async () => {
    const requestId = await request("open", otherMatterId);
    const r = await recordPortalUpload(input({ requestId }));
    expect(r).toMatchObject({ ok: true, requestClosed: true });
    expect((await prisma.documentRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("open");
  });

  test.each([
    ["revoked access", async () => { await prisma.portalMatterAccess.updateMany({ data: { revokedAt: new Date() } }); }],
    ["portal off", async () => { await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } }); }],
    ["identity disabled", async () => { await prisma.portalIdentity.update({ where: { id: identityId }, data: { disabledAt: new Date() } }); }],
    ["no access to that matter", async () => {}],
  ])("%s: no row, stored file deleted", async (label, arrange) => {
    await arrange();
    const i = label === "no access to that matter" ? input({ matterId: otherMatterId }) : input();
    const r = await recordPortalUpload(i);
    expect(r.ok).toBe(false);
    expect(await prisma.document.count()).toBe(0);
    expect(deleteFile).toHaveBeenCalledWith(i.storageKey);
    expect(await prisma.notification.count()).toBe(0);
  });

  test("a disallowed file type is refused and deleted", async () => {
    const i = input({ filename: "evil.exe" });
    const r = await recordPortalUpload(i);
    expect(r).toEqual({
      ok: false,
      error: "We can't accept .exe files. Please send PDFs, photos or Office documents.",
    });
    expect(await prisma.document.count()).toBe(0);
    expect(deleteFile).toHaveBeenCalledWith(i.storageKey);
  });

  test("redelivery creates no duplicate and deletes nothing, even after revoke", async () => {
    const i = input();
    const first = await recordPortalUpload(i);
    await prisma.portalMatterAccess.updateMany({ data: { revokedAt: new Date() } });
    const again = await recordPortalUpload(i);
    expect(first.ok && again.ok && again.documentId === first.documentId).toBe(true);
    expect(await prisma.document.count()).toBe(1);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(2);
  });

  test("one portal_upload notification per batch to each active team member", async () => {
    const { userId: formerId } = await seedUser({ firmId });
    await prisma.matterTeamMember.create({
      data: { matterId, userId: formerId, role: "paralegal", removedAt: new Date() },
    });
    await recordPortalUpload(input());
    await recordPortalUpload(input());
    let rows = await prisma.notification.findMany({ where: { type: "portal_upload" } });
    expect(rows.map((n) => n.userId).sort()).toEqual([userId, otherUserId].sort());
    expect(rows[0]).toMatchObject({ matterId, link: `/matters/${matterId}/documents` });
    expect(rows[0].title).toContain("Pat Client");
    await recordPortalUpload(input({ batchId: BATCH2 }));
    rows = await prisma.notification.findMany({ where: { type: "portal_upload" } });
    expect(rows).toHaveLength(4);
  });

  test("portalUploadsInLastDay counts this identity's rows inside 24h only", async () => {
    await recordPortalUpload(input());
    const old = await recordPortalUpload(input());
    if (!old.ok) throw new Error(old.error);
    await prisma.document.update({
      where: { id: old.documentId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    expect(await portalUploadsInLastDay(identityId)).toBe(1);
  });
});
