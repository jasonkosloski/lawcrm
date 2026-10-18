/**
 * Component tests for the multi-file uploader's transport selection.
 *
 * The component owns which PIPE a file travels through — streaming
 * XHR route (local driver) vs client-direct Vercel Blob upload
 * (vercel-blob driver) — so what's pinned here is that split plus
 * the blob call contract: key scheme pathname, shared-function
 * contentType, clientPayload target, multipart, and the
 * refresh-on-done behavior. `upload()` itself is Vercel's code and
 * is mocked; the XHR path is asserted via a stubbed XMLHttpRequest.
 *
 * Client-side preflight (size caps) is also covered — it's the only
 * guard that can save a user from watching a doomed 4GB upload.
 */

import type { RecordScope } from "@/lib/record-scope";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

import { upload } from "@vercel/blob/client";
import { MultiFileUpload } from "./multi-file-upload";

const mockedUpload = vi.mocked(upload);

/** Minimal XHR stub — captures open/send so the local path is
 *  observable without a network. */
class StubXHR {
  static instances: StubXHR[] = [];
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  responseText = JSON.stringify({ documents: [] });
  openedWith: [string, string] | null = null;
  sent: unknown = null;
  open(method: string, url: string) {
    this.openedWith = [method, url];
  }
  send(body: unknown) {
    this.sent = body;
    StubXHR.instances.push(this);
  }
  abort() {
    this.onabort?.();
  }
}

beforeEach(() => {
  scopeUnderTest = { kind: "matter", matterId: "m1" };
  StubXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", StubXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Driver under test — set per describe block before calling pickFiles.
let driver: "local" | "vercel-blob" | undefined;

let scopeUnderTest: RecordScope = { kind: "matter", matterId: "m1" };

let extraProps: {
  recordsRequestId?: string;
  recordsRole?: "request_letter" | "received_records";
  onUploaded?: () => void;
} = {};

async function pickFiles(files: File[]) {
  const user = userEvent.setup({ applyAccept: false });
  render(
    <MultiFileUpload
      {...extraProps}
      scope={scopeUnderTest}
      folderId="fold1"
      folderName="Discovery"
      storageDriver={driver}
    />
  );
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  await user.upload(input, files);
}

describe("records request tag", () => {
  beforeEach(() => {
    extraProps = { recordsRequestId: "rr1", onUploaded: vi.fn() };
  });
  afterEach(() => {
    extraProps = {};
  });

  test("local driver appends recordsRequestId before the file part", async () => {
    driver = "local";
    await pickFiles([new File(["pdf"], "rec.pdf")]);
    await waitFor(() => expect(StubXHR.instances).toHaveLength(1));
    const fd = StubXHR.instances[0].sent as FormData;
    expect([...fd.keys()]).toEqual(["matterId", "folderId", "recordsRequestId", "files"]);
    expect(fd.get("recordsRequestId")).toBe("rr1");
    StubXHR.instances[0].onload?.();
    expect(extraProps.onUploaded).toHaveBeenCalledTimes(1);
  });

  test("recordsRole follows recordsRequestId in the multipart (local) and rides the blob payload", async () => {
    extraProps = { recordsRequestId: "rr1", recordsRole: "request_letter" };
    driver = "local";
    await pickFiles([new File(["pdf"], "rec.pdf")]);
    await waitFor(() => expect(StubXHR.instances).toHaveLength(1));
    const fd = StubXHR.instances[0].sent as FormData;
    expect([...fd.keys()]).toEqual([
      "matterId",
      "folderId",
      "recordsRequestId",
      "recordsRole",
      "files",
    ]);
    expect(fd.get("recordsRole")).toBe("request_letter");
  });

  test("blob driver carries recordsRole in the client payload", async () => {
    extraProps = { recordsRequestId: "rr1", recordsRole: "received_records" };
    driver = "vercel-blob";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUpload.mockResolvedValue({ url: "https://s/x" } as any);
    await pickFiles([new File(["a"], "a.pdf", { type: "application/pdf" })]);
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(mockedUpload.mock.calls[0][2].clientPayload as string).recordsRole
    ).toBe("received_records");
  });

  test("blob driver carries it in the client payload and reports completion", async () => {
    driver = "vercel-blob";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUpload.mockResolvedValue({ url: "https://s/x" } as any);
    await pickFiles([new File(["a"], "a.pdf", { type: "application/pdf" })]);
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockedUpload.mock.calls[0][2].clientPayload as string)).toEqual({
      matterId: "m1",
      folderId: "fold1",
      recordsRequestId: "rr1",
      name: "a.pdf",
    });
    await waitFor(() => expect(extraProps.onUploaded).toHaveBeenCalledTimes(1));
  });
});

