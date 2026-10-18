/**
 * DocumentsBrowser — scope plumbing and write-control gating.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/prisma", () => ({
  prisma: { documentTemplate: { findMany: vi.fn(async () => []) } },
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/file-storage", () => ({ activeStorageDriver: () => "local" }));
vi.mock("@/lib/queries/matter-detail", () => ({
  getDocumentFolders: vi.fn(async () => []),
  getFolderDocumentCounts: vi.fn(async () => ({ counts: {}, rootCount: 0 })),
}));
vi.mock("@/lib/queries/document-listing", () => ({
  getFolderListing: vi.fn(async () => ({ documents: [] })),
}));
vi.mock("@/components/matters/documents/folder-tree", () => ({
  FolderTree: ({ scope }: { scope: unknown }) => (
    <div data-testid="tree" data-scope={JSON.stringify(scope)} />
  ),
}));
vi.mock("@/components/matters/documents/multi-file-upload", () => ({
  MultiFileUpload: () => <div data-testid="multi-upload" />,
}));
vi.mock("@/components/matters/documents/upload-document-form", () => ({
  UploadDocumentForm: () => <div data-testid="upload-form" />,
}));
vi.mock("@/components/matters/documents/new-folder-button", () => ({
  NewFolderButton: () => <div data-testid="new-folder" />,
}));
vi.mock("@/components/templates/generate-from-template-dialog", () => ({
  GenerateFromTemplateDialog: () => <div data-testid="generate" />,
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { getFolderListing } from "@/lib/queries/document-listing";
import { DocumentsBrowser } from "./documents-browser";

const grant = (keys: string[]) =>
  vi
    .mocked(currentUserHasPermission)
    .mockImplementation(async (k: string) => keys.includes(k));

const LEAD = { kind: "lead", leadId: "lead_1" } as const;
const ALL = ["documents.upload", "documents.folder.create"];

const renderBrowser = async (writable?: boolean) =>
  render(
    await DocumentsBrowser({ scope: LEAD, folderParam: null, writable })
  );

afterEach(() => vi.clearAllMocks());

describe("DocumentsBrowser", () => {
  test("passes the lead scope to the queries and tree", async () => {
    grant(ALL);
    await renderBrowser();
    expect(getFolderListing).toHaveBeenCalledWith(LEAD, null);
    expect(JSON.parse(screen.getByTestId("tree").getAttribute("data-scope")!)).toEqual(LEAD);
  });

  test("documents.upload + folder.create show the write controls", async () => {
    grant(ALL);
    await renderBrowser();
    expect(screen.getByTestId("multi-upload")).toBeInTheDocument();
    expect(screen.getByTestId("upload-form")).toBeInTheDocument();
    expect(screen.getByTestId("new-folder")).toBeInTheDocument();
  });

  test("without documents.upload the uploaders are hidden", async () => {
    grant(["documents.folder.create"]);
    await renderBrowser();
    expect(screen.queryByTestId("multi-upload")).toBeNull();
    expect(screen.queryByTestId("upload-form")).toBeNull();
  });

  test("writable=false hides upload, new-folder and generate even with every permission", async () => {
    grant(ALL);
    await renderBrowser(false);
    for (const id of ["multi-upload", "upload-form", "new-folder", "generate"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });
});
