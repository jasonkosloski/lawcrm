/**
 * Integration tests for the document upload action.
 *
 * Focus: the RBAC gate. `uploadDocument` must ask for
 * `documents.upload` before touching anything (the gate mechanics
 * themselves are covered by the permission-check tests — here we
 * pin that the action asks for the right key). The happy path
 * asserts the Document row + activity entry alongside the gate so
 * a passing gate check can't hide a short-circuited no-op.
 *
 * Storage is mocked — `storeFile` writes to disk in production and
 * these tests only care about the row the action persists.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/file-storage", () => ({
  storeFile: vi.fn().mockResolvedValue({
    key: "uploads/test-key.pdf",
    contentType: "application/pdf",
    size: 12,
  }),
  deleteFile: vi.fn(),
}));

import { requirePermission } from "@/lib/permission-check";
import { storeFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import { uploadDocument } from "@/app/actions/documents";
import { documentInitialState } from "@/lib/document-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
  const { areaId, stageId } = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

const buildUploadForm = () => {
  const fd = new FormData();
  fd.set(
    "file",
    new File(["hello, world"], "exhibit-a.pdf", {
      type: "application/pdf",
    })
  );
  fd.set("name", "Exhibit A");
  fd.set("category", "other");
  return fd;
};

describe("permission gate", () => {
  test("asks for documents.upload before touching the matter", async () => {
    // Unknown matter — the gate must still fire first (gate-then-
    // lookup ordering keeps 'not found' from leaking to the ungated).
    await uploadDocument("nope", documentInitialState, buildUploadForm());
    expect(requirePermission).toHaveBeenCalledWith("documents.upload");
  });
});

describe("upload", () => {
  test("stores the file and persists the row for the gated user", async () => {
    const res = await uploadDocument(
      matterId,
      documentInitialState,
      buildUploadForm()
    );
    expect(res.status).toBe("ok");
    expect(storeFile).toHaveBeenCalledOnce();

    const doc = await prisma.document.findFirstOrThrow({
      where: { matterId },
    });
    // uploadedBy comes from requirePermission's return — the gate
    // and the attribution are the same call.
    expect(doc.uploadedBy).toBe(userId);
    expect(doc.name).toBe("Exhibit A");
    expect(doc.fileUrl).toBe("uploads/test-key.pdf");

    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { type: "document" },
    });
    expect(activity.matterId).toBe(matterId);
    expect(activity.title).toBe("Document uploaded");
  });

  test("unknown matter errors without creating anything", async () => {
    const res = await uploadDocument(
      "nope",
      documentInitialState,
      buildUploadForm()
    );
    expect(res).toEqual({ status: "error", error: "Matter not found." });
    expect(storeFile).not.toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
  });
});
