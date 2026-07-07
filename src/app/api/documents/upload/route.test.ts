// @vitest-environment node
/**
 * Unit tests for the streaming upload route.
 *
 * The multipart body is REAL (undici's FormData encoder feeds the
 * route an actual multipart stream, so busboy's parse path runs for
 * real); auth / permission / prisma / storage / activity-log are
 * mocked. `storeStream` mocks must CONSUME their part stream —
 * busboy backpressures on unread parts and the route would hang.
 *
 * What's pinned: both gates, the response contract
 * ({ documents: [{id, name}] } / { error }), field-order target
 * validation (bad folder fails before any byte is stored),
 * extension-derived MIME beating the client-declared part type,
 * per-type size caps → 413, and all-or-nothing cleanup of
 * already-stored files. Streaming/cap mechanics of storeStream
 * itself live in src/lib/file-storage.test.ts.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    matter: { findUnique: vi.fn() },
    documentFolder: { findFirst: vi.fn() },
    document: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/file-storage", async (importOriginal) => {
  // Keep the real FileTooLargeError class — the route branches on
  // instanceof to pick 413 over 500.
  const actual = await importOriginal<typeof import("@/lib/file-storage")>();
  return {
    ...actual,
    storeStream: vi.fn(),
    deleteFile: vi.fn(),
  };
});

import { auth } from "@/auth";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import {
  FileTooLargeError,
  deleteFile,
  storeStream,
} from "@/lib/file-storage";
import { POST } from "./route";

const mockedAuth = vi.mocked(auth);
const mockedPerm = vi.mocked(currentUserHasPermission);
const mockedMatter = vi.mocked(prisma.matter.findUnique);
const mockedFolder = vi.mocked(prisma.documentFolder.findFirst);
const mockedCreate = vi.mocked(prisma.document.create);
const mockedTxn = vi.mocked(prisma.$transaction);
const mockedStore = vi.mocked(storeStream);
const mockedDelete = vi.mocked(deleteFile);

afterEach(() => {
  vi.clearAllMocks();
});

/** Drain a busboy part stream (Readable) fully. */
async function drain(stream: NodeJS.ReadableStream): Promise<number> {
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
  }
  return size;
}

