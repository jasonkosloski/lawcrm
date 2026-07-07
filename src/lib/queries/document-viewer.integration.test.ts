/**
 * Integration tests for the document-viewer loader against the real
 * test DB. This is the page's behavior contract:
 *  - a documentId under the wrong matter URL → null (page 404s)
 *  - prev/next walk the SAME folder, ordered by name (id tiebreak)
 *  - folderId/folderName come back for the breadcrumb's ?folder= link
 *  - uploader display fields resolve from the bare uploadedBy id
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { getDocumentForViewer } from "./document-viewer";

let matterId: string;
let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  const u = await seedUser({ firmId: f.firmId, name: "Ann Attorney", initials: "AA" });
  userId = u.userId;
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

async function seedDoc(opts: {
  matterId?: string;
  name: string;
  folderId?: string | null;
  uploadedBy?: string | null;
  contentType?: string | null;
}): Promise<string> {
  const doc = await prisma.document.create({
    data: {
      matterId: opts.matterId ?? matterId,
      name: opts.name,
      folderId: opts.folderId ?? null,
      uploadedBy: opts.uploadedBy ?? null,
      contentType: opts.contentType ?? "application/pdf",
      fileUrl: `key-${opts.name}`,
      fileSize: 100,
    },
    select: { id: true },
  });
  return doc.id;
}

describe("getDocumentForViewer — matter scoping", () => {
  test("document under its own matter resolves", async () => {
    const docId = await seedDoc({ name: "complaint.pdf", uploadedBy: userId });
    const result = await getDocumentForViewer(matterId, docId);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("complaint.pdf");
    expect(result!.uploadedByName).toBe("Ann Attorney");
    expect(result!.uploadedByInitials).toBe("AA");
  });

  test("valid documentId under a DIFFERENT matter → null (page 404s)", async () => {
    const area = await seedPracticeArea({ name: "Other Area" });
    const other = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Other Matter",
    });
    const docId = await seedDoc({ name: "secret.pdf" });
    // Real doc, wrong matter in the URL — must not leak.
    expect(await getDocumentForViewer(other.matterId, docId)).toBeNull();
  });

  test("unknown documentId → null", async () => {
    expect(await getDocumentForViewer(matterId, "does-not-exist")).toBeNull();
  });
});

describe("getDocumentForViewer — prev/next within the folder", () => {
  test("neighbors are ordered by name and scoped to the same folder", async () => {
    const folder = await prisma.documentFolder.create({
      data: { matterId, name: "Production Vol. 1" },
      select: { id: true },
    });
    // Seed out of alphabetical order on purpose.
    const c = await seedDoc({ name: "c-video.mp4", folderId: folder.id });
    const a = await seedDoc({ name: "a-report.pdf", folderId: folder.id });
    const b = await seedDoc({ name: "b-photo.jpg", folderId: folder.id });
    // Same matter, different location — must NOT appear in the walk.
    await seedDoc({ name: "aa-root-doc.pdf", folderId: null });

    const first = await getDocumentForViewer(matterId, a);
    expect(first!.prevId).toBeNull();
    expect(first!.nextId).toBe(b);

    const middle = await getDocumentForViewer(matterId, b);
    expect(middle!.prevId).toBe(a);
    expect(middle!.nextId).toBe(c);

    const last = await getDocumentForViewer(matterId, c);
    expect(last!.prevId).toBe(b);
    expect(last!.nextId).toBeNull();
  });

  test("root documents (folderId null) walk the matter root only", async () => {
    const folder = await prisma.documentFolder.create({
      data: { matterId, name: "Folder" },
      select: { id: true },
    });
    await seedDoc({ name: "inside-folder.pdf", folderId: folder.id });
    const r1 = await seedDoc({ name: "root-1.pdf", folderId: null });
    const r2 = await seedDoc({ name: "root-2.pdf", folderId: null });

    const result = await getDocumentForViewer(matterId, r1);
    expect(result!.prevId).toBeNull();
    expect(result!.nextId).toBe(r2);
  });

  test("folder fields come back for the breadcrumb ?folder= link", async () => {
    const folder = await prisma.documentFolder.create({
      data: { matterId, name: "Bodycam" },
      select: { id: true },
    });
    const docId = await seedDoc({ name: "cam1.mp4", folderId: folder.id });
    const result = await getDocumentForViewer(matterId, docId);
    expect(result!.folderId).toBe(folder.id);
    expect(result!.folderName).toBe("Bodycam");

    const rootDoc = await seedDoc({ name: "root.pdf", folderId: null });
    const rootResult = await getDocumentForViewer(matterId, rootDoc);
    expect(rootResult!.folderId).toBeNull();
    expect(rootResult!.folderName).toBeNull();
  });
});
