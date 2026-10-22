import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/documents", () => ({
  updateDocumentMetadata: vi.fn(),
}));

import { updateDocumentMetadata } from "@/app/actions/documents";
import { EditDocumentDialog } from "./edit-document-dialog";

const update = vi.mocked(updateDocumentMetadata);

function Harness({ onOpenChange = vi.fn() }: { onOpenChange?: (o: boolean) => void }) {
  return (
    <EditDocumentDialog
      open
      onOpenChange={onOpenChange}
      documentId="d1"
      name="Complaint.pdf"
      category="other"
    />
  );
}

beforeEach(() => vi.clearAllMocks());

describe("EditDocumentDialog", () => {
  test("prefills name and category; Save is disabled until something changes", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Name")).toHaveValue("Complaint.pdf");
    expect(screen.getByLabelText("Category")).toHaveValue("other");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("saves the new name and category, then closes", async () => {
    update.mockResolvedValue({ ok: true, changed: true });
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Amended.pdf");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "pleading");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledWith("d1", {
      name: "Amended.pdf",
      category: "pleading",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("a server error shows and keeps the dialog open", async () => {
    update.mockResolvedValue({ ok: false, error: "Pick a valid category." });
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Category"), "filing");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick a valid category.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  test("a blank name cannot be saved", async () => {
    render(<Harness />);
    await userEvent.clear(screen.getByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
