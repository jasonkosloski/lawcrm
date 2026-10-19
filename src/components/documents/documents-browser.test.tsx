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
vi.mock("@/app/actions/portal-documents", () => ({
  setDocumentsClientShare: vi.fn(),
  setFolderClientShared: vi.fn(),
}));
vi.mock("@/lib/queries/document-requests", () => ({
  matterHasLivePortalAccess: vi.fn(async () => true),
}));
vi.mock("@/lib/file-storage", () => ({ activeStorageDriver: () => "local" }));
vi.mock("@/lib/queries/matter-detail", () => ({
  getDocumentFolders: vi.fn(async (): Promise<unknown[]> => []),
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
import { getDocumentFolders } from "@/lib/queries/matter-detail";
import { getFolderListing } from "@/lib/queries/document-listing";
import { matterHasLivePortalAccess } from "@/lib/queries/document-requests";
import userEvent from "@testing-library/user-event";
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

  test("a generated folder's row carries the source badge", async () => {
    grant(ALL);
    vi.mocked(getDocumentFolders).mockResolvedValueOnce([
      { id: "g1", parentId: null, name: "Dr. Smith", order: 0, systemKind: "records_request", clientShared: false, recordsRequestId: "r1", sourceTitle: "Dr. Smith — Medical" },
      { id: "o1", parentId: null, name: "Plain", order: 1, systemKind: null, clientShared: false, recordsRequestId: null, sourceTitle: null },
    ]);
    await renderBrowser();
    const badges = screen.getAllByRole("link", { name: /Records request/ });
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute("href", "/intake/lead_1/records/r1");
  });

  describe("client sharing", () => {
    const MATTER = { kind: "matter", matterId: "m1" } as const;
    const folder = (over: Record<string, unknown>) => ({
      id: "f1", parentId: null, name: "Medical", order: 0, systemKind: null,
      clientShared: false, recordsRequestId: null, sourceTitle: null, ...over,
    });
    const doc = (over: Record<string, unknown>) => ({
      id: "d1", name: "scan.pdf", category: "other", source: null, status: "final",
      fileSize: 10, contentType: "application/pdf", hasFile: true, uploadedBy: "user_1",
      uploaderInitials: "JK", uploaderName: "Jason", folderId: null, parentDocumentId: null,
      clientShare: null, portalUploaderName: null, clientNote: null,
      createdAt: new Date("2026-10-01T00:00:00Z"), isEmail: false, attachmentsPending: false,
      attachments: [], ...over,
    });
    const renderMatter = async () =>
      render(await DocumentsBrowser({ scope: MATTER, folderParam: null }));
    const listing = (docs: unknown[]) =>
      vi.mocked(getFolderListing).mockResolvedValueOnce({ documents: docs } as never);

    test("a shared folder row shows Shared; its subfolder says via folder", async () => {
      grant(["portal.share_documents"]);
      vi.mocked(getDocumentFolders).mockResolvedValueOnce([
        folder({ clientShared: true }),
        folder({ id: "f2", name: "Inner", parentId: "f1" }),
      ] as never);
      await renderMatter();
      expect(screen.getByTitle("Shared with client")).toBeInTheDocument();
      expect(screen.queryByTitle("Shared via folder Medical")).toBeNull(); // f2 isn't at root level
    });

    test("a per-file share and a hidden override", async () => {
      grant(["portal.view"]);
      vi.mocked(getDocumentFolders).mockResolvedValueOnce([folder({ clientShared: true })] as never);
      listing([
        doc({ id: "d1", name: "a.pdf", clientShare: "shared" }),
        doc({ id: "d2", name: "b.pdf", clientShare: "hidden", folderId: "f1" }),
      ]);
      await renderMatter();
      const badges = screen.getAllByText("Shared");
      // folder row + a.pdf; b.pdf is hidden
      expect(badges).toHaveLength(2);
    });

    test("no badges without a portal permission", async () => {
      grant([]);
      listing([doc({ clientShare: "shared" })]);
      await renderMatter();
      expect(screen.queryByText("Shared")).toBeNull();
    });

    test("a client upload shows From <name> and the note", async () => {
      grant(["portal.view"]);
      listing([doc({ portalUploaderName: "Jane Client", clientNote: "Page 2 is blurry" })]);
      await renderMatter();
      expect(screen.getByText(/From Jane Client/)).toBeInTheDocument();
      expect(screen.getByText(/Page 2 is blurry/)).toBeInTheDocument();
    });

    test("matter docs get the share item with portal.share_documents", async () => {
      grant(["portal.share_documents"]);
      listing([doc({})]);
      await renderMatter();
      await userEvent.click(screen.getByRole("button", { name: "Document actions" }));
      expect(screen.getByText("Share with client")).toBeInTheDocument();
    });

    test("lead documents never get share items", async () => {
      grant(["portal.share_documents", "portal.view"]);
      listing([doc({ clientShare: "shared" })]);
      render(await DocumentsBrowser({ scope: LEAD, folderParam: null }));
      expect(screen.queryByText("Shared")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Document actions" }));
      expect(screen.queryByText("Share with client")).toBeNull();
      expect(screen.queryByText("Stop sharing")).toBeNull();
      expect(matterHasLivePortalAccess).not.toHaveBeenCalled();
    });

    test("hint appears when nobody has live access", async () => {
      grant(["portal.share_documents"]);
      vi.mocked(matterHasLivePortalAccess).mockResolvedValueOnce(false);
      await renderMatter();
      expect(screen.getByText("No one has portal access on this matter yet.")).toBeInTheDocument();
    });
  });
});
