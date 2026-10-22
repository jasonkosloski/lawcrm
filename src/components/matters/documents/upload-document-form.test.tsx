/**
 * Component tests for the single-file composer.
 *
 * The composer used to POST the File as a server-action body, which
 * Next caps at 1 MB (and Vercel at ~4.5 MB) - anything bigger failed
 * into the error boundary despite the advertised 25 MB. These tests
 * pin the replacement contract: the bytes travel via fetch to the
 * streaming route (local) or client-direct upload() (blob), the
 * name + category ride along, and an oversize file is rejected
 * inline before any transport is touched.
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
import { UploadDocumentForm } from "./upload-document-form";

const mockedUpload = vi.mocked(upload);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

async function fill(
  driver: "local" | "vercel-blob" | undefined,
  file: File,
  opts?: { name?: string; category?: string },
  scope: RecordScope = { kind: "matter", matterId: "m1" },
) {
  const user = userEvent.setup({ applyAccept: false });
  render(<UploadDocumentForm scope={scope} storageDriver={driver} />);
  await user.click(screen.getByRole("button", { name: /upload document/i }));
  // Labels are programmatically associated (a11y).
  await user.upload(screen.getByLabelText(/^file/i), file);
  if (opts?.name) {
    await user.type(screen.getByLabelText(/display name/i), opts.name);
  }
  if (opts?.category) {
    await user.selectOptions(screen.getByLabelText(/category/i), opts.category);
  }
  await user.click(screen.getByRole("button", { name: "Upload" }));
}

describe("local driver → streaming route", () => {
  test("a lead scope appends leadId (before the file) and no matterId", async () => {
    await fill(
      "local",
      new File(["pdf"], "scan.pdf"),
      { name: "Intake form", category: "pleading" },
      { kind: "lead", leadId: "l1" },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const fd = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect([...fd.keys()]).toEqual(["leadId", "name", "category", "files"]);
    expect(fd.has("matterId")).toBe(false);
  });

  test("POSTs the file (not a server action) with name + category after matterId", async () => {
    await fill("local", new File(["pdf"], "scan.pdf"), {
      name: "Complaint",
      category: "pleading",
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/documents/upload");
    expect(init.method).toBe("POST");
    const fd = init.body as FormData;
    // Contract: target before the file part.
    expect([...fd.keys()]).toEqual(["matterId", "name", "category", "files"]);
    expect(fd.get("matterId")).toBe("m1");
    expect(fd.get("name")).toBe("Complaint");
    expect(fd.get("category")).toBe("pleading");
    expect((fd.get("files") as File).name).toBe("scan.pdf");
    expect(mockedUpload).not.toHaveBeenCalled();

    // Success refreshes the listing and collapses the composer.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /upload document/i })).toBeInTheDocument();
  });

  test("a server rejection is shown inline and the typed form is kept", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Matter not found." }), {
        status: 404,
      }),
    );
    await fill("local", new File(["pdf"], "scan.pdf"), { name: "Keep me" });

    expect(await screen.findByText("Matter not found.")).toBeInTheDocument();
    // Not collapsed, not reset.
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Keep me");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("vercel-blob driver → client-direct upload()", () => {
  test("sends name + category in the clientPayload; server action is never involved", async () => {
    mockedUpload.mockResolvedValue({ url: "https://s/x" } as never);
    await fill("vercel-blob", new File(["pdf"], "scan.pdf"), {
      name: "Complaint",
      category: "pleading",
    });

    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    const [pathname, , opts] = mockedUpload.mock.calls[0];
    expect(pathname).toMatch(/^[A-Za-z0-9_-]{16}__scan\.pdf$/);
    expect(opts).toMatchObject({
      access: "private",
      handleUploadUrl: "/api/documents/upload/blob",
      contentType: "application/pdf",
    });
    expect(JSON.parse(opts.clientPayload as string)).toEqual({
      matterId: "m1",
      folderId: null,
      name: "Complaint",
      category: "pleading",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  test("the display name falls back to the file's own name", async () => {
    mockedUpload.mockResolvedValue({ url: "https://s/x" } as never);
    await fill("vercel-blob", new File(["pdf"], "scan.pdf"));
    await waitFor(() => expect(mockedUpload).toHaveBeenCalled());
    const payload = JSON.parse(mockedUpload.mock.calls[0][2].clientPayload as string);
    expect(payload.name).toBe("scan.pdf");
    expect(payload.category).toBe("other");
  });

  test("a token-route rejection reads as friendly text", async () => {
    mockedUpload.mockRejectedValue(new Error("Vercel Blob: Failed to  retrieve the client token"));
    await fill("vercel-blob", new File(["pdf"], "scan.pdf"));
    expect(await screen.findByText(/upload was rejected.*lost permission/i)).toBeInTheDocument();
  });
});

describe("client-side size check", () => {
  test("a file over 25 MB fails inline; no transport is touched", async () => {
    const big = new File(["x"], "huge.pdf");
    Object.defineProperty(big, "size", { value: 25 * 1024 * 1024 + 1 });
    await fill("local", big);

    expect(await screen.findByText(/too large \(max 25 MB\)/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});
