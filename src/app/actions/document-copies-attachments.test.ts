/**
 * Email attachments as documents + "Copy to…" (ADR-043), against the
 * test DB with in-memory storage.
 *
 * Pinned:
 *   - extraction: one document per listed attachment (inline cid
 *     images excluded), under the email, index-aligned, idempotent;
 *     a failure stores nothing and can be retried
 *   - copies: an independent document sharing the stored file (no new
 *     upload); copying an email copies its attachments; deleting either
 *     side keeps the bytes while the other still uses them
 *   - deleting an email: attachments with a copy elsewhere live on as
 *     that copy; the rest are deleted or kept per the prompt; with no
 *     choice the server refuses
 *   - moving an email carries its attachments; moving an attachment is
 *     refused
 *   - the folder listing nests attachments and reports their copies
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, Buffer>();
let storeFails = false;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/file-storage", () => ({
  statFile: vi.fn(async (k: string) => (store.has(k) ? { size: store.get(k)!.length } : null)),
  readStoredFile: vi.fn(async (k: string) => store.get(k) ?? null),
  storeFile: vi.fn(async (f: File) => {
    if (storeFails) throw new Error("storage down");
    const key = `k__${store.size}__${f.name}`;
    store.set(key, Buffer.from(await f.arrayBuffer()));
    return { key, size: f.size, contentType: f.type };
  }),
  deleteFile: vi.fn(async (k: string) => void store.delete(k)),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { copyDocumentToFolder, deleteDocument, extractAttachments } from "@/app/actions/documents";
import { moveDocuments } from "@/app/actions/document-folders";
import { extractEmailAttachments } from "@/lib/email-attachment-extract";
import { getDocumentFolders, getFolderDocumentCounts } from "@/lib/queries/matter-detail";
import { getFolderListing } from "@/lib/queries/document-listing";
import {
  resetDb,
  seedDocumentFolder,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const EML = [
  "From: Officer Smith <smith@pd.example>",
  "To: counsel@firm.example",
  "Subject: Incident 26-1043",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="m1"',
  "",
  "--m1",
  'Content-Type: multipart/related; boundary="r1"',
  "",
  "--r1",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Report attached.</p><img src="cid:seal@pd">',
  "--r1",
  "Content-Type: image/png",
  "Content-ID: <seal@pd>",
  "Content-Disposition: inline",
  "Content-Transfer-Encoding: base64",
  "",
  PNG.toString("base64"),
  "--r1--",
  "--m1",
  "Content-Type: application/pdf",
  'Content-Disposition: attachment; filename="report.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 report").toString("base64"),
  "--m1",
  "Content-Type: text/csv",
  'Content-Disposition: attachment; filename="timeline.csv"',
  "",
  "time,event",
  "--m1--",
  "",
].join("\r\n");

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  store.clear();
  storeFails = false;
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId })).userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(requirePermission).mockResolvedValue(userId);
  const { areaId, stageId } = await seedPracticeArea();
  matterId = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId })).matterId;
});

async function seedEmail(folderId: string | null = null): Promise<string> {
  store.set("k__email.eml", Buffer.from(EML));
  const doc = await prisma.document.create({
    data: {
      matterId,
      folderId,
      name: "Incident email.eml",
      contentType: "message/rfc822",
      fileUrl: "k__email.eml",
      fileSize: EML.length,
      uploadedBy: userId,
    },
    select: { id: true },
  });
  return doc.id;
}

const attachmentsOf = (emailId: string) =>
  prisma.document.findMany({
    where: { parentDocumentId: emailId },
    orderBy: { attachmentIndex: "asc" },
  });

describe("extracting an email's attachments", () => {
  test("one document per listed attachment, under the email, index-aligned", async () => {
    const folder = await seedDocumentFolder({ matterId, name: "Discovery" });
    const emailId = await seedEmail(folder.folderId);
    const res = await extractEmailAttachments(emailId, userId);
    expect(res).toEqual({ ok: true, created: 2 });
    const kids = await attachmentsOf(emailId);
    expect(kids.map((k) => [k.name, k.attachmentIndex, k.folderId, k.source])).toEqual([
      ["report.pdf", 0, folder.folderId, "email_attachment"],
      ["timeline.csv", 1, folder.folderId, "email_attachment"],
    ]);
    expect(kids[0].contentType).toBe("application/pdf");
    expect(store.get(kids[0].fileUrl!)!.toString()).toBe("%PDF-1.4 report");
    // The inline seal is part of the body, not an attachment.
    expect(kids.some((k) => k.name.includes("seal"))).toBe(false);
  });

  test("idempotent: a second run (or the button) adds nothing", async () => {
    const emailId = await seedEmail();
    await extractEmailAttachments(emailId, userId);
    expect(await extractEmailAttachments(emailId, userId)).toEqual({
      ok: true,
      created: 0,
      alreadyExtracted: true,
    });
    expect(await extractAttachments(emailId)).toEqual({ ok: true, created: 0 });
    expect(await attachmentsOf(emailId)).toHaveLength(2);
  });

  test("a failure stores nothing and releases the email for a retry", async () => {
    const emailId = await seedEmail();
    storeFails = true;
    const res = await extractEmailAttachments(emailId, userId);
    expect(res.ok).toBe(false);
    expect(await attachmentsOf(emailId)).toHaveLength(0);
    expect(store.size).toBe(1); // just the email
    storeFails = false;
    expect(await extractAttachments(emailId)).toEqual({ ok: true, created: 2 });
  });

  test("non-email documents are refused", async () => {
    store.set("k__a.pdf", Buffer.from("%PDF"));
    const pdf = await prisma.document.create({
      data: { matterId, name: "a.pdf", contentType: "application/pdf", fileUrl: "k__a.pdf" },
      select: { id: true },
    });
    expect(await extractAttachments(pdf.id)).toMatchObject({ ok: false });
  });
});

describe("deleting an email with attachments", () => {
  async function extracted(folderId: string | null = null) {
    const emailId = await seedEmail(folderId);
    await extractEmailAttachments(emailId, userId);
    const [report, timeline] = await attachmentsOf(emailId);
    return { emailId, report, timeline };
  }

  test("without a choice for unsaved attachments, the server refuses", async () => {
    const { emailId } = await extracted();
    expect(await deleteDocument(emailId)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/choose/i),
    });
    expect(await prisma.document.count({ where: { id: emailId } })).toBe(1);
  });

  test("an attachment copied elsewhere lives on as its copy; the rest go with the email", async () => {
    const exhibits = await seedDocumentFolder({ matterId, name: "Exhibits" });
    const { emailId, report, timeline } = await extracted();
    const copy = await copyDocumentToFolder(report.id, exhibits.folderId);
    expect(copy.ok).toBe(true);

    expect(await deleteDocument(emailId, { attachments: "delete" })).toEqual({ ok: true });
    expect(await prisma.document.count({ where: { parentDocumentId: emailId } })).toBe(0);
    expect(await prisma.document.findUnique({ where: { id: copy.id! } })).toMatchObject({
      folderId: exhibits.folderId,
      parentDocumentId: null,
      fileUrl: report.fileUrl,
    });
    // The copy still uses the report's bytes; the timeline's are gone.
    expect(store.has(report.fileUrl!)).toBe(true);
    expect(store.has(timeline.fileUrl!)).toBe(false);
  });

  test("when every attachment has a copy, there's no choice to make", async () => {
    const exhibits = await seedDocumentFolder({ matterId, name: "Exhibits" });
    const { emailId, report, timeline } = await extracted();
    await copyDocumentToFolder(report.id, exhibits.folderId);
    await copyDocumentToFolder(timeline.id, exhibits.folderId);
    expect(await deleteDocument(emailId)).toEqual({ ok: true });
    expect(await prisma.document.count({ where: { folderId: exhibits.folderId } })).toBe(2);
  });

  test("“keep” leaves unsaved attachments in the email's folder as ordinary documents", async () => {
    const folder = await seedDocumentFolder({ matterId, name: "Discovery" });
    const { emailId, report, timeline } = await extracted(folder.folderId);
    expect(await deleteDocument(emailId, { attachments: "keep" })).toEqual({ ok: true });
    const rows = await prisma.document.findMany({
      where: { id: { in: [report.id, timeline.id] } },
    });
    expect(rows.every((r) => r.folderId === folder.folderId && r.parentDocumentId === null)).toBe(
      true,
    );
  });
});

describe("Copy to…", () => {
  test("an independent document that shares the stored file", async () => {
    const a = await seedDocumentFolder({ matterId, name: "A" });
    const b = await seedDocumentFolder({ matterId, name: "B" });
    store.set("k__brief.pdf", Buffer.from("%PDF brief"));
    const doc = await prisma.document.create({
      data: {
        matterId,
        folderId: a.folderId,
        name: "brief.pdf",
        fileUrl: "k__brief.pdf",
        contentType: "application/pdf",
        fileSize: 10,
        status: "review",
        uploadedBy: userId,
      },
      select: { id: true },
    });
    const res = await copyDocumentToFolder(doc.id, b.folderId);
    expect(res.ok).toBe(true);
    const copy = await prisma.document.findUnique({ where: { id: res.id! } });
    expect(copy).toMatchObject({
      folderId: b.folderId,
      name: "brief.pdf",
      fileUrl: "k__brief.pdf",
      status: "review",
      parentDocumentId: null,
    });
    expect(store.size).toBe(1); // nothing stored again

    // Its own thing: renaming one doesn't touch the other…
    await prisma.document.update({ where: { id: copy!.id }, data: { name: "Exhibit 4.pdf" } });
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toMatchObject({
      name: "brief.pdf",
    });
    // …and deleting the original keeps the bytes the copy still uses.
    expect(await deleteDocument(doc.id)).toEqual({ ok: true });
    expect(store.has("k__brief.pdf")).toBe(true);
    expect(await deleteDocument(copy!.id)).toEqual({ ok: true });
    expect(store.has("k__brief.pdf")).toBe(false);
  });

  test("copying an email copies its attachments with it", async () => {
    const dest = await seedDocumentFolder({ matterId, name: "Dest" });
    const emailId = await seedEmail();
    await extractEmailAttachments(emailId, userId);
    const res = await copyDocumentToFolder(emailId, dest.folderId);
    const kids = await attachmentsOf(res.id!);
    expect(kids.map((k) => [k.name, k.attachmentIndex, k.folderId])).toEqual([
      ["report.pdf", 0, dest.folderId],
      ["timeline.csv", 1, dest.folderId],
    ]);
    expect(
      (await prisma.document.findUnique({ where: { id: res.id! } }))?.attachmentsExtractedAt,
    ).not.toBeNull();
  });

  test("a folder from another matter is refused", async () => {
    const { areaId, stageId } = await seedPracticeArea({ name: "Other" });
    const other = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
    const foreign = await seedDocumentFolder({ matterId: other.matterId, name: "Theirs" });
    const doc = await prisma.document.create({
      data: { matterId, name: "x.pdf" },
      select: { id: true },
    });
    expect(await copyDocumentToFolder(doc.id, foreign.folderId)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not found/),
    });
  });
});

describe("folders, moves and attachments", () => {
  test("moving an email carries its attachments; moving an attachment is refused", async () => {
    const dest = await seedDocumentFolder({ matterId, name: "Dest" });
    const emailId = await seedEmail();
    await extractEmailAttachments(emailId, userId);
    const [report] = await attachmentsOf(emailId);
    expect(await moveDocuments([report.id], dest.folderId)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Copy to/),
    });
    expect(await moveDocuments([emailId], dest.folderId)).toEqual({ ok: true });
    expect((await attachmentsOf(emailId)).every((k) => k.folderId === dest.folderId)).toBe(true);
  });
});

describe("getFolderListing", () => {
  test("nests attachments under their email and reports where they've been copied", async () => {
    const exhibits = await seedDocumentFolder({ matterId, name: "Exhibits" });
    const emailId = await seedEmail();
    await extractEmailAttachments(emailId, userId);
    const [report] = await attachmentsOf(emailId);
    await copyDocumentToFolder(report.id, exhibits.folderId);

    const root = await getFolderListing({ kind: "matter", matterId }, null);
    expect(root.documents.map((d) => d.name)).toEqual(["Incident email.eml"]);
    expect(root.documents[0].isEmail).toBe(true);
    expect(root.documents[0].attachments.map((a) => a.name)).toEqual([
      "report.pdf",
      "timeline.csv",
    ]);
    expect(root.documents[0].attachments.map((a) => a.copiedTo)).toEqual([["Exhibits"], []]);

    const inExhibits = await getFolderListing({ kind: "matter", matterId }, exhibits.folderId);
    expect(inExhibits.documents.map((d) => d.name)).toEqual(["report.pdf"]);
  });
});

describe("lead (intake) scope", () => {
  async function leadEmail(leadId: string): Promise<string> {
    store.set("k__lead.eml", Buffer.from(EML));
    const doc = await prisma.document.create({
      data: {
        leadId,
        name: "Lead email.eml",
        contentType: "message/rfc822",
        fileUrl: "k__lead.eml",
        fileSize: EML.length,
        uploadedBy: userId,
      },
      select: { id: true },
    });
    return doc.id;
  }

  test("extracted attachments inherit the lead scope", async () => {
    const { leadId } = await seedLead();
    const emailId = await leadEmail(leadId);
    expect(await extractAttachments(emailId)).toEqual({ ok: true, created: 2 });
    const kids = await attachmentsOf(emailId);
    expect(kids).toHaveLength(2);
    expect(kids.every((k) => k.leadId === leadId && k.matterId === null)).toBe(true);
    // The audit row carries the lead so the lead wall filters it (ADR-049).
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: { contains: "email attachment" } },
    });
    expect(log.leadId).toBe(leadId);
  });

  test("lead listing and folder queries return only that lead's rows", async () => {
    const { leadId } = await seedLead();
    await seedEmail(); // a matter root document
    await leadEmail(leadId);
    await prisma.documentFolder.create({ data: { leadId, name: "LF" }, select: { id: true } });
    const listing = await getFolderListing({ kind: "lead", leadId }, null);
    expect(listing.documents.map((d) => d.name)).toEqual(["Lead email.eml"]);
    const folders = await getDocumentFolders({ kind: "lead", leadId });
    expect(folders.map((f) => f.name)).toEqual(["LF"]);
    const { rootCount } = await getFolderDocumentCounts({ kind: "lead", leadId });
    expect(rootCount).toBe(1);
  });

  test("copying a lead document into a matter folder is refused", async () => {
    const { leadId } = await seedLead();
    const folder = await seedDocumentFolder({ matterId, name: "M" });
    const doc = await prisma.document.create({
      data: { leadId, name: "x.pdf" },
      select: { id: true },
    });
    expect(await copyDocumentToFolder(doc.id, folder.folderId)).toEqual({
      ok: false,
      error: "Documents and folders can only move within the same matter or intake.",
    });
  });

  test("copying a lead document into another lead folder works and keeps the lead", async () => {
    const { leadId } = await seedLead();
    const dest = await prisma.documentFolder.create({
      data: { leadId, name: "Dest" },
      select: { id: true },
    });
    const doc = await prisma.document.create({
      data: { leadId, name: "x.pdf" },
      select: { id: true },
    });
    const res = await copyDocumentToFolder(doc.id, dest.id);
    expect(res.ok).toBe(true);
    expect(await prisma.document.findUnique({ where: { id: res.id! } })).toMatchObject({
      leadId,
      matterId: null,
      folderId: dest.id,
    });
  });

  test("a folder of a different lead is not found", async () => {
    const { leadId } = await seedLead();
    const other = await seedLead({ name: "Other" });
    const theirs = await prisma.documentFolder.create({
      data: { leadId: other.leadId, name: "T" },
      select: { id: true },
    });
    const doc = await prisma.document.create({
      data: { leadId, name: "x.pdf" },
      select: { id: true },
    });
    expect(await copyDocumentToFolder(doc.id, theirs.id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not found/),
    });
  });
});
