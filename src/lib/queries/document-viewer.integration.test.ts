/**
 * Integration tests for the document-viewer loader against the real
 * test DB. This is the page's behavior contract:
 *  - a documentId under the wrong matter URL → null (page 404s)
 *  - prev/next walk the SAME folder, ordered by name (id tiebreak)
 *  - folderId/folderName come back for the breadcrumb's ?folder= link
 *  - uploader display fields resolve from the bare uploadedBy id
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { FILE_TREE_MAX_DOCUMENTS, getDocumentForViewer, getViewerFileTree } from "./document-viewer";

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

  test("duplicate names are walked in id order (tiebreak)", async () => {
    const ids = [
      await seedDoc({ name: "scan.pdf" }),
      await seedDoc({ name: "scan.pdf" }),
      await seedDoc({ name: "scan.pdf" }),
    ].sort();
    const mid = await getDocumentForViewer(matterId, ids[1]);
    expect(mid!.prevId).toBe(ids[0]);
    expect(mid!.nextId).toBe(ids[2]);
    expect((await getDocumentForViewer(matterId, ids[0]))!.prevId).toBeNull();
    expect((await getDocumentForViewer(matterId, ids[2]))!.nextId).toBeNull();
  });

  test("the keyset walk agrees with the database ORDER BY for mixed-case and punctuated names (F848/F1008)", async () => {
    for (const name of ["B.pdf", "a.pdf", "Ab.pdf", "a-1.pdf", "a_1.pdf", "Z.pdf", "10.pdf", "2.pdf"]) {
      await seedDoc({ name });
    }
    const ordered = await prisma.document.findMany({
      where: { matterId, folderId: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    for (let i = 0; i < ordered.length; i++) {
      const v = await getDocumentForViewer(matterId, ordered[i].id);
      expect(v!.prevId).toBe(i > 0 ? ordered[i - 1].id : null);
      expect(v!.nextId).toBe(i < ordered.length - 1 ? ordered[i + 1].id : null);
    }
  });

  test("neighbors come from bounded queries, not a full sibling list", async () => {
    const a = await seedDoc({ name: "a.pdf" });
    await seedDoc({ name: "b.pdf" });
    const spy = vi.spyOn(prisma.document, "findMany");
    await getDocumentForViewer(matterId, a);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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

describe("getViewerFileTree — the viewer's left-hand file list", () => {
  test("this matter's files only, by name, lightweight columns", async () => {
    const folder = await prisma.documentFolder.create({ data: { matterId, name: "Discovery" }, select: { id: true } });
    await seedDoc({ name: "b-report.pdf", folderId: folder.id });
    await seedDoc({ name: "a-retainer.pdf" });
    const area = await seedPracticeArea({ name: "Elsewhere" });
    const other = await seedMatter({ practiceAreaId: area.areaId, stageId: area.stageId, leadUserId: userId });
    await seedDoc({ matterId: other.matterId, name: "other-matter.pdf" });

    const { documents, complete } = await getViewerFileTree(matterId, null);
    expect(complete).toBe(true);
    expect(documents.map((d) => d.name)).toEqual(["a-retainer.pdf", "b-report.pdf"]);
    expect(Object.keys(documents[0]).sort()).toEqual(["contentType", "folderId", "id", "name"]);
    expect(documents[1].folderId).toBe(folder.id);
  });

  test("over the cap → only the current folder, flagged incomplete", async () => {
    const folder = await prisma.documentFolder.create({ data: { matterId, name: "Production" }, select: { id: true } });
    await prisma.document.createMany({
      data: Array.from({ length: FILE_TREE_MAX_DOCUMENTS + 1 }, (_, i) => ({
        matterId,
        name: `bates-${String(i).padStart(5, "0")}.pdf`,
        folderId: folder.id,
      })),
    });
    await seedDoc({ name: "root-note.pdf" });

    const inRoot = await getViewerFileTree(matterId, null);
    expect(inRoot.complete).toBe(false);
    expect(inRoot.documents.map((d) => d.name)).toEqual(["root-note.pdf"]);

    const inProduction = await getViewerFileTree(matterId, folder.id);
    expect(inProduction.complete).toBe(false);
    expect(inProduction.documents).toHaveLength(FILE_TREE_MAX_DOCUMENTS + 1);
  });
});
