import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/document-folders", () => ({
  deleteFolder: vi.fn(),
  moveFolder: vi.fn(),
  renameFolder: vi.fn(),
}));

import { FolderRowActions } from "./folder-row-actions";

async function open(over: { isProtected: boolean; hasProtectedDescendant: boolean }) {
  render(
    <FolderRowActions
      folderId="f1"
      name="F"
      parentId={null}
      folders={[{ id: "f1", parentId: null, name: "F", depth: 1 }]}
      canEdit
      canDelete
      canOrganize
      {...over}
    />
  );
  const trigger = screen.queryByRole("button", { name: "Folder actions" });
  if (trigger) await userEvent.click(trigger);
  return trigger;
}

describe("FolderRowActions protection", () => {
  test("an ordinary folder shows every action", async () => {
    await open({ isProtected: false, hasProtectedDescendant: false });
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Move to…")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  test("a protected folder has no rename, move or delete", async () => {
    // Every item is hidden, so the menu itself doesn't render.
    expect(await open({ isProtected: true, hasProtectedDescendant: false })).toBeNull();
    expect(screen.queryByText("Rename")).toBeNull();
    expect(screen.queryByText("Move to…")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  test("an ancestor of a protected folder can't be deleted but can be renamed", async () => {
    await open({ isProtected: false, hasProtectedDescendant: true });
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});
