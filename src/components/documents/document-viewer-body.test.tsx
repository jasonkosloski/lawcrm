/**
 * DocumentViewerBody — a document outside the scope 404s.
 */

import { describe, expect, test, vi } from "vitest";

const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  })
);
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/queries/document-viewer", () => ({
  getDocumentForViewer: vi.fn(async () => null),
  getViewerFileTree: vi.fn(),
}));
vi.mock("@/lib/queries/matter-detail", () => ({
  getDocumentFolders: vi.fn(async () => []),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => false),
}));

import { getDocumentForViewer } from "@/lib/queries/document-viewer";
import { DocumentViewerBody } from "./document-viewer-body";

describe("DocumentViewerBody", () => {
  test("a document id outside the lead -> notFound()", async () => {
    await expect(
      DocumentViewerBody({
        scope: { kind: "lead", leadId: "lead_1" },
        documentId: "other",
        searchParams: {},
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getDocumentForViewer).toHaveBeenCalledWith(
      { kind: "lead", leadId: "lead_1" },
      "other"
    );
    expect(notFoundMock).toHaveBeenCalled();
  });
});
