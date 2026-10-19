import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoveToFolderDialog } from "./move-to-folder-dialog";

const folders = [
  { id: "a", parentId: null, name: "A", depth: 1 },
  { id: "b", parentId: null, name: "B", depth: 1 },
];

const renderDialog = (warningFor?: (t: string | null) => string | null) =>
  render(
    <MoveToFolderDialog
      open
      onOpenChange={() => {}}
      title="Move"
      description="d"
      folders={folders}
      currentFolderId={null}
      warningFor={warningFor}
      onMove={vi.fn(async () => ({ ok: true }))}
    />
  );

describe("MoveToFolderDialog warning", () => {
  test("shows the warning once a target with a non-null warning is picked", async () => {
    renderDialog((t) => (t === "a" ? "This file will become visible to the client." : null));
    expect(screen.queryByText(/visible to the client/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^A$/ }));
    expect(screen.getByText("This file will become visible to the client.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^B$/ }));
    expect(screen.queryByText(/visible to the client/)).toBeNull();
    expect(screen.getByRole("button", { name: "Move" })).toBeEnabled();
  });
});
