/**
 * Tests for AttachmentChips (the email thread reader's attachment
 * row).
 *
 * Pins the chip states:
 *   - Download link always present, pointed at the byte route with
 *     a `download` attribute (save-as even for inline-safe types).
 *   - "View" only for inline-allowlisted types — offering it for
 *     text/html etc. would lie (the route forces attachment).
 *   - "File to matter…" gated on the `documents.upload` read-side
 *     flag (`canFile`).
 *   - The filing dialog defaults its matter to the thread's filing
 *     (observable via the folder fetch firing for that matter) and
 *     submits (attachmentId, matterId, folderId).
 *   - `alreadyFiled` responses surface the friendly no-op notice
 *     instead of closing as if a duplicate were created.
 *
 * Server-action module + dialog primitives are mocked — the actions
 * pull in prisma (not loadable in happy-dom), and the Base UI
 * dialog's portal machinery isn't what's under test.
 */

import { describe, expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AttachmentChips } from "./attachment-chips";
import type { FilingMatterOption } from "@/lib/queries/communication";

vi.mock("@/app/actions/email-attachments", () => ({
  fileAttachmentToMatter: vi.fn(),
  listMatterFolders: vi.fn(),
}));

// Pass-through dialog: children render only while `open` — enough
// to assert open/close + content without Base UI's portal stack.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

import {
  fileAttachmentToMatter,
  listMatterFolders,
} from "@/app/actions/email-attachments";

const mockedFile = vi.mocked(fileAttachmentToMatter);
const mockedFolders = vi.mocked(listMatterFolders);

const attachments = [
  {
    id: "a-pdf",
    filename: "brief.pdf",
    contentType: "application/pdf",
    fileSize: 2048,
  },
  {
    id: "a-doc",
    filename: "contract.docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileSize: 512,
  },
];

const matterOptions: FilingMatterOption[] = [
  { id: "m1", name: "Smith v. Jones", color: "#123456", area: "PI", isPinned: true },
  { id: "m2", name: "Estate of Doe", color: "#654321", area: "Probate", isPinned: false },
];

const defaultMatter = { id: "m1", name: "Smith v. Jones" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedFolders.mockResolvedValue([]);
});

function renderChips(opts?: { canFile?: boolean }) {
  return render(
    <AttachmentChips
      attachments={attachments}
      canFile={opts?.canFile ?? true}
      defaultMatter={defaultMatter}
      matterOptions={matterOptions}
    />
  );
}

describe("chip row", () => {
  test("renders a chip per attachment with name + formatted size", () => {
    renderChips();
    expect(screen.getByText("brief.pdf")).toBeDefined();
    expect(screen.getByText("2.0 KB")).toBeDefined();
    expect(screen.getByText("contract.docx")).toBeDefined();
    expect(screen.getByText("512 B")).toBeDefined();
  });

  test("renders nothing for an attachment-less message", () => {
    const { container } = render(
      <AttachmentChips
        attachments={[]}
        canFile
        defaultMatter={null}
        matterOptions={matterOptions}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  test("download links hit the byte route with a download attribute", () => {
    renderChips();
    const link = screen.getByLabelText("Download brief.pdf");
    expect(link.getAttribute("href")).toBe(
      "/api/email-attachments/a-pdf/download"
    );
    expect(link.getAttribute("download")).toBe("brief.pdf");
  });

  test("View is offered only for inline-safe types", () => {
    renderChips();
    // pdf is on the shared allowlist → viewable in a new tab.
    const view = screen.getByLabelText("View brief.pdf");
    expect(view.getAttribute("target")).toBe("_blank");
    expect(view.getAttribute("href")).toBe(
      "/api/email-attachments/a-pdf/download"
    );
    // docx would be served `attachment` — no View affordance.
    expect(screen.queryByLabelText("View contract.docx")).toBeNull();
  });

  test("file-to-matter affordance is hidden without documents.upload", () => {
    renderChips({ canFile: false });
    expect(
      screen.queryByLabelText("File brief.pdf to matter")
    ).toBeNull();
  });
});

describe("filing dialog", () => {
  test("opens defaulted to the thread's matter (folder fetch fires for it)", async () => {
    renderChips();
    fireEvent.click(screen.getByLabelText("File brief.pdf to matter"));
    expect(screen.getByTestId("dialog")).toBeDefined();
    expect(screen.getByText(/File attachment to matter/)).toBeDefined();
    await waitFor(() => expect(mockedFolders).toHaveBeenCalledWith("m1"));
  });

  test("submits (attachmentId, matterId, folderId) and closes on success", async () => {
    mockedFile.mockResolvedValue({ ok: true });
    renderChips();
    fireEvent.click(screen.getByLabelText("File brief.pdf to matter"));
    // Re-pick the other matter, then submit.
    fireEvent.click(screen.getByText("Estate of Doe"));
    await waitFor(() => expect(mockedFolders).toHaveBeenCalledWith("m2"));
    fireEvent.click(screen.getByText("File to matter"));
    await waitFor(() =>
      expect(mockedFile).toHaveBeenCalledWith("a-pdf", "m2", null)
    );
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeNull());
  });

  test("alreadyFiled → friendly no-op notice, dialog stays open", async () => {
    mockedFile.mockResolvedValue({ ok: true, alreadyFiled: true });
    renderChips();
    fireEvent.click(screen.getByLabelText("File brief.pdf to matter"));
    fireEvent.click(screen.getByText("File to matter"));
    expect(
      await screen.findByText(/Already filed to this matter/)
    ).toBeDefined();
    expect(screen.getByTestId("dialog")).toBeDefined();
  });

  test("server error surfaces in the dialog", async () => {
    mockedFile.mockResolvedValue({ ok: false, error: "Folder not found in this matter." });
    renderChips();
    fireEvent.click(screen.getByLabelText("File brief.pdf to matter"));
    fireEvent.click(screen.getByText("File to matter"));
    expect(
      await screen.findByText("Folder not found in this matter.")
    ).toBeDefined();
  });
});
