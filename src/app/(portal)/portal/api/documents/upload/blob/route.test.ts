/** Error mapping for the portal blob route (handleUpload stubbed). */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));
vi.mock("./portal-blob-upload", () => {
  class PortalUploadError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { PortalUploadError, onBeforeGenerateToken: vi.fn(), onUploadCompleted: vi.fn() };
});

import { handleUpload } from "@vercel/blob/client";
import { PortalUploadError } from "./portal-blob-upload";
import { POST } from "./route";

const post = (body: string) =>
  new Request("https://portal.example.com/portal/api/documents/upload/blob", {
    method: "POST",
    body,
  });

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllMocks();
  errorSpy.mockRestore();
});

describe("POST portal /api/documents/upload/blob", () => {
  test("non-JSON body -> 400", async () => {
    expect((await POST(post("nope"))).status).toBe(400);
  });

  test("a portal refusal passes its status and copy through", async () => {
    vi.mocked(handleUpload).mockRejectedValue(new PortalUploadError(401, "Please sign in again."));
    const res = await POST(post(JSON.stringify({ type: "blob.generate-client-token" })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Please sign in again." });
  });

  test("any other error -> generic 500, internal text never echoed", async () => {
    vi.mocked(handleUpload).mockRejectedValue(new Error("prisma exploded: secret"));
    const res = await POST(post(JSON.stringify({ type: "blob.upload-completed" })));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  test("success returns handleUpload's JSON", async () => {
    vi.mocked(handleUpload).mockResolvedValue({ type: "blob.generate-client-token", clientToken: "tok" });
    const res = await POST(post(JSON.stringify({ type: "blob.generate-client-token" })));
    expect(await res.json()).toEqual({ type: "blob.generate-client-token", clientToken: "tok" });
  });
});
