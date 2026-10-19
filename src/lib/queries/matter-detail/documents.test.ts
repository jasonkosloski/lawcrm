import { beforeEach, describe, expect, test, vi } from "vitest";

const hasPermission = vi.fn();
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: (k: string) => hasPermission(k),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn(async () => []) },
    portalIdentity: {
      findMany: vi.fn(async () => [{ id: "p1", contact: { name: "Jane Client" } }]),
    },
  },
}));

import { shapeDocumentRows } from "./documents";

const raw = {
  id: "d1",
  name: "a.pdf",
  category: "other",
  source: null,
  status: "final",
  fileSize: 1,
  contentType: null,
  fileUrl: "k",
  uploadedBy: null,
  folderId: null,
  parentDocumentId: null,
  clientShare: "shared",
  portalUploaderId: "p1",
  clientNote: "note",
  createdAt: new Date(),
} as never;

beforeEach(() => hasPermission.mockReset());

describe("shapeDocumentRows portal fields", () => {
  test("populated for portal.view holders", async () => {
    hasPermission.mockResolvedValue(true);
    const [r] = await shapeDocumentRows([raw]);
    expect(r).toMatchObject({ clientShare: "shared", portalUploaderName: "Jane Client", clientNote: "note" });
  });

  test("nulled without portal.view", async () => {
    hasPermission.mockResolvedValue(false);
    const [r] = await shapeDocumentRows([raw]);
    expect(r).toMatchObject({ clientShare: null, portalUploaderName: null, clientNote: null });
  });
});