function wireHappyMocks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
  mockedPerm.mockResolvedValue(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedMatter.mockResolvedValue({ id: "m1" } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedFolder.mockResolvedValue({ id: "fold1" } as any);
  mockedStore.mockImplementation(async (stream, filename) => {
    const size = await drain(stream);
    return { key: `key-${filename}`, size, url: `key-${filename}` };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  // The route builds prisma.document.create(...) calls and hands the
  // array to $transaction — echo each op's data back as the row.
  mockedCreate.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((args: any) =>
      Promise.resolve({
        id: `doc-${args.data.name}`,
        name: args.data.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedTxn.mockImplementation((async (ops: Promise<unknown>[]) =>
    Promise.all(ops)) as any);
}

function makeRequest(fd: FormData): NextRequest {
  return new NextRequest("http://test.local/api/documents/upload", {
    method: "POST",
    body: fd,
  });
}

function fdWith(
  fields: Record<string, string>,
  files: { name: string; content?: string; declaredType?: string }[]
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) {
    fd.append(
      "files",
      new File([f.content ?? "file-bytes"], f.name, {
        type: f.declaredType ?? "application/octet-stream",
      })
    );
  }
  return fd;
}

describe("POST /api/documents/upload — gates", () => {
  test("401 without a session", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue(null as any);
    const res = await POST(makeRequest(fdWith({ matterId: "m1" }, [])));
    expect(res.status).toBe(401);
  });

  test("403 without documents.upload", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedPerm.mockResolvedValue(false);
    const res = await POST(
      makeRequest(fdWith({ matterId: "m1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(403);
    expect(mockedPerm).toHaveBeenCalledWith("documents.upload");
    expect(mockedStore).not.toHaveBeenCalled();
  });

  test("400 on a non-multipart body", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedPerm.mockResolvedValue(true);
    const res = await POST(
      new NextRequest("http://test.local/api/documents/upload", {
        method: "POST",
        body: JSON.stringify({ nope: true }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/documents/upload — happy path + contract", () => {
  test("multi-file upload creates rows in the folder and returns the contract shape", async () => {
    wireHappyMocks();
    const res = await POST(
      makeRequest(
        fdWith({ matterId: "m1", folderId: "fold1" }, [
          { name: "production-01.pdf", content: "pdf-bytes" },
          { name: "bodycam.mp4", content: "video-bytes" },
        ])
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documents: { id: string; name: string }[];
    };
    expect(body.documents).toHaveLength(2);
    expect(body.documents[0]).toEqual({
      id: "doc-production-01.pdf",
      name: "production-01.pdf",
    });

    // Rows carry the resolved folder, discovery category, and sizes
    // measured from the actual stream, not client claims.
    const firstData = mockedCreate.mock.calls[0]![0].data;
    expect(firstData).toMatchObject({
      matterId: "m1",
      folderId: "fold1",
      category: "discovery",
      source: "upload",
      contentType: "application/pdf",
      fileSize: "pdf-bytes".length,
      uploadedBy: "u1",
    });

    // ONE audit row per batch.
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logActivity).mock.calls[0]![0].title).toMatch(
      /2 documents uploaded/
    );
  });

  test("server-derived MIME beats the client-declared part type", async () => {
    wireHappyMocks();
    const res = await POST(
      makeRequest(
        fdWith({ matterId: "m1" }, [
          // Attacker declares text/html on a .pdf — extension wins.
          { name: "innocent.pdf", declaredType: "text/html" },
        ])
      )
    );
    expect(res.status).toBe(200);
    expect(mockedCreate.mock.calls[0]![0].data.contentType).toBe(
      "application/pdf"
    );
  });

  test("root uploads (no folderId) store folderId null", async () => {
    wireHappyMocks();
    await POST(makeRequest(fdWith({ matterId: "m1" }, [{ name: "a.pdf" }])));
    expect(mockedCreate.mock.calls[0]![0].data.folderId).toBeNull();
    expect(mockedFolder).not.toHaveBeenCalled();
  });
});

describe("POST /api/documents/upload — failure semantics", () => {
  test("404 when the matter doesn't exist; nothing stored", async () => {
    wireHappyMocks();
    mockedMatter.mockResolvedValue(null);
    const res = await POST(
      makeRequest(fdWith({ matterId: "ghost" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(404);
    expect(mockedTxn).not.toHaveBeenCalled();
  });

  test("400 when folderId belongs to another matter (scoped lookup misses)", async () => {
    wireHappyMocks();
    mockedFolder.mockResolvedValue(null);
    const res = await POST(
      makeRequest(
        fdWith({ matterId: "m1", folderId: "other-matter-folder" }, [
          { name: "a.pdf" },
        ])
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/folder/i);
    expect(mockedTxn).not.toHaveBeenCalled();
  });

  test("400 when no files are attached", async () => {
    wireHappyMocks();
    const res = await POST(makeRequest(fdWith({ matterId: "m1" }, [])));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /no files/i
    );
  });

  test("413 on a too-large file, and already-stored files are removed (all-or-nothing)", async () => {
    wireHappyMocks();
    mockedStore
      .mockImplementationOnce(async (stream, filename) => {
        const size = await drain(stream);
        return { key: `key-${filename}`, size };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })
      .mockImplementationOnce(async (stream) => {
        await drain(stream);
        throw new FileTooLargeError(100);
      });
    const res = await POST(
      makeRequest(
        fdWith({ matterId: "m1" }, [
          { name: "ok.pdf" },
          { name: "huge.mp4" },
        ])
      )
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /too large/i
    );
    // The batch is all-or-nothing: the first file's bytes are gone.
    expect(mockedDelete).toHaveBeenCalledWith("key-ok.pdf");
    expect(mockedTxn).not.toHaveBeenCalled();
  });
});
