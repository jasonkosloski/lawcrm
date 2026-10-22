import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/portal-documents", () => ({
  createDocumentRequest: vi.fn(async () => ({ ok: true })),
  updateDocumentRequest: vi.fn(async () => ({ ok: true })),
  acceptDocumentRequest: vi.fn(async () => ({ ok: true })),
  sendBackDocumentRequest: vi.fn(async () => ({ ok: true })),
  cancelDocumentRequest: vi.fn(async () => ({ ok: true })),
  deleteDocumentRequest: vi.fn(async () => ({ ok: true })),
}));

import {
  acceptDocumentRequest,
  createDocumentRequest,
  sendBackDocumentRequest,
} from "@/app/actions/portal-documents";
import { ClientRequestsCard } from "./client-requests-card";
import type { DocumentRequestRow } from "@/lib/queries/document-requests";

const req = (over: Partial<DocumentRequestRow>): DocumentRequestRow => ({
  id: "r1",
  title: "Tax returns",
  instructions: null,
  dueDate: new Date("2026-11-05T00:00:00Z"),
  status: "open",
  returnNote: null,
  documents: [],
  ...over,
});

const renderCard = (over: Partial<React.ComponentProps<typeof ClientRequestsCard>> = {}) =>
  render(
    <ClientRequestsCard
      matterId="m1"
      requests={[req({})]}
      hasLiveAccess
      canAdd
      canEdit
      canDelete
      {...over}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe("ClientRequestsCard", () => {
  test("hides New request without portal.add_requests", () => {
    renderCard({ canAdd: false });
    expect(screen.queryByRole("button", { name: "New request" })).toBeNull();
  });

  test("shows the due date as a calendar date", () => {
    renderCard();
    expect(screen.getByText(/Nov 5, 2026/)).toBeInTheDocument();
  });

  test("Delete shows for an empty request and not when files are attached", () => {
    const { unmount } = renderCard();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    unmount();
    renderCard({
      requests: [req({ status: "submitted", documents: [{ id: "d1", name: "w2.pdf" }] })],
    });
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("link", { name: "w2.pdf" })).toHaveAttribute(
      "href",
      "/matters/m1/documents/d1",
    );
  });

  test("Accept and Send back only for submitted requests", () => {
    const { unmount } = renderCard();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send back" })).toBeNull();
    unmount();
    renderCard({ requests: [req({ status: "submitted" })] });
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument();
  });

  test("Accept calls the action", async () => {
    renderCard({ requests: [req({ status: "submitted" })] });
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(acceptDocumentRequest).toHaveBeenCalledWith("r1"));
  });

  test("Send back requires a note", async () => {
    renderCard({ requests: [req({ status: "submitted" })] });
    await userEvent.click(screen.getByRole("button", { name: "Send back" }));
    await userEvent.type(screen.getByLabelText("Note to the client"), "Missing page 2");
    await userEvent.click(screen.getByRole("button", { name: "Send to client" }));
    await waitFor(() =>
      expect(sendBackDocumentRequest).toHaveBeenCalledWith("r1", "Missing page 2"),
    );
  });

  test("hides every mutating control without edit/delete permission", () => {
    renderCard({
      canAdd: false,
      canEdit: false,
      canDelete: false,
      requests: [req({ status: "submitted" })],
    });
    for (const n of ["Accept", "Send back", "Edit", "Cancel request", "Delete"]) {
      expect(screen.queryByRole("button", { name: n })).toBeNull();
    }
  });

  test("shows the no-access hint", () => {
    renderCard({ hasLiveAccess: false });
    expect(screen.getByText("No one has portal access on this matter yet.")).toBeInTheDocument();
  });

  test("creates a request", async () => {
    renderCard({ requests: [] });
    await userEvent.click(screen.getByRole("button", { name: "New request" }));
    await userEvent.type(screen.getByLabelText("Title"), "Bank statements");
    await userEvent.click(screen.getByRole("button", { name: "Request documents" }));
    await waitFor(() =>
      expect(createDocumentRequest).toHaveBeenCalledWith("m1", {
        title: "Bank statements",
        instructions: "",
        dueDate: "",
      }),
    );
  });
});
