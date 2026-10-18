/**
 * Integration tests for `deleteDocument`.
 *
 * Pins: the uploader-or-`documents.delete_any` rule, the
 * flagged-moment guard (other reviewers' flags need
 * `evidence.flag.delete_any`), audit-before-storage ordering (a
 * storage failure still leaves the audit row), and the shared-file
 * rule (bytes are only unlinked when no other row points at them).
 *
 * Storage is mocked — `deleteFile` talks to disk / Vercel Blob in
 * production and these tests care about the rows and the call.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/file-storage", () => ({
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { deleteFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import { deleteDocument } from "@/app/actions/documents";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedFlaggedMoment,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let uploaderId: string;
let otherId: string;
let matterId: string;

/** Grant exactly these permission keys to the "current user". */
function grant(...keys: string[]) {
  vi.mocked(currentUserHasPermission).mockImplementation(async (key) =>
    keys.includes(key as string)
  );
}

async function seedFiledDocument(fileUrl: string | null = "k__a.pdf") {
  const { documentId } = await seedDocument({
    matterId,
    uploadedBy: uploaderId,
  });
  await prisma.document.update({
    where: { id: documentId },
    data: { fileUrl },
  });
  return documentId;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(deleteFile).mockReset();
  vi.mocked(deleteFile).mockResolvedValue(undefined);
  const { firmId } = await seedFirm();
  uploaderId = (await seedUser({ firmId })).userId;
  otherId = (await seedUser({ firmId })).userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(uploaderId);
  grant();
  const { areaId, stageId } = await seedPracticeArea();
  matterId = (
    await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: uploaderId,
    })
  ).matterId;
});

describe("deleteDocument authorization", () => {
  test("the uploader can delete their own document", async () => {
    const id = await seedFiledDocument();
    const res = await deleteDocument(id);
    expect(res).toEqual({ ok: true });
    expect(await prisma.document.count({ where: { id } })).toBe(0);
    expect(deleteFile).toHaveBeenCalledWith("k__a.pdf");
  });

  test("another user without documents.delete_any is refused and nothing changes", async () => {
    const id = await seedFiledDocument();
    vi.mocked(getCurrentUserId).mockResolvedValue(otherId);
    const res = await deleteDocument(id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/uploader/i);
    expect(await prisma.document.count({ where: { id } })).toBe(1);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await prisma.activityLog.count({ where: { type: "document" } })).toBe(
      0
    );
  });

  test("another user WITH documents.delete_any can delete", async () => {
    const id = await seedFiledDocument();
    vi.mocked(getCurrentUserId).mockResolvedValue(otherId);
    grant("documents.delete_any");
    const res = await deleteDocument(id);
    expect(res).toEqual({ ok: true });
    expect(await prisma.document.count({ where: { id } })).toBe(0);
  });

  test("a missing document is a clean error", async () => {
    const res = await deleteDocument("nope");
    expect(res).toEqual({ ok: false, error: "Document not found." });
    expect(deleteFile).not.toHaveBeenCalled();
  });
});

describe("deleteDocument audit + storage ordering", () => {
  test("writes the audit row and revalidates", async () => {
    const id = await seedFiledDocument();
    await deleteDocument(id);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { type: "document" },
    });
    expect(log.title).toBe("Document deleted");
    expect(log.matterId).toBe(matterId);
    // Layout-level: the Documents tab AND every viewer page under it
    // (each shows the matter's file tree).
    expect(revalidatePath).toHaveBeenCalledWith(
      `/matters/${matterId}/documents`,
      "layout"
    );
  });

  test("a storage failure still returns ok and still writes the audit row", async () => {
    const id = await seedFiledDocument();
    vi.mocked(deleteFile).mockRejectedValue(new Error("blob unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await deleteDocument(id);
    errSpy.mockRestore();

    expect(res).toEqual({ ok: true });
    expect(await prisma.document.count({ where: { id } })).toBe(0);
    expect(
      await prisma.activityLog.count({
        where: { title: "Document deleted", matterId },
      })
    ).toBe(1);
    expect(revalidatePath).toHaveBeenCalled();
  });

  test("a document with no stored file never touches storage", async () => {
    const id = await seedFiledDocument(null);
    await deleteDocument(id);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test("the file is kept while another row still references it", async () => {
    const id = await seedFiledDocument("k__shared.pdf");
    const twin = await seedFiledDocument("k__shared.pdf");
    await deleteDocument(id);
    expect(deleteFile).not.toHaveBeenCalled();
    // ...and unlinked once the last referencing row goes.
    await deleteDocument(twin);
    expect(deleteFile).toHaveBeenCalledWith("k__shared.pdf");
  });
});

describe("deleteDocument flagged moments", () => {
  test("own flags only: deletes, and the audit detail counts them", async () => {
    const id = await seedFiledDocument();
    await seedFlaggedMoment({ documentId: id, flaggedById: uploaderId });
    const res = await deleteDocument(id);
    expect(res).toEqual({ ok: true });
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Document deleted" },
    });
    expect(log.detail).toMatch(/1 flagged moment removed/);
  });

  test("another reviewer's flags block the delete without evidence.flag.delete_any", async () => {
    const id = await seedFiledDocument();
    await seedFlaggedMoment({ documentId: id, flaggedById: otherId });
    await seedFlaggedMoment({ documentId: id, flaggedById: otherId });
    const res = await deleteDocument(id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/2 flagged moments/);
    expect(await prisma.document.count({ where: { id } })).toBe(1);
    expect(await prisma.flaggedMoment.count({ where: { documentId: id } })).toBe(
      2
    );
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test("evidence.flag.delete_any lets the delete through and records the count", async () => {
    const id = await seedFiledDocument();
    await seedFlaggedMoment({ documentId: id, flaggedById: otherId });
    grant("evidence.flag.delete_any");
    const res = await deleteDocument(id);
    expect(res).toEqual({ ok: true });
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Document deleted" },
    });
    expect(log.detail).toMatch(/1 flagged moment removed/);
  });
});
