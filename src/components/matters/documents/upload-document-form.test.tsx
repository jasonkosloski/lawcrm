/**
 * Component tests for the single-file upload composer.
 *
 * Regression: the composer used to submit through a server action,
 * which Next caps at 1 MB — any realistic PDF failed before the
 * action ran. It now travels the same pipes as the multi-file
 * uploader, so what's pinned is the transport per storage driver and
 * the field contract (target + category + display name carried), plus
 * the client preflight.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

import { upload } from "@vercel/blob/client";
import { UploadDocumentForm } from "./upload-document-form";

const mockedUpload = vi.mocked(upload);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function fillAndSubmit(
  driver: "local" | "vercel-blob" | undefined,
  file: File,
  opts?: { name?: string }
) {
  const user = userEvent.setup({ applyAccept: false });
  render(<UploadDocumentForm matterId="m1" storageDriver={driver} />);
  await user.click(screen.getByRole("button", { name: /upload document/i }));
  const fileInput = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  await user.upload(fileInput, file);
  if (opts?.name) {
    await user.type(screen.getByPlaceholderText(/./), opts.name);
  }
  await user.selectOptions(screen.getByRole("combobox"), "contract");
  await user.click(screen.getByRole("button", { name: /^upload$/i }));
}

describe("UploadDocumentForm — local driver", () => {
  test("POSTs multipart to the streaming route (not a server action), target fields before the file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ documents: [] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    // 3 MB: over Next's 1 MB server-action body cap.
    const file = new File([new Uint8Array(3 * 1024 * 1024)], "scan.pdf", {
      type: "application/pdf",
    });
    await fillAndSubmit("local", file, { name: "Signed retainer" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/documents/upload");
    expect(init.method).toBe("POST");
    const fd = init.body as FormData;
    expect([...fd.keys()]).toEqual(["matterId", "category", "name", "files"]);
    expect(fd.get("matterId")).toBe("m1");
    expect(fd.get("category")).toBe("contract");
    expect(fd.get("name")).toBe("Signed retainer");
    expect((fd.get("files") as File).name).toBe("scan.pdf");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  test("a server error message is shown and the form stays open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Unknown document category." }), {
          status: 400,
        })
      )
    );
    await fillAndSubmit("local", new File(["x"], "a.pdf"));
    expect(
      await screen.findByText("Unknown document category.")
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("UploadDocumentForm — vercel-blob driver", () => {
  test("uploads client-direct with the target, name and category in the signed payload", async () => {
    mockedUpload.mockResolvedValue({} as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await fillAndSubmit(
      "vercel-blob",
      new File([new Uint8Array(2048)], "brief.pdf"),
      { name: "Client brief" }
    );

    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    const [pathname, , options] = mockedUpload.mock.calls[0]!;
    expect(pathname).toMatch(/^[A-Za-z0-9_-]{16}__brief\.pdf$/);
    expect(options).toMatchObject({
      access: "private",
      handleUploadUrl: "/api/documents/upload/blob",
      contentType: "application/pdf",
      multipart: true,
    });
    expect(JSON.parse(options.clientPayload as string)).toEqual({
      matterId: "m1",
      folderId: null,
      name: "Client brief",
      category: "contract",
    });
    // Never through the app server.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("UploadDocumentForm — preflight", () => {
  test("an empty file is rejected client-side with nothing sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await fillAndSubmit("local", new File([], "empty.pdf"));
    expect(await screen.findByText(/is empty/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
