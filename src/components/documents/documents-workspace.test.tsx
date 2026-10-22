/**
 * DocumentsWorkspace — the file-manager layer: shared menus, selection
 * bar, keyboard shortcuts, desktop file drop, move + undo.
 * (Pointer drag-and-drop itself is dnd-kit; its drop rule is
 * moveBlockReason, unit-tested in document-selection.test.ts.)
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Ref } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/actions/documents", () => ({
  copyDocumentToFolder: vi.fn(async () => ({ ok: true })),
  deleteDocument: vi.fn(async () => ({ ok: true })),
  updateDocumentMetadata: vi.fn(),
}));
vi.mock("@/app/actions/document-folders", () => ({
  moveDocuments: vi.fn(async () => ({ ok: true })),
  moveFolder: vi.fn(async () => ({ ok: true })),
  deleteFolder: vi.fn(async () => ({ ok: true })),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
}));
vi.mock("@/app/actions/portal-documents", () => ({
  setDocumentsClientShare: vi.fn(async () => ({ ok: true })),
  setFolderClientShared: vi.fn(async () => ({ ok: true })),
  previewFolderMoveVisibility: vi.fn(async () => ({ becomesVisible: 0, becomesHidden: 0 })),
}));
vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyUndoable: vi.fn(),
}));
const upload = vi.fn();
vi.mock("@/components/matters/documents/multi-file-upload", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    MultiFileUpload: ({ controlRef }: { controlRef: Ref<unknown> }) => {
      useImperativeHandle(controlRef, () => ({ upload }));
      return <div data-testid="multi-upload" />;
    },
  };
});

import { deleteDocument } from "@/app/actions/documents";
import { moveDocuments } from "@/app/actions/document-folders";
import { previewFolderMoveVisibility, setDocumentsClientShare } from "@/app/actions/portal-documents";
import { notifyUndoable } from "@/lib/feedback";
import type { DocTarget, FolderTarget, WorkspacePerms } from "@/lib/document-entry-actions";
import { docKey, folderKey } from "@/lib/document-selection";
import { DocumentsWorkspace, type WorkspaceFolder } from "./documents-workspace";
import type { DocRowData, FolderRowData, RowData } from "./documents-table";

const ALL: WorkspacePerms = {
  organize: true,
  edit: true,
  folderCreate: true,
  folderEdit: true,
  folderDelete: true,
  upload: true,
  share: true,
  writable: true,
};

const BASE = "/matters/m1/documents";

const docRow = (id: string, over: Partial<DocTarget> = {}): DocRowData => ({
  key: docKey(id),
  parentKey: null,
  isEmail: false,
  extras: null,
  category: "Other",
  status: { label: "Final", className: "" },
  size: "1 KB",
  uploaderInitials: "JK",
  uploaderName: "J K",
  added: "Oct 1, 2026",
  target: {
    kind: "doc",
    id,
    name: `${id}.pdf`,
    href: `${BASE}/${id}`,
    folderId: null,
    isAttachment: false,
    hasFile: true,
    canDelete: true,
    category: "filing",
    status: "final",
    clientShare: null,
    isShared: false,
    unsavedAttachments: [],
    savedAttachments: [],
    attachmentShares: [],
    ...over,
  },
});

const folderRow = (id: string, over: Partial<FolderTarget> = {}): FolderRowData => ({
  key: folderKey(id),
  count: 0,
  extras: null,
  target: {
    kind: "folder",
    id,
    name: id.toUpperCase(),
    href: `${BASE}?folder=${id}`,
    parentId: null,
    isProtected: false,
    hasProtectedDescendant: false,
    clientShared: false,
    atDepthCap: false,
    ...over,
  },
});

const FOLDERS: WorkspaceFolder[] = [
  { id: "a", parentId: null, name: "A", order: 0, clientShared: true },
  { id: "f", parentId: null, name: "F", order: 1, clientShared: false },
];

function renderWorkspace(rows: RowData[], perms: WorkspacePerms = ALL) {
  return render(
    <DocumentsWorkspace
      scope={{ kind: "matter", matterId: "m1" }}
      basePath={BASE}
      folders={FOLDERS}
      flat={[{ id: "a", parentId: null, name: "A", depth: 1 }]}
      tree={[{ id: "a", parentId: null, name: "A", children: [] }]}
      counts={{}}
      rootCount={rows.length}
      currentFolderId={null}
      rows={rows}
      perms={perms}
      storageDriver="local"
      visibilityWarnings
      empty={<div>Empty</div>}
    />
  );
}

const row = (name: string) => screen.getByRole("link", { name: new RegExp(name) }).closest("tr")!;

afterEach(() => vi.clearAllMocks());

describe("row menu", () => {
  test("Share with client from the ⋯ menu", async () => {
    renderWorkspace([docRow("d1")]);
    await userEvent.click(screen.getByRole("button", { name: "Document actions" }));
    await userEvent.click(screen.getByText("Share with client"));
    expect(setDocumentsClientShare).toHaveBeenCalledWith(["d1"], true);
  });

  test("Edit details… opens the prefilled dialog", async () => {
    renderWorkspace([docRow("d1")]);
    await userEvent.click(screen.getByRole("button", { name: "Document actions" }));
    await userEvent.click(screen.getByText("Edit details…"));
    expect(await screen.findByLabelText("Name")).toHaveValue("d1.pdf");
    expect(screen.getByLabelText("Category")).toHaveValue("filing");
  });

  test("hidden without permissions", async () => {
    renderWorkspace([docRow("d1", { canDelete: false })], { ...ALL, edit: false, share: false, organize: false });
    await userEvent.click(screen.getByRole("button", { name: "Document actions" }));
    expect(screen.queryByText("Edit details…")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.getByText("Download")).toBeInTheDocument();
  });

  test("an email's attachments move with it, so they count in the visibility warning", async () => {
    renderWorkspace([
      docRow("d1", {
        attachmentShares: [
          { clientShare: null, folderId: null, status: "active" },
          { clientShare: null, folderId: null, status: "active" },
        ],
      }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Document actions" }));
    await userEvent.click(screen.getByText("Move to…"));
    await userEvent.click(screen.getByRole("button", { name: /^A$/ }));
    expect(await screen.findByText("3 files will become visible to the client.")).toBeInTheDocument();
  });

  test("a mixed selection's move warns too, counting the folder's subtree", async () => {
    vi.mocked(previewFolderMoveVisibility).mockResolvedValueOnce({ becomesVisible: 4, becomesHidden: 0 });
    renderWorkspace([folderRow("f"), docRow("d1")]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await userEvent.click(screen.getByRole("button", { name: /Move 2 items to/ }));
    await userEvent.click(screen.getByRole("button", { name: /^A$/ }));
    expect(await screen.findByText("5 files will become visible to the client.")).toBeInTheDocument();
    expect(previewFolderMoveVisibility).toHaveBeenCalledWith("f", "a");
  });

  test("a move toasts Undo, which moves it back", async () => {
    renderWorkspace([docRow("d1")]);
    await userEvent.click(screen.getByRole("button", { name: "Document actions" }));
    await userEvent.click(screen.getByText("Move to…"));
    await userEvent.click(screen.getByRole("button", { name: /^A$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(moveDocuments).toHaveBeenCalledWith(["d1"], "a"));
    const [message, undo] = vi.mocked(notifyUndoable).mock.calls[0]!;
    expect(message).toBe('Moved "d1.pdf" to A.');
    undo();
    await waitFor(() => expect(moveDocuments).toHaveBeenLastCalledWith(["d1"], null));
  });
});

describe("right-click", () => {
  test("a row opens its actions", async () => {
    renderWorkspace([docRow("d1")]);
    const tr = row("d1.pdf");
    fireEvent.contextMenu(tr);
    expect(await screen.findByRole("menuitem", { name: /Open in new tab/ })).toBeInTheDocument();
    expect(tr).toHaveAttribute("data-selected");
  });

  test("empty space offers new folder and upload", async () => {
    renderWorkspace([]);
    fireEvent.contextMenu(screen.getByText("Empty"));
    expect(await screen.findByRole("menuitem", { name: /New folder/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Upload files/ })).toBeInTheDocument();
  });
});

describe("selection", () => {
  test("checkboxes select; the bar acts on everything selected", async () => {
    renderWorkspace([docRow("d1"), docRow("d2"), docRow("d3")]);
    const boxes = screen.getAllByRole("checkbox", { name: "Select" });
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[2]!);
    expect(screen.getByText("2 items selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Delete 2 items/ }));
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledTimes(2));
    expect(vi.mocked(deleteDocument).mock.calls.map((c) => c[0])).toEqual(["d1", "d3"]);
  });

  test("click then shift-click selects the range", async () => {
    renderWorkspace([folderRow("f"), docRow("d1"), docRow("d2")]);
    fireEvent.click(row("F").cells[2]!);
    fireEvent.click(row("d2.pdf").cells[2]!, { shiftKey: true });
    expect(screen.getByText("3 items selected")).toBeInTheDocument();
  });

  test("Delete on a focused row asks, then deletes", async () => {
    renderWorkspace([docRow("d1")]);
    row("d1.pdf").focus();
    await userEvent.keyboard("{Delete}");
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("d1", {}));
  });

  test("Backspace on a focused checkbox doesn't delete", async () => {
    renderWorkspace([docRow("d1")]);
    const box = screen.getByRole("checkbox", { name: "Select" });
    await userEvent.click(box);
    box.focus();
    await userEvent.keyboard("{Backspace}");
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  test("selected attachments are deleted before their email", async () => {
    renderWorkspace([
      docRow("email", { savedAttachments: ["att.pdf"] }),
      { ...docRow("att", { isAttachment: true }), parentKey: docKey("email") },
    ]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await userEvent.click(screen.getByRole("button", { name: /Delete 2 items/ }));
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledTimes(2));
    expect(vi.mocked(deleteDocument).mock.calls.map((c) => c[0])).toEqual(["att", "email"]);
  });

  test("a bulk delete keeps emails' unsaved attachments", async () => {
    renderWorkspace([docRow("d1", { unsavedAttachments: ["x.pdf"] }), docRow("d2")]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    await userEvent.click(screen.getByRole("button", { name: /Delete 2 items/ }));
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("d1", { attachments: "keep" }));
  });
});

describe("desktop files", () => {
  const files = [new File(["x"], "a.pdf", { type: "application/pdf" })];
  const dataTransfer = { types: ["Files"], files, dropEffect: "none" };

  test("dropped on a folder row upload into that folder", () => {
    renderWorkspace([folderRow("f"), docRow("d1")]);
    fireEvent.dragEnter(row("F"), { dataTransfer });
    expect(screen.getByText("Drop to upload into F")).toBeInTheDocument();
    fireEvent.drop(row("F"), { dataTransfer });
    expect(upload).toHaveBeenCalledWith(files, "f");
  });

  test("dropped elsewhere upload into the current folder", () => {
    renderWorkspace([docRow("d1")]);
    fireEvent.drop(row("d1.pdf"), { dataTransfer });
    expect(upload).toHaveBeenCalledWith(files, null);
  });

  test("ignored without upload permission", () => {
    renderWorkspace([docRow("d1")], { ...ALL, upload: false });
    fireEvent.drop(row("d1.pdf"), { dataTransfer });
    expect(upload).not.toHaveBeenCalled();
  });
});
