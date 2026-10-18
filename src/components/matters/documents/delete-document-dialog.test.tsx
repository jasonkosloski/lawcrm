/**
 * DeleteDocumentDialog — deleting an email that has attachments
 * (ADR-043): unsaved attachments are listed with a delete/keep choice
 * that's sent explicitly; saved ones are noted as staying put.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/documents", () => ({ deleteDocument: vi.fn(async () => ({ ok: true })) }));

import { deleteDocument } from "@/app/actions/documents";
import { DeleteDocumentDialog } from "./delete-document-dialog";

function renderDialog(over: Partial<React.ComponentProps<typeof DeleteDocumentDialog>> = {}) {
  const onOpenChange = vi.fn();
  render(
    <DeleteDocumentDialog
      open
      onOpenChange={onOpenChange}
      documentId="e1"
      name="Incident email.eml"
      unsavedAttachments={["timeline.csv", "photo.jpg"]}
      savedAttachments={["report.pdf"]}
      alsoInCount={0}
      {...over}
    />
  );
  return { onOpenChange };
}

describe("DeleteDocumentDialog", () => {
  test("lists unsaved attachments and says saved ones stay", () => {
    renderDialog();
    expect(screen.getByText(/These 2 attachments aren't filed anywhere else/)).toBeInTheDocument();
    expect(screen.getByText("timeline.csv")).toBeInTheDocument();
    expect(screen.getByText(/“report\.pdf” is also filed in another folder and stays there/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delete them with the email/)).toBeChecked();
  });

  test("sends the user's choice", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByLabelText(/Keep them in this folder/));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("e1", { attachments: "keep" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  test("with only saved attachments there's no choice to make", async () => {
    vi.mocked(deleteDocument).mockClear();
    renderDialog({ unsavedAttachments: [] });
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("e1", {}));
  });
});
