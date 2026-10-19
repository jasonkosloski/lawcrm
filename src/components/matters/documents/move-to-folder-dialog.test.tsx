import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

  test("warningLoader: loads on pick, shows only when non-null", async () => {
    const loader = vi.fn(async (t: string | null) =>
      t === "a" ? "2 files will become visible to the client." : null
    );
    render(
      <MoveToFolderDialog
        open
        onOpenChange={() => {}}
        title="Move"
        description="d"
        folders={folders}
        currentFolderId={null}
        warningLoader={loader}
        onMove={vi.fn(async () => ({ ok: true }))}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /^A$/ }));
    expect(await screen.findByText("2 files will become visible to the client.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^B$/ }));
    await waitFor(() => expect(loader).toHaveBeenCalledWith("b"));
    expect(screen.queryByText(/visible to the client/)).toBeNull();
    expect(screen.getByRole("button", { name: "Move" })).toBeEnabled();
  });

  test("a failing preview never blocks the move", async () => {
    render(
      <MoveToFolderDialog
        open
        onOpenChange={() => {}}
        title="Move"
        description="d"
        folders={folders}
        currentFolderId={null}
        warningLoader={async () => {
          throw new Error("x");
        }}
        onMove={vi.fn(async () => ({ ok: true }))}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /^A$/ }));
    expect(screen.getByRole("button", { name: "Move" })).toBeEnabled();
  });
});
