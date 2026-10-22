/**
 * POST /api/documents/upload/blob - error mapping (F628).
 *
 * `handleUpload` is stubbed; the route and the real `UploadTokenError`
 * are used. Pins that user-safe UploadTokenError messages/statuses pass
 * through while every other failure (Prisma, SDK, zod...) returns a
 * generic 500 with NO internal text, yet the real reason is still logged
 * server-side.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));
// The real module pulls in auth/prisma; the route only needs the error
// class (same shape: status + user-safe message) and the two callbacks.
vi.mock("./blob-upload", () => {
  class UploadTokenError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "UploadTokenError";
      this.status = status;
    }
  }
  return {
    UploadTokenError,
    onBeforeGenerateToken: vi.fn(),
    onUploadCompleted: vi.fn(),
  };
});

import { handleUpload } from "@vercel/blob/client";
import { UploadTokenError } from "./blob-upload";
import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/documents/upload/blob", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  errorSpy.mockRestore();
});

describe("POST /api/documents/upload/blob error mapping", () => {
  test("success returns handleUpload's JSON", async () => {
    vi.mocked(handleUpload).mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "tok",
    });
    const res = await POST(post({ type: "blob.generate-client-token" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      type: "blob.generate-client-token",
      clientToken: "tok",
    });
  });

  test("UploadTokenError passes its status and user-safe message through", async () => {
    vi.mocked(handleUpload).mockRejectedValue(
      new UploadTokenError(403, "You don't have permission to upload."),
    );
    const res = await POST(post({ type: "blob.generate-client-token" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "You don't have permission to upload.",
    });
  });

  test("an internal error is a generic 500 - its text never reaches the caller", async () => {
    const internal =
      'Invalid `prisma.matter.findFirst()` invocation: column "matters.secret_col" does not exist';
    vi.mocked(handleUpload).mockRejectedValue(new Error(internal));
    const res = await POST(post({ type: "blob.upload-completed" }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("prisma");
    expect(text).not.toContain("secret_col");
    expect(JSON.parse(text)).toEqual({ error: "Upload handling failed." });
    // The real reason is still logged server-side.
    expect(errorSpy).toHaveBeenCalledWith(
      "[blob-upload] request failed",
      expect.objectContaining({
        event: "blob.upload-completed",
        status: 500,
        message: internal,
      }),
    );
  });

  test("a thrown non-Error value is also generic", async () => {
    vi.mocked(handleUpload).mockRejectedValue("boom: internal detail");
    const res = await POST(post({ type: "blob.upload-completed" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Upload handling failed." });
  });

  test("a non-JSON body is a 400 without calling handleUpload", async () => {
    const res = await POST(post("not json"));
    expect(res.status).toBe(400);
    expect(handleUpload).not.toHaveBeenCalled();
  });
});
