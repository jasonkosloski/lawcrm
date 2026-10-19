import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/documents", () => ({
  copyDocumentToFolder: vi.fn(),
  deleteDocument: vi.fn(),
}));
vi.mock("@/app/actions/document-folders", () => ({ moveDocuments: vi.fn() }));
vi.mock("@/app/actions/portal-documents", () => ({
  setDocumentsClientShare: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
}));

import { setDocumentsClientShare } from "@/app/actions/portal-documents";
import { DocumentRowActions } from "./document-row-actions";

const open = async (props: Partial<React.ComponentProps<typeof DocumentRowActions>>) => {
  render(<DocumentRowActions documentId="d1" name="Doc" canDelete {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Document actions" }));
};

beforeEach(() => vi.clearAllMocks());

describe("DocumentRowActions sharing", () => {
  test("no share item without canShare", async () => {
    await open({});
    expect(screen.queryByText("Share with client")).toBeNull();
    expect(screen.queryByText("Stop sharing")).toBeNull();
  });

  test("an unshared file offers Share with client", async () => {
    await open({ canShare: true, isShared: false });
    await userEvent.click(screen.getByText("Share with client"));
    expect(setDocumentsClientShare).toHaveBeenCalledWith(["d1"], true);
  });

  test("a shared file offers Stop sharing", async () => {
    await open({ canShare: true, isShared: true });
    await userEvent.click(screen.getByText("Stop sharing"));
    expect(setDocumentsClientShare).toHaveBeenCalledWith(["d1"], false);
  });
});
