import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const upload = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  upload: (...a: unknown[]) => upload(...a),
}));
const getStatus = vi.fn();
vi.mock("@/app/actions/portal-requests", () => ({
  getPortalRequestStatus: (...a: unknown[]) => getStatus(...a),
}));

import { PortalUploader } from "./portal-uploader";

const reload = vi.fn();
beforeEach(() => {
  upload.mockReset();
  getStatus.mockReset();
  reload.mockReset();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
    writable: true,
  });
});
afterEach(cleanup);

function pick(container: HTMLElement, name: string) {
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, {
    target: {
      files: [new File(["x"], name, { type: "application/octet-stream" })],
    },
  });
}

describe("PortalUploader", () => {
  test("rejects a .zip with the exact copy before any network call", () => {
    const xhr = vi.spyOn(globalThis, "XMLHttpRequest");
    const { container } = render(
      <PortalUploader matterId="m1" storageDriver="vercel-blob" />,
    );
    pick(container, "stuff.zip");
    expect(
      screen.getByText(
        "We can't accept .zip files. Please send PDFs, photos or Office documents.",
      ),
    ).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    xhr.mockRestore();
  });

  test("shows per-file progress and pins contentType + payload on the blob driver", async () => {
    upload.mockImplementation(
      (
        _k: string,
        _f: File,
        opts: { onUploadProgress: (e: { loaded: number }) => void },
      ) => {
        opts.onUploadProgress({ loaded: 1 });
        return new Promise(() => {});
      },
    );
    const { container } = render(
      <PortalUploader
        matterId="m1"
        requestId="r1"
        storageDriver="vercel-blob"
      />,
    );
    pick(container, "report.pdf");
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
    const opts = upload.mock.calls[0][2];
    expect(opts.contentType).toBe("application/pdf");
    expect(opts.handleUploadUrl).toBe("/api/documents/upload/blob");
    const payload = JSON.parse(opts.clientPayload);
    expect(payload).toMatchObject({
      matterId: "m1",
      requestId: "r1",
      name: "report.pdf",
    });
    expect(payload.batchId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("says the request was closed when the status check reports it", async () => {
    upload.mockResolvedValue({});
    getStatus.mockResolvedValue({ status: "complete" });
    const { container } = render(
      <PortalUploader
        matterId="m1"
        requestId="r1"
        storageDriver="vercel-blob"
      />,
    );
    pick(container, "report.pdf");
    await screen.findByText(
      "This request was closed by the firm. Your file was still sent.",
    );
    expect(reload).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    expect(reload).toHaveBeenCalled();
  });

  test("offers Done to reload when a later file fails after earlier ones were sent", async () => {
    upload.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("boom"));
    const { container } = render(<PortalUploader matterId="m1" storageDriver="vercel-blob" />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["x"], "a.pdf", { type: "application/pdf" }),
          new File(["y"], "b.pdf", { type: "application/pdf" }),
        ],
      },
    });
    await screen.findByRole("alert");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    expect(reload).toHaveBeenCalled();
  });

  test("the local driver posts multipart to /api/documents/upload/local", () => {
    const opened: string[] = [];
    class FakeXhr {
      upload = {};
      open(method: string, url: string) {
        opened.push(`${method} ${url}`);
      }
      send() {}
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    try {
      const { container } = render(<PortalUploader matterId="m1" storageDriver="local" />);
      pick(container, "a.pdf");
      expect(opened).toEqual(["POST /api/documents/upload/local"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("the local driver refuses a batch over the dev proxy's 10 MB body cap", () => {
    const xhr = vi.spyOn(globalThis, "XMLHttpRequest");
    const { container } = render(<PortalUploader matterId="m1" storageDriver="local" />);
    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [big] } });
    expect(
      screen.getByText("In development, uploads are limited to 10 MB per batch."),
    ).toBeTruthy();
    expect(xhr).not.toHaveBeenCalled();
    xhr.mockRestore();
  });

  test("a first-file failure offers no Done", async () => {
    upload.mockRejectedValue(new Error("boom"));
    const { container } = render(<PortalUploader matterId="m1" storageDriver="vercel-blob" />);
    pick(container, "a.pdf");
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });
});
