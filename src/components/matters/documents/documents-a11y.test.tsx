/**
 * Accessibility wiring for the document browser's small widgets:
 * tree chevrons expose expanded state, the move picker exposes the
 * chosen target, and the folder-name inputs are labelled.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/app/actions/document-folders", () => ({
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  moveFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));

import type { FolderNode } from "@/lib/folder-tree";
import { FolderTree } from "./folder-tree";
import { MoveToFolderDialog } from "./move-to-folder-dialog";
import { NewFolderButton } from "./new-folder-button";

const node = (
  id: string,
  name: string,
  children: FolderNode[] = []
): FolderNode =>
  ({ id, name, parentId: null, children }) as unknown as FolderNode;

describe("FolderTree", () => {
  test("chevrons report aria-expanded and toggle it", async () => {
    const user = userEvent.setup();
    render(
      <FolderTree
        scope={{ kind: "matter", matterId: "m1" }}
        tree={[node("a", "Discovery", [node("b", "Production 1")])]}
        counts={{}}
        rootCount={0}
        selectedId={null}
      />
    );
    const chevron = screen.getByRole("button", { name: /expand discovery/i });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    await user.click(chevron);
    expect(
      screen.getByRole("button", { name: /collapse discovery/i })
    ).toHaveAttribute("aria-expanded", "true");
  });
});

describe("MoveToFolderDialog", () => {
  test("the picked target is exposed as aria-pressed", async () => {
    const user = userEvent.setup();
    render(
      <MoveToFolderDialog
        open
        onOpenChange={() => {}}
        title="Move doc"
        description="Pick"
        folders={[
          { id: "a", name: "Discovery", parentId: null, depth: 1 },
          { id: "b", name: "Pleadings", parentId: null, depth: 1 },
        ]}
        currentFolderId={null}
        onMove={async () => ({ ok: true })}
      />
    );
    const discovery = screen.getByRole("button", { name: /discovery/i });
    expect(discovery).toHaveAttribute("aria-pressed", "false");
    await user.click(discovery);
    expect(discovery).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /pleadings/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});

describe("NewFolderButton", () => {
  test("the name input has an accessible name", async () => {
    const user = userEvent.setup();
    render(<NewFolderButton scope={{ kind: "matter", matterId: "m1" }} parentId={null} parentName={null} />);
    await user.click(screen.getByRole("button", { name: /new folder/i }));
    expect(screen.getByRole("textbox", { name: "Folder name" })).toBeVisible();
  });
});
