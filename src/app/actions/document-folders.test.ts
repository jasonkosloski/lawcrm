/**
 * Integration tests for the document-folder actions (matter document
 * file system).
 *
 * Pins (1) that every action asks for its own permission key —
 * folder.create / folder.edit / folder.delete for structure,
 * `documents.organize` for both move flavors; (2) the app-enforced
 * invariants the schema deliberately can't: case-insensitive
 * sibling-name uniqueness (NULL parentIds defeat a DB unique), the
 * MAX_FOLDER_DEPTH nesting cap, same-matter scoping on every move
 * target, move-cycle refusal; (3) delete-as-re-parent: contents climb
 * to the deleted folder's parent, collisions get " (2)"-style
 * suffixes, and NO document row is ever deleted with a folder;
 * (4) exactly one activity-log summary row per operation.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createFolder,
  deleteFolder,
  moveDocuments,
  moveFolder,
  renameFolder,
} from "@/app/actions/document-folders";
import { MOVE_DOCUMENTS_BATCH_CAP } from "@/lib/folder-tree";
import {
  resetDb,
  seedDocument,
  seedDocumentFolder,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;
let otherMatterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, name: "Test Attorney" });
  userId = u.userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);

  const { areaId, stageId } = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Alvarez v. City of Aurora",
  });
  matterId = m.matterId;
  const other = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Unrelated Matter",
  });
  otherMatterId = other.matterId;
});

const activityRows = () =>
  prisma.activityLog.findMany({ where: { matterId, type: "document" } });

describe("permission gates", () => {
  test("each action asks for its own key", async () => {
    await createFolder(matterId, null, "Discovery");
    expect(requirePermission).toHaveBeenLastCalledWith(
      "documents.folder.create"
    );

    const { folderId } = await seedDocumentFolder({ matterId, name: "F" });
    await renameFolder(folderId, "G");
    expect(requirePermission).toHaveBeenLastCalledWith(
      "documents.folder.edit"
    );

    await moveFolder(folderId, null);
    expect(requirePermission).toHaveBeenLastCalledWith("documents.organize");

    const { documentId } = await seedDocument({ matterId });
    await moveDocuments([documentId], null);
    expect(requirePermission).toHaveBeenLastCalledWith("documents.organize");

    await deleteFolder(folderId);
    expect(requirePermission).toHaveBeenLastCalledWith(
      "documents.folder.delete"
    );
  });
});

describe("createFolder", () => {
  test("creates at root and under a parent, appending sibling order", async () => {
    const root = await createFolder(matterId, null, "Discovery");
    expect(root.ok).toBe(true);
    if (!root.ok) return;

    const child = await createFolder(matterId, root.folderId!, "Production 1");
    expect(child.ok).toBe(true);

    const rows = await prisma.documentFolder.findMany({
      orderBy: { name: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.parentId).toBeNull();
    expect(rows[1]!.parentId).toBe(root.folderId);
    expect(rows[1]!.matterId).toBe(matterId);

    const second = await createFolder(matterId, null, "Correspondence");
    expect(second.ok).toBe(true);
    const created = await prisma.documentFolder.findFirstOrThrow({
      where: { name: "Correspondence" },
    });
    // Sibling order appends after "Discovery" (order 0).
    expect(created.order).toBe(1);
  });

  test("refuses a case-insensitive sibling duplicate — same name ok in another branch", async () => {
    await createFolder(matterId, null, "Exhibits");
    const dup = await createFolder(matterId, null, "EXHIBITS");
    expect(dup).toEqual({
      ok: false,
      error: 'A folder named "EXHIBITS" already exists here.',
    });

    // Same name is fine under a different parent.
    const { folderId } = await seedDocumentFolder({ matterId, name: "Depo" });
    const nested = await createFolder(matterId, folderId, "Exhibits");
    expect(nested.ok).toBe(true);
  });

  test("validates the name: empty and >120 chars refused", async () => {
    expect((await createFolder(matterId, null, "   ")).ok).toBe(false);
    expect((await createFolder(matterId, null, "x".repeat(121))).ok).toBe(
      false
    );
    // Boundary: exactly 120 is fine (and trimmed).
    expect((await createFolder(matterId, null, ` ${"x".repeat(120)} `)).ok).toBe(
      true
    );
  });

  test("refuses an unknown matter and a parent from another matter", async () => {
    expect(await createFolder("nope", null, "F")).toEqual({
      ok: false,
      error: "Matter not found.",
    });

    const foreign = await seedDocumentFolder({
      matterId: otherMatterId,
      name: "Foreign",
    });
    expect(await createFolder(matterId, foreign.folderId, "F")).toEqual({
      ok: false,
      error: "Parent folder not found in this matter.",
    });
  });

  test("enforces the 8-level depth cap", async () => {
    let parentId: string | null = null;
    for (let depth = 1; depth <= 8; depth++) {
      const res = await createFolder(matterId, parentId, `Level ${depth}`);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      parentId = res.folderId!;
    }
    const ninth = await createFolder(matterId, parentId, "Level 9");
    expect(ninth).toEqual({
      ok: false,
      error: "Folders can only nest 8 levels deep.",
    });
  });

  test("writes one activity summary row", async () => {
    await createFolder(matterId, null, "Discovery");
    const rows = await activityRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Folder created");
    expect(rows[0]!.detail).toBe("Discovery");
  });
});

describe("renameFolder", () => {
  test("renames; case-only rename of itself is allowed", async () => {
    const { folderId } = await seedDocumentFolder({ matterId, name: "exhibits" });
    expect((await renameFolder(folderId, "Exhibits")).ok).toBe(true);
    const row = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: folderId },
    });
    expect(row.name).toBe("Exhibits");
  });

  test("refuses a case-insensitive sibling collision + unknown id", async () => {
    await seedDocumentFolder({ matterId, name: "Pleadings" });
    const { folderId } = await seedDocumentFolder({ matterId, name: "Motions" });
    expect(await renameFolder(folderId, "pleadings")).toEqual({
      ok: false,
      error: 'A folder named "pleadings" already exists here.',
    });
    expect((await renameFolder("nope", "X")).ok).toBe(false);
  });

  test("writes one activity row with old → new", async () => {
    const { folderId } = await seedDocumentFolder({ matterId, name: "Old" });
    await renameFolder(folderId, "New");
    const rows = await activityRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Folder renamed");
    expect(rows[0]!.detail).toBe("Old → New");
  });
});

describe("deleteFolder", () => {
  test("re-parents child folders + documents to the parent; never deletes files", async () => {
    const top = await seedDocumentFolder({ matterId, name: "Discovery" });
    const mid = await seedDocumentFolder({
      matterId,
      name: "Production 1",
      parentId: top.folderId,
    });
    const leaf = await seedDocumentFolder({
      matterId,
      name: "Exhibits",
      parentId: mid.folderId,
    });
    const doc = await seedDocument({ matterId, folderId: mid.folderId });

    const res = await deleteFolder(mid.folderId);
    expect(res.ok).toBe(true);

    // The folder is gone; its child folder + document climbed to "Discovery".
    expect(
      await prisma.documentFolder.findUnique({ where: { id: mid.folderId } })
    ).toBeNull();
    const leafRow = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: leaf.folderId },
    });
    expect(leafRow.parentId).toBe(top.folderId);
    const docRow = await prisma.document.findUniqueOrThrow({
      where: { id: doc.documentId },
    });
    expect(docRow.folderId).toBe(top.folderId);
    // No document row deleted.
    expect(await prisma.document.count()).toBe(1);
  });

  test("deleting a root folder re-parents contents to the matter root", async () => {
    const top = await seedDocumentFolder({ matterId, name: "Discovery" });
    const child = await seedDocumentFolder({
      matterId,
      name: "Production 1",
      parentId: top.folderId,
    });
    const doc = await seedDocument({ matterId, folderId: top.folderId });

    expect((await deleteFolder(top.folderId)).ok).toBe(true);
    expect(
      (
        await prisma.documentFolder.findUniqueOrThrow({
          where: { id: child.folderId },
        })
      ).parentId
    ).toBeNull();
    expect(
      (
        await prisma.document.findUniqueOrThrow({
          where: { id: doc.documentId },
        })
      ).folderId
    ).toBeNull();
  });

  test('re-parent name collisions get a " (2)"-style suffix (case-insensitive)', async () => {
    // Root already has "exhibits" AND "Exhibits (2)"; the deleted
    // folder's child "Exhibits" must land as "Exhibits (3)".
    await seedDocumentFolder({ matterId, name: "exhibits" });
    await seedDocumentFolder({ matterId, name: "Exhibits (2)" });
    const doomed = await seedDocumentFolder({ matterId, name: "Production" });
    const child = await seedDocumentFolder({
      matterId,
      name: "Exhibits",
      parentId: doomed.folderId,
    });

    expect((await deleteFolder(doomed.folderId)).ok).toBe(true);
    const row = await prisma.documentFolder.findUniqueOrThrow({
      where: { id: child.folderId },
    });
    expect(row.parentId).toBeNull();
    expect(row.name).toBe("Exhibits (3)");
  });

  test("writes one activity summary row with counts; unknown id errors", async () => {
    const top = await seedDocumentFolder({ matterId, name: "Discovery" });
    await seedDocumentFolder({
      matterId,
      name: "Sub",
      parentId: top.folderId,
    });
    await seedDocument({ matterId, folderId: top.folderId });
    await seedDocument({ matterId, folderId: top.folderId });

    await deleteFolder(top.folderId);
    const rows = await activityRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Folder deleted");
    expect(rows[0]!.detail).toContain('"Discovery"');
    expect(rows[0]!.detail).toContain("1 subfolder(s)");
    expect(rows[0]!.detail).toContain("2 document(s)");

    expect((await deleteFolder("nope")).ok).toBe(false);
  });
});

describe("moveDocuments", () => {
  test("moves a batch into a folder and back to the root; one activity row", async () => {
    const { folderId } = await seedDocumentFolder({ matterId, name: "Filed" });
    const a = await seedDocument({ matterId, name: "A.pdf" });
    const b = await seedDocument({ matterId, name: "B.pdf" });

    const res = await moveDocuments([a.documentId, b.documentId], folderId);
    expect(res.ok).toBe(true);
    const moved = await prisma.document.findMany({
      where: { folderId },
    });
    expect(moved).toHaveLength(2);

    // Back to root via null.
    expect((await moveDocuments([a.documentId], null)).ok).toBe(true);
    expect(
      (
        await prisma.document.findUniqueOrThrow({
          where: { id: a.documentId },
        })
      ).folderId
    ).toBeNull();

    const rows = await activityRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title).sort()).toEqual([
      "2 documents moved",
      "Document moved",
    ]);
  });

  test("refuses a target folder from another matter", async () => {
    const foreign = await seedDocumentFolder({
      matterId: otherMatterId,
      name: "Foreign",
    });
    const { documentId } = await seedDocument({ matterId });
    expect(await moveDocuments([documentId], foreign.folderId)).toEqual({
      ok: false,
      error: "Folder not found in this matter.",
    });
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: documentId } }))
        .folderId
    ).toBeNull();
  });

  test("refuses documents spanning two matters, unknown ids, and empty input", async () => {
    const mine = await seedDocument({ matterId });
    const theirs = await seedDocument({ matterId: otherMatterId });
    expect(
      (await moveDocuments([mine.documentId, theirs.documentId], null)).ok
    ).toBe(false);
    expect((await moveDocuments([mine.documentId, "nope"], null)).ok).toBe(
      false
    );
    expect((await moveDocuments([], null)).ok).toBe(false);
  });

  test(`caps the batch at ${MOVE_DOCUMENTS_BATCH_CAP} after deduping`, async () => {
    const tooMany = Array.from({ length: MOVE_DOCUMENTS_BATCH_CAP + 1 }, (_, i) => `id-${i}`);
    const res = await moveDocuments(tooMany, null);
    expect(res).toEqual({
      ok: false,
      error: `Too many documents (max ${MOVE_DOCUMENTS_BATCH_CAP} per move).`,
    });

    // Duplicated ids collapse below the cap instead of tripping it.
    const { documentId } = await seedDocument({ matterId });
    const dupes = Array.from(
      { length: MOVE_DOCUMENTS_BATCH_CAP + 1 },
      () => documentId
    );
    expect((await moveDocuments(dupes, null)).ok).toBe(true);
  });
});

describe("moveFolder", () => {
  test("moves under a new parent and to the root", async () => {
    const a = await seedDocumentFolder({ matterId, name: "A" });
    const b = await seedDocumentFolder({ matterId, name: "B" });

    expect((await moveFolder(b.folderId, a.folderId)).ok).toBe(true);
    expect(
      (
        await prisma.documentFolder.findUniqueOrThrow({
          where: { id: b.folderId },
        })
      ).parentId
    ).toBe(a.folderId);

    expect((await moveFolder(b.folderId, null)).ok).toBe(true);
    expect(
      (
        await prisma.documentFolder.findUniqueOrThrow({
          where: { id: b.folderId },
        })
      ).parentId
    ).toBeNull();

    const rows = await activityRows();
    expect(rows.every((r) => r.title === "Folder moved")).toBe(true);
  });

  test("refuses cycles: into itself or its own descendant", async () => {
    const top = await seedDocumentFolder({ matterId, name: "Top" });
    const sub = await seedDocumentFolder({
      matterId,
      name: "Sub",
      parentId: top.folderId,
    });
    expect((await moveFolder(top.folderId, top.folderId)).ok).toBe(false);
    expect(await moveFolder(top.folderId, sub.folderId)).toEqual({
      ok: false,
      error: "A folder can't be moved into one of its own subfolders.",
    });
  });

  test("refuses a cross-matter destination and a destination name collision", async () => {
    const foreign = await seedDocumentFolder({
      matterId: otherMatterId,
      name: "Foreign",
    });
    const mine = await seedDocumentFolder({ matterId, name: "Mine" });
    expect((await moveFolder(mine.folderId, foreign.folderId)).ok).toBe(false);

    const dest = await seedDocumentFolder({ matterId, name: "Dest" });
    await seedDocumentFolder({
      matterId,
      name: "MINE",
      parentId: dest.folderId,
    });
    expect(await moveFolder(mine.folderId, dest.folderId)).toEqual({
      ok: false,
      error: 'A folder named "Mine" already exists there.',
    });
  });

  test("refuses a move that would push the subtree past the depth cap", async () => {
    // Chain of 7 (destination depth 7) + a 2-high subtree = 9 > 8.
    let parentId: string | null = null;
    for (let depth = 1; depth <= 7; depth++) {
      const f = await seedDocumentFolder({
        matterId,
        name: `Level ${depth}`,
        parentId,
      });
      parentId = f.folderId;
    }
    const movable = await seedDocumentFolder({ matterId, name: "Movable" });
    await seedDocumentFolder({
      matterId,
      name: "Movable child",
      parentId: movable.folderId,
    });

    const res = await moveFolder(movable.folderId, parentId);
    expect(res).toEqual({
      ok: false,
      error: "That move would nest folders more than 8 levels deep.",
    });
  });

  test("no-op move (same parent) succeeds without an activity row", async () => {
    const { folderId } = await seedDocumentFolder({ matterId, name: "A" });
    expect((await moveFolder(folderId, null)).ok).toBe(true);
    expect(await activityRows()).toHaveLength(0);
  });
});