describe("lead scope", () => {
  test("local driver appends leadId (before the file part) and no matterId", async () => {
    driver = "local";
    scopeUnderTest = { kind: "lead", leadId: "l1" };
    await pickFiles([new File(["pdf"], "brief.pdf")]);
    await waitFor(() => expect(StubXHR.instances).toHaveLength(1));
    const fd = StubXHR.instances[0].sent as FormData;
    expect([...fd.keys()]).toEqual(["leadId", "folderId", "files"]);
    expect(fd.get("leadId")).toBe("l1");
    expect(fd.has("matterId")).toBe(false);
  });

  test("blob driver sends leadId (and no matterId) in the client payload", async () => {
    driver = "vercel-blob";
    scopeUnderTest = { kind: "lead", leadId: "l1" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUpload.mockResolvedValue({ url: "https://s/x" } as any);
    await pickFiles([new File(["a"], "a.pdf", { type: "application/pdf" })]);
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    const opts = mockedUpload.mock.calls[0][2];
    expect(JSON.parse(opts.clientPayload as string)).toEqual({
      leadId: "l1",
      folderId: "fold1",
      name: "a.pdf",
    });
  });
});

describe("vercel-blob driver → client-direct upload()", () => {
  beforeEach(() => {
    driver = "vercel-blob";
  });

  test("calls upload() with the key scheme, derived MIME, target payload, multipart", async () => {
    mockedUpload.mockResolvedValue({
      url: "https://s.public.blob.vercel-storage.com/k__depo.mp4",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await pickFiles([new File(["vid"], "depo.mp4", { type: "video/mp4" })]);

    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    const [pathname, file, opts] = mockedUpload.mock.calls[0];
    // Browser-side key generation, same scheme as everywhere else.
    expect(pathname).toMatch(/^[A-Za-z0-9_-]{16}__depo\.mp4$/);
    expect((file as File).name).toBe("depo.mp4");
    expect(opts).toMatchObject({
      access: "private",
      handleUploadUrl: "/api/documents/upload/blob",
      // Derived from the KEY via the shared extension map — always
      // agrees with the token route's allowedContentTypes.
      contentType: "video/mp4",
      multipart: true,
    });
    expect(JSON.parse(opts.clientPayload as string)).toEqual({
      matterId: "m1",
      folderId: "fold1",
      name: "depo.mp4",
    });
    // Rows are created by Vercel's callback → refresh to pick them up.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // The streaming route stays cold on this path.
    expect(StubXHR.instances).toHaveLength(0);
  });

  test("uploads files sequentially — one upload() call per file", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUpload.mockResolvedValue({ url: "https://s/x" } as any);
    await pickFiles([
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
    ]);
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(2));
  });

  test("a token-route rejection reads as friendly text, not the SDK's generic message", async () => {
    // What @vercel/blob/client really throws for ANY non-2xx from the
    // token route (it discards the route's { error } body).
    mockedUpload.mockRejectedValue(
      new Error("Vercel Blob: Failed to  retrieve the client token")
    );
    await pickFiles([new File(["a"], "a.pdf", { type: "application/pdf" })]);
    expect(
      await screen.findByText(/upload was rejected.*lost permission/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/retrieve the client token/)).toBeNull();
  });

  test("a genuine network error keeps its own message", async () => {
    mockedUpload.mockRejectedValue(new Error("Network request failed"));
    await pickFiles([new File(["a"], "a.pdf", { type: "application/pdf" })]);
    expect(
      await screen.findByText("Network request failed")
    ).toBeInTheDocument();
  });

  test("cancelling mid-batch still refreshes so finished files show up", async () => {
    // First file completes; the second hangs until the user cancels.
    mockedUpload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce({ url: "https://s/a" } as any)
      .mockImplementationOnce(
        (_p, _f, opts) =>
          new Promise((_resolve, reject) => {
            opts.abortSignal?.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          })
      );
    const user = userEvent.setup({ applyAccept: false });
    await pickFiles([
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
    ]);
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(2));
    expect(refresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel upload" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // A user cancel is not an error.
    expect(screen.queryByText("aborted")).toBeNull();
  });
});

describe("local driver → streaming XHR route", () => {
  beforeEach(() => {
    driver = "local";
  });

  test("POSTs FormData to /api/documents/upload; blob upload() stays cold", async () => {
    await pickFiles([new File(["pdf"], "brief.pdf")]);

    await waitFor(() => expect(StubXHR.instances).toHaveLength(1));
    const xhr = StubXHR.instances[0];
    expect(xhr.openedWith).toEqual(["POST", "/api/documents/upload"]);
    // Field order contract: target fields precede file parts.
    const fd = xhr.sent as FormData;
    expect([...fd.keys()]).toEqual(["matterId", "folderId", "files"]);
    expect(mockedUpload).not.toHaveBeenCalled();

    // Successful completion refreshes the server-rendered listing.
    xhr.onload?.();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("client-side preflight (both drivers)", () => {
  beforeEach(() => {
    driver = "vercel-blob";
  });

  test("a file over its type's cap is rejected instantly, no transport touched", async () => {
    const big = new File(["x"], "scan.pdf", { type: "application/pdf" });
    // 100 MiB standard cap + 1 — fake the size instead of allocating it.
    Object.defineProperty(big, "size", { value: 100 * 1024 * 1024 + 1 });

    await pickFiles([big]);

    expect(await screen.findByText(/too large/)).toBeInTheDocument();
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(StubXHR.instances).toHaveLength(0);
  });

  test("empty files are rejected before upload", async () => {
    await pickFiles([new File([], "empty.pdf")]);
    expect(await screen.findByText(/"empty.pdf" is empty/)).toBeInTheDocument();
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});
