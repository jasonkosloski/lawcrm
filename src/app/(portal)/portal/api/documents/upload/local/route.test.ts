/**
 * Dev (local-driver) portal multipart upload route. Storage, the portal
 * session and the shared completion are mocked: this pins the route's
 * gates and its hand-off, not the DB (record-upload has its own
 * integration test).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/portal-access", () => ({ getPortalIdentity: vi.fn() }));
vi.mock("@/lib/file-storage", () => {
  class FileTooLargeError extends Error {}
  return {
    FileTooLargeError,
    activeStorageDriver: vi.fn(() => "local"),
    deleteFile: vi.fn(async () => {}),
    storeStream: vi.fn(),
  };
});
const findFirst = vi.fn(async (): Promise<{ id: string } | null> => null);
vi.mock("@/lib/prisma", () => ({
  prisma: { document: { findFirst: () => findFirst() } },
}));
vi.mock("@/lib/portal/record-upload", () => ({
  PORTAL_UPLOAD_NOTE_MAX: 500,
  checkPortalUploadTarget: vi.fn(async () => ({ ok: true })),
  recordPortalUpload: vi.fn(),
}));

import { Readable } from "node:stream";
import { getPortalIdentity } from "@/lib/portal-access";
import { activeStorageDriver, deleteFile, storeStream } from "@/lib/file-storage";
import { checkPortalUploadTarget, recordPortalUpload } from "@/lib/portal/record-upload";
import { POST } from "./route";

const BATCH = "11111111-1111-4111-8111-111111111111";

/** Bytes, not a lazy FormData body (see the staff route test's note:
 *  undici's generator rejects after an early cancel). */
async function toRequest(fd: FormData): Promise<Request> {
  const encoded = new Response(fd);
  return new Request("http://portal.localhost:3000/portal/api/documents/upload/local", {
    method: "POST",
    headers: { "content-type": encoded.headers.get("content-type")! },
    body: new Uint8Array(await encoded.arrayBuffer()),
  });
}

function form(files: [string, string][], fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("matterId", "m1");
  fd.append("batchId", BATCH);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [name, body] of files) fd.append("files", new File([body], name));
  return toRequest(fd);
}

let n = 0;
beforeEach(() => {
  vi.mocked(getPortalIdentity).mockResolvedValue({ identityId: "i1", contactId: "c1", email: "a@b.c" });
  vi.mocked(storeStream).mockImplementation(async (stream: Readable) => {
    let size = 0;
    for await (const chunk of stream) size += (chunk as Buffer).length;
    n += 1;
    return { key: `key${n}`, size };
  });
  vi.mocked(recordPortalUpload).mockImplementation(async (i) => ({
    ok: true,
    documentId: `doc-${i.storageKey}`,
    requestClosed: false,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(activeStorageDriver).mockReturnValue("local");
  vi.mocked(checkPortalUploadTarget).mockResolvedValue({ ok: true });
});

describe("POST portal /api/documents/upload/local (dev multipart)", () => {
  test("refuses without a portal session (401) and stores nothing", async () => {
    vi.mocked(getPortalIdentity).mockResolvedValue(null);
    const res = await POST(await form([["a.pdf", "hello"]]));
    expect(res.status).toBe(401);
    expect(storeStream).not.toHaveBeenCalled();
    expect(recordPortalUpload).not.toHaveBeenCalled();
  });

  test("501 under the blob driver", async () => {
    vi.mocked(activeStorageDriver).mockReturnValue("vercel-blob");
    expect((await POST(await form([["a.pdf", "x"]]))).status).toBe(501);
  });

  test("a target refusal (no access, closed request, daily cap) stores nothing", async () => {
    vi.mocked(checkPortalUploadTarget).mockResolvedValue({
      ok: false,
      status: 429,
      error: "You've reached today's upload limit. Please try again tomorrow.",
    });
    const res = await POST(await form([["a.pdf", "x"]]));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "You've reached today's upload limit. Please try again tomorrow.",
    });
    expect(storeStream).not.toHaveBeenCalled();
  });

  test("a disallowed type fails the batch and removes files already stored", async () => {
    const res = await POST(await form([["a.pdf", "ok"], ["b.zip", "zz"]]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "We can't accept .zip files. Please send PDFs, photos or Office documents.",
    });
    expect(deleteFile).toHaveBeenCalledWith("key1");
    expect(recordPortalUpload).not.toHaveBeenCalled();
  });

  test("the cap check counts every file in the batch", async () => {
    await POST(await form([["a.pdf", "1"], ["b.pdf", "2"]]));
    const calls = vi.mocked(checkPortalUploadTarget).mock.calls.map((c) => c[0].adding);
    expect(calls.at(-1)).toBe(2);
  });

  test("hands each stored file to recordPortalUpload with the session identity", async () => {
    const res = await POST(
      await form([["Lease.PDF", "hello"]], { requestId: "r1", note: " lease ", identityId: "evil" })
    );
    expect(res.status).toBe(200);
    expect(recordPortalUpload).toHaveBeenCalledWith({
      identityId: "i1",
      matterId: "m1",
      requestId: "r1",
      batchId: BATCH,
      storageKey: expect.stringMatching(/^key/),
      filename: "Lease.PDF",
      contentType: "application/pdf",
      size: 5,
      note: "lease",
    });
    const body = await res.json();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({ name: "Lease.PDF", requestClosed: false });
  });

  test("a completion refusal surfaces as 403", async () => {
    vi.mocked(recordPortalUpload).mockResolvedValue({
      ok: false,
      error: "You no longer have access to this matter.",
    });
    const res = await POST(await form([["a.pdf", "x"]]));
    expect(res.status).toBe(403);
  });

  test("a completion that throws mid-batch removes the unrecorded files", async () => {
    vi.mocked(recordPortalUpload)
      .mockResolvedValueOnce({ ok: true, documentId: "d1", requestClosed: false })
      .mockRejectedValueOnce(new Error("db down"));
    const res = await POST(await form([["a.pdf", "1"], ["b.pdf", "2"], ["c.pdf", "3"]]));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Upload failed." });
    const removed = vi.mocked(deleteFile).mock.calls.map((c) => c[0]);
    // The first file has its row and stays; the failed one and the rest go.
    expect(removed).toHaveLength(2);
    const [first] = vi.mocked(recordPortalUpload).mock.calls.map((c) => c[0].storageKey);
    expect(removed).not.toContain(first);
  });

  test("a throw after the row was written keeps that file's bytes", async () => {
    vi.mocked(recordPortalUpload).mockRejectedValueOnce(new Error("log failed"));
    findFirst.mockResolvedValueOnce({ id: "d1" });
    const res = await POST(await form([["a.pdf", "1"], ["b.pdf", "2"]]));
    expect(res.status).toBe(500);
    const removed = vi.mocked(deleteFile).mock.calls.map((c) => c[0]);
    const [first] = vi.mocked(recordPortalUpload).mock.calls.map((c) => c[0].storageKey);
    expect(removed).toHaveLength(1);
    expect(removed).not.toContain(first);
  });

  test("an empty file is rejected and removed", async () => {
    const res = await POST(await form([["a.pdf", ""]]));
    expect(res.status).toBe(400);
    expect(deleteFile).toHaveBeenCalled();
    expect(recordPortalUpload).not.toHaveBeenCalled();
  });

  test("a missing or non-uuid batchId -> 400", async () => {
    const fd = new FormData();
    fd.append("matterId", "m1");
    fd.append("files", new File(["x"], "a.pdf"));
    const res = await POST(await toRequest(fd));
    expect(res.status).toBe(400);
  });
});
