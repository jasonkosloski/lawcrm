/**
 * Email attachments as documents + extra folder links (ADR-043),
 * against the test DB with in-memory storage.
 *
 * Pinned:
 *   - extraction: one document per listed attachment (inline cid
 *     images excluded), under the email, index-aligned, idempotent;
 *     a failure stores nothing and can be retried
 *   - deleting an email: attachments filed elsewhere stay there (their
 *     first link becomes their home); the rest are deleted or kept per
 *     the prompt; with no choice the server refuses
 *   - links: add (validated, no duplicates), remove (document stays)
 *   - moving an email carries its attachments; moving an attachment is
 *     refused; deleting a folder moves its links up (dropping dupes)
 *   - the folder listing nests attachments and shows links
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
import {
  addDocumentLink,
  deleteDocument,
  extractAttachments,
  removeDocumentLink,
} from "@/app/actions/documents";
import { deleteFolder, moveDocuments } from "@/app/actions/document-folders";
import { extractEmailAttachments } from "@/lib/email-attachment-extract";
import { getFolderListing } from "@/lib/queries/document-listing";
import {
  resetDb,
  seedDocumentFolder,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
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
  prisma.document.findMany({ where: { parentDocumentId: emailId }, orderBy: { attachmentIndex: "asc" } });

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
    expect(await extractEmailAttachments(emailId, userId)).toEqual({ ok: true, created: 0, alreadyExtracted: true });
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
    expect(await deleteDocument(emailId)).toMatchObject({ ok: false, error: expect.stringMatching(/choose/i) });
    expect(await prisma.document.count({ where: { id: emailId } })).toBe(1);
  });

  test("attachments filed elsewhere stay there; the rest go with the email", async () => {
    const exhibits = await seedDocumentFolder({ matterId, name: "Exhibits" });
    const { emailId, report, timeline } = await extracted();
    expect(await addDocumentLink(report.id, exhibits.folderId)).toEqual({ ok: true });

    expect(await deleteDocument(emailId, { attachments: "delete" })).toEqual({ ok: true });
    const kept = await prisma.document.findUnique({ where: { id: report.id } });
    // Its link became its home; no link left pointing at the same place.
    expect(kept).toMatchObject({ folderId: exhibits.folderId, parentDocumentId: null, attachmentIndex: null });
    expect(await prisma.documentLink.count({ where: { documentId: report.id } })).toBe(0);
    expect(await prisma.document.count({ where: { id: timeline.id } })).toBe(0);
    expect(store.has(timeline.fileUrl!)).toBe(false);
    expect(store.has(report.fileUrl!)).toBe(true);
  });

  test("“keep” leaves unsaved attachments in the email's folder as ordinary documents", async () => {
    const folder = await seedDocumentFolder({ matterId, name: "Discovery" });
    const { emailId, report, timeline } = await extracted(folder.folderId);
    expect(await deleteDocument(emailId, { attachments: "keep" })).toEqual({ ok: true });
    const rows = await prisma.document.findMany({ where: { id: { in: [report.id, timeline.id] } } });
    expect(rows.every((r) => r.folderId === folder.folderId && r.parentDocumentId === null)).toBe(true);
  });
});

describe("extra folder links", () => {
  test("add and remove; the document itself never moves or goes away", async () => {
    const a = await seedDocumentFolder({ matterId, name: "A" });
    const b = await seedDocumentFolder({ matterId, name: "B" });
    const doc = await prisma.document.create({
      data: { matterId, folderId: a.folderId, name: "brief.pdf", uploadedBy: userId },
      select: { id: true },
    });
    expect(await addDocumentLink(doc.id, b.folderId)).toEqual({ ok: true });
    expect(await addDocumentLink(doc.id, b.folderId)).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });
    expect(await addDocumentLink(doc.id, a.folderId)).toMatchObject({ ok: false, error: expect.stringMatching(/already in/) });
    expect(await addDocumentLink(doc.id, null)).toEqual({ ok: true }); // the matter root
    expect(await addDocumentLink(doc.id, null)).toMatchObject({ ok: false });

    const links = await prisma.documentLink.findMany({ where: { documentId: doc.id } });
    expect(links).toHaveLength(2);
    expect(await removeDocumentLink(links[0].id)).toEqual({ ok: true });
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toMatchObject({ folderId: a.folderId });
  });

  test("a folder from another matter is refused", async () => {
    const { areaId, stageId } = await seedPracticeArea({ name: "Other" });
    const other = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
    const foreign = await seedDocumentFolder({ matterId: other.matterId, name: "Theirs" });
    const doc = await prisma.document.create({ data: { matterId, name: "x.pdf" }, select: { id: true } });
    expect(await addDocumentLink(doc.id, foreign.folderId)).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
  });
});

describe("folders, moves and attachments", () => {
  test("moving an email carries its attachments; moving an attachment is refused", async () => {
    const dest = await seedDocumentFolder({ matterId, name: "Dest" });
    const emailId = await seedEmail();
    await extractEmailAttachments(emailId, userId);
    const [report] = await attachmentsOf(emailId);
    expect(await moveDocuments([report.id], dest.folderId)).toMatchObject({ ok: false, error: expect.stringMatching(/Also file in/) });
    expect(await moveDocuments([emailId], dest.folderId)).toEqual({ ok: true });
    expect((await attachmentsOf(emailId)).every((k) => k.folderId === dest.folderId)).toBe(true);
  });

  test("deleting a folder moves its links up, dropping ones that would duplicate", async () => {
    const parent = await seedDocumentFolder({ matterId, name: "Parent" });
    const child = await seedDocumentFolder({ matterId, name: "Child", parentId: parent.folderId });
    const lives = await prisma.document.create({ data: { matterId, folderId: parent.folderId, name: "p.pdf" }, select: { id: true } });
    const other = await prisma.document.create({ data: { matterId, name: "o.pdf" }, select: { id: true } });
    await addDocumentLink(lives.id, child.folderId); // would duplicate its home once moved up
    await addDocumentLink(other.id, child.folderId);
    expect(await deleteFolder(child.folderId)).toEqual({ ok: true });
    const links = await prisma.documentLink.findMany({});
    expect(links.map((l) => [l.documentId, l.folderId])).toEqual([[other.id, parent.folderId]]);
  });
});

describe("getFolderListing", () => {
  test("nests attachments under their email and lists links with their home", async () => {
    const exhibits = await seedDocumentFolder({ matterId, name: "Exhibits" });
    const emailId = await seedEmail();
    await extractEmailAttachments(emailId, userId);
    const [report] = await attachmentsOf(emailId);
    await addDocumentLink(report.id, exhibits.folderId);

    const root = await getFolderListing(matterId, null);
    expect(root.documents.map((d) => d.name)).toEqual(["Incident email.eml"]);
    expect(root.documents[0].isEmail).toBe(true);
    expect(root.documents[0].attachments.map((a) => a.name)).toEqual(["report.pdf", "timeline.csv"]);
    expect(root.documents[0].attachments[0].alsoIn.map((f) => f.folderName)).toEqual(["Exhibits"]);

    const inExhibits = await getFolderListing(matterId, exhibits.folderId);
    expect(inExhibits.documents).toEqual([]);
    expect(inExhibits.linked.map((l) => [l.name, l.homeName])).toEqual([
      ["report.pdf", "Incident email.eml (attachment)"],
    ]);
  });
});
