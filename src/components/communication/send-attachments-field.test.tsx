/**
 * SendAttachmentsField tests — the record gate, picking a document
 * from the record's list, removing a chip, and the client-side caps.
 * The picker's server reads are mocked (docs/TESTING.md layer 2).
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SendAttachmentsField } from "./send-attachments-field";
import type { AttachableDocument } from "@/app/actions/email-send-attachments";
import type { RecordScope } from "@/lib/record-scope";

vi.mock("@/app/actions/email-send-attachments", () => ({
  listAttachableDocuments: vi.fn(),
  findUploadedDocument: vi.fn(),
}));

import { listAttachableDocuments } from "@/app/actions/email-send-attachments";

const SCOPE: RecordScope = { kind: "matter", matterId: "m1" };
const RETAINER: AttachableDocument = {
  id: "d1",
  name: "Retainer.pdf",
  fileSize: 2048,
};

function Host({
  scope = SCOPE,
  initial = [],
}: {
  scope?: RecordScope | null;
  initial?: AttachableDocument[];
}) {
  const [value, setValue] = useState<AttachableDocument[]>(initial);
  return (
    <SendAttachmentsField
      scope={scope}
      value={value}
      onChange={setValue}
      canUpload={false}
    />
  );
}

beforeEach(() => {
  vi.mocked(listAttachableDocuments).mockReset();
  vi.mocked(listAttachableDocuments).mockResolvedValue([RETAINER]);
});

describe("SendAttachmentsField", () => {
  test("without a record the Attach button is disabled", () => {
    render(<Host scope={null} />);
    expect(screen.getByRole("button", { name: /attach/i })).toBeDisabled();
  });

  test("picking a document from the record adds a chip", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: /attach/i }));
    const row = await screen.findByRole("button", { name: /Retainer\.pdf/ });
    expect(listAttachableDocuments).toHaveBeenCalledWith(SCOPE, "");
    await user.click(row);
    expect(screen.getAllByTestId("send-attachment")).toHaveLength(1);
    expect(screen.getByTestId("send-attachment")).toHaveTextContent(
      "Retainer.pdf"
    );
  });

  test("removing a chip drops the attachment", async () => {
    const user = userEvent.setup();
    render(<Host initial={[RETAINER]} />);
    await user.click(screen.getByRole("button", { name: "Remove Retainer.pdf" }));
    expect(screen.queryByTestId("send-attachment")).toBeNull();
  });

  test("a pick past the 25 MB total is refused with a message", async () => {
    const user = userEvent.setup();
    vi.mocked(listAttachableDocuments).mockResolvedValue([
      { id: "big", name: "Exhibits.zip", fileSize: 20 * 1024 * 1024 },
    ]);
    render(
      <Host
        initial={[{ id: "d0", name: "Prior.pdf", fileSize: 10 * 1024 * 1024 }]}
      />
    );
    await user.click(screen.getByRole("button", { name: /attach/i }));
    await user.click(
      await screen.findByRole("button", { name: /Exhibits\.zip/ })
    );
    await waitFor(() =>
      expect(screen.getByText(/at most 25 MB/i)).toBeInTheDocument()
    );
    expect(screen.getAllByTestId("send-attachment")).toHaveLength(1);
  });

  test("an upload bigger than the room left is refused before uploading", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    function UploadHost() {
      const [value, setValue] = useState<AttachableDocument[]>([
        { id: "d0", name: "Prior.pdf", fileSize: 20 * 1024 * 1024 },
      ]);
      return (
        <SendAttachmentsField
          scope={SCOPE}
          value={value}
          onChange={setValue}
          canUpload
        />
      );
    }
    render(<UploadHost />);
    const input = screen.getByLabelText("Upload a new document");
    const big = new File([new Uint8Array(10)], "Big.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 });
    await user.upload(input, big);
    expect(await screen.findByText(/Not enough room/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
