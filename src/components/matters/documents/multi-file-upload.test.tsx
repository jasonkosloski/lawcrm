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
  StubXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", StubXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Driver under test — set per describe block before calling pickFiles.
let driver: "local" | "vercel-blob" | undefined;

async function pickFiles(files: File[]) {
  const user = userEvent.setup({ applyAccept: false });
  render(
    <MultiFileUpload
      matterId="m1"
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
      access: "public",
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

  test("surfaces the token route's rejection message", async () => {
    mockedUpload.mockRejectedValue(
      new Error("You don't have permission to upload documents.")
    );
    await pickFiles([new File(["a"], "a.pdf", { type: "application/pdf" })]);
    expect(
      await screen.findByText("You don't have permission to upload documents.")
    ).toBeInTheDocument();
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
