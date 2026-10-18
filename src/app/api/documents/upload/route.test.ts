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

import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    matter: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn() },
    documentFolder: { findFirst: vi.fn() },
    document: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));
vi.mock("@/lib/matter-access", () => ({
  canAccessMatter: vi.fn(async () => true),
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
import { canAccessMatter } from "@/lib/matter-access";
import { revalidatePath } from "next/cache";
import {
  FileTooLargeError,
  deleteFile,
  storeStream,
} from "@/lib/file-storage";
import { POST } from "./route";

const mockedAuth = vi.mocked(auth);
const mockedPerm = vi.mocked(currentUserHasPermission);
const mockedMatter = vi.mocked(prisma.matter.findUnique);
const mockedLead = vi.mocked(prisma.lead.findUnique);
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
  vi.mocked(canAccessMatter).mockResolvedValue(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedMatter.mockResolvedValue({ id: "m1" } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedFolder.mockResolvedValue({ id: "fold1" } as any);
  mockedStore.mockImplementation((async (
    stream: NodeJS.ReadableStream,
    filename: string
  ) => {
    const size = await drain(stream);
    return { key: `key-${filename}`, size, url: `key-${filename}` };
  }) as unknown as typeof storeStream);
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
  // Array form (matter scope) and interactive form (lead scope: the
  // mock client doubles as the tx client).
  mockedTxn.mockImplementation((async (
    ops: Promise<unknown>[] | ((tx: unknown) => unknown)
  ) =>
    typeof ops === "function"
      ? ops(prisma)
      : Promise.all(ops)) as unknown as typeof prisma.$transaction);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "l1" }] as never);
}

/**
 * Serialize the FormData to bytes up front rather than passing it as
 * the body directly. A FormData body is encoded lazily by undici's
 * generator, which (Node 24) keeps enqueueing after the route cancels
 * the stream on an aborted batch → an uncatchable "ReadableStream is
 * already closed" rejection. A byte body matches what Next hands the
 * route in production (the raw HTTP stream) and cancels cleanly.
 */
async function makeRequest(fd: FormData): Promise<NextRequest> {
  const encoded = new Response(fd);
  return new NextRequest("http://test.local/api/documents/upload", {
    method: "POST",
    headers: { "content-type": encoded.headers.get("content-type")! },
    body: new Uint8Array(await encoded.arrayBuffer()),
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
    const res = await POST(await makeRequest(fdWith({ matterId: "m1" }, [])));
    expect(res.status).toBe(401);
  });

  test("403 without documents.upload", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedPerm.mockResolvedValue(false);
    const res = await POST(
      await makeRequest(fdWith({ matterId: "m1" }, [{ name: "a.pdf" }]))
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
      await makeRequest(
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
      await makeRequest(
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
    await POST(await makeRequest(fdWith({ matterId: "m1" }, [{ name: "a.pdf" }])));
    expect(mockedCreate.mock.calls[0]![0].data.folderId).toBeNull();
    expect(mockedFolder).not.toHaveBeenCalled();
  });
});

describe("POST /api/documents/upload — failure semantics", () => {
  test("404 when the matter doesn't exist; nothing stored", async () => {
    wireHappyMocks();
    mockedMatter.mockResolvedValue(null);
    const res = await POST(
      await makeRequest(fdWith({ matterId: "ghost" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(404);
    expect(mockedTxn).not.toHaveBeenCalled();
  });

  test("400 when folderId belongs to another matter (scoped lookup misses)", async () => {
    wireHappyMocks();
    mockedFolder.mockResolvedValue(null);
    const res = await POST(
      await makeRequest(
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
    const res = await POST(await makeRequest(fdWith({ matterId: "m1" }, [])));
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
      })
      .mockImplementationOnce(async (stream) => {
        await drain(stream);
        throw new FileTooLargeError(100);
      });
    const res = await POST(
      await makeRequest(
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

describe("POST /api/documents/upload — composer fields (category, name)", () => {
  test("category is stored on every row; absent means discovery", async () => {
    wireHappyMocks();
    const res = await POST(
      await makeRequest(
        fdWith({ matterId: "m1", category: "contract" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(200);
    expect(mockedCreate.mock.calls[0]![0].data.category).toBe("contract");
  });

  test("an unknown category is a 400 and nothing is stored", async () => {
    wireHappyMocks();
    const res = await POST(
      await makeRequest(
        fdWith({ matterId: "m1", category: "not-a-category" }, [
          { name: "a.pdf" },
        ])
      )
    );
    expect(res.status).toBe(400);
    expect(mockedStore).not.toHaveBeenCalled();
    expect(mockedTxn).not.toHaveBeenCalled();
  });

  test("a display-name override is ignored for a multi-file batch", async () => {
    wireHappyMocks();
    await POST(
      await makeRequest(
        fdWith({ matterId: "m1", name: "Signed retainer" }, [
          { name: "scan001.pdf" },
          { name: "scan002.pdf" },
        ])
      )
    );
    expect(mockedCreate.mock.calls[0]![0].data.name).toBe("scan001.pdf");
    expect(mockedCreate.mock.calls[1]![0].data.name).toBe("scan002.pdf");
  });

  test("a display-name override applies to a single-file upload", async () => {
    wireHappyMocks();
    await POST(
      await makeRequest(
        fdWith({ matterId: "m1", name: "Signed retainer" }, [
          { name: "scan001.pdf" },
        ])
      )
    );
    expect(mockedCreate.mock.calls[0]![0].data.name).toBe("Signed retainer");
    expect(mockedCreate.mock.calls[0]![0].data.contentType).toBe(
      "application/pdf"
    );
  });
});

describe("POST /api/documents/upload — filenames", () => {
  test("non-ASCII (UTF-8) filenames are not mangled as latin1", async () => {
    wireHappyMocks();
    const name = "Déposition – Müller.pdf";
    await POST(await makeRequest(fdWith({ matterId: "m1" }, [{ name }])));
    expect(mockedCreate.mock.calls[0]![0].data.name).toBe(name);
    expect(mockedStore.mock.calls[0]![1]).toBe(name);
  });

  test("a very long filename is capped at 255 chars and keeps its extension", async () => {
    wireHappyMocks();
    const name = "x".repeat(1000) + ".pdf";
    await POST(await makeRequest(fdWith({ matterId: "m1" }, [{ name }])));
    const stored = mockedCreate.mock.calls[0]![0].data.name;
    expect(stored).toHaveLength(255);
    expect(stored.endsWith(".pdf")).toBe(true);
    expect(mockedCreate.mock.calls[0]![0].data.contentType).toBe(
      "application/pdf"
    );
  });
});

describe("POST /api/documents/upload — client abort mid-upload", () => {
  test("a source error mid-file settles the request and the partial part is torn down", async () => {
    wireHappyMocks();
    let partCleanedUp = false;
    mockedStore.mockImplementation((async (stream: NodeJS.ReadableStream) => {
      // Like storeStreamLocal: a pipeline into a sink. If busboy never
      // errors the part stream this awaits forever (the bug).
      const sink = new Writable({
        write(_chunk, _enc, cb) {
          cb();
        },
      });
      try {
        await pipeline(stream, sink);
      } catch (err) {
        partCleanedUp = true;
        throw err;
      }
      return { key: "k", size: 1, url: "k" };
    }) as unknown as typeof storeStream);

    const encoded = new Response(
      fdWith({ matterId: "m1" }, [
        { name: "huge.mp4", content: "v".repeat(200_000) },
      ])
    );
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    // Send most of the body, then drop the connection.
    const partial = bytes.subarray(0, Math.floor(bytes.length / 2));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(partial);
        setTimeout(() => controller.error(new Error("client went away")), 20);
        return new Promise(() => {});
      },
    });
    const req = new NextRequest("http://test.local/api/documents/upload", {
      method: "POST",
      headers: { "content-type": encoded.headers.get("content-type")! },
      body,
      duplex: "half",
    });

    const res = await POST(req);
    // The request settles with a failure (nothing is committed)...
    expect(res.status).toBeGreaterThanOrEqual(400);
    // ...the in-flight part's pipeline was torn down...
    expect(partCleanedUp).toBe(true);
    // ...and no Document row was written.
    expect(mockedTxn).not.toHaveBeenCalled();
  }, 3000);
});

describe("POST /api/documents/upload — intake lead scope", () => {
  const BOTH_OR_NEITHER =
    "Exactly one of matterId or leadId is required and must precede file parts in the form data.";

  function wireLead(stage = "new") {
    wireHappyMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedLead.mockResolvedValue({ id: "l1", stage } as any);
  }

  test("a lead upload stores leadId (and no matterId) and revalidates intake paths", async () => {
    wireLead();
    const res = await POST(
      await makeRequest(fdWith({ leadId: "l1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(200);
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.leadId).toBe("l1");
    expect(data.matterId).toBeUndefined();
    expect(mockedMatter).not.toHaveBeenCalled();
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain("/intake/l1/documents");
    expect(paths).toContain("/intake/l1");
    expect(paths.some((p) => p.includes("null") || p.includes("undefined"))).toBe(
      false
    );
    expect(vi.mocked(logActivity).mock.calls[0]![0].matterId).toBeNull();
  });

  test("a lead folder is looked up scoped by leadId", async () => {
    wireLead();
    await POST(
      await makeRequest(
        fdWith({ leadId: "l1", folderId: "fold1" }, [{ name: "a.pdf" }])
      )
    );
    expect(mockedFolder).toHaveBeenCalledWith({
      where: { id: "fold1", leadId: "l1" },
      select: { id: true },
    });
  });

  test("both ids -> 400, nothing stored", async () => {
    wireLead();
    const res = await POST(
      await makeRequest(
        fdWith({ matterId: "m1", leadId: "l1" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      BOTH_OR_NEITHER
    );
    expect(mockedStore).not.toHaveBeenCalled();
  });

  test("neither id -> 400, nothing stored", async () => {
    wireLead();
    const res = await POST(await makeRequest(fdWith({}, [{ name: "a.pdf" }])));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      BOTH_OR_NEITHER
    );
    expect(mockedStore).not.toHaveBeenCalled();
  });

  test("a folderId from another scope with a leadId -> 400 before any byte is stored", async () => {
    wireLead();
    mockedFolder.mockResolvedValue(null); // scoped lookup misses
    const res = await POST(
      await makeRequest(
        fdWith({ leadId: "l1", folderId: "matter-folder" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Folder not found in this matter or intake."
    );
    expect(mockedStore).not.toHaveBeenCalled();
    expect(mockedTxn).not.toHaveBeenCalled();
  });

  test("takes a FOR SHARE lock on the lead row inside the create transaction", async () => {
    wireLead();
    await POST(await makeRequest(fdWith({ leadId: "l1" }, [{ name: "a.pdf" }])));
    const q = vi.mocked(prisma.$queryRaw).mock.calls[0]!;
    expect((q[0] as unknown as string[]).join("?")).toMatch(/FOR SHARE/);
    expect(q[1]).toBe("l1");
  });

  /** Lead is unconverted at resolveTarget, converted by the time the
   *  create transaction re-reads it (the conversion landed while the
   *  bytes streamed). */
  function wireConvertedDuringUpload(matterId: string | null) {
    wireHappyMocks();
    // resolveTarget reads the lead twice (exists + writable check).
    mockedLead.mockResolvedValueOnce({ id: "l1", stage: "new" } as never);
    mockedLead.mockResolvedValueOnce({ id: "l1", stage: "new" } as never);
    mockedLead.mockResolvedValue({
      id: "l1",
      stage: "converted",
      convertedMatterId: matterId,
    } as never);
  }

  test("lead converted during the upload: files onto the converted matter, bytes kept", async () => {
    wireConvertedDuringUpload("m9");
    const res = await POST(
      await makeRequest(
        fdWith({ leadId: "l1", folderId: "fold1" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(200);
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.matterId).toBe("m9");
    expect(data.leadId).toBeUndefined();
    expect(data.folderId).toBe("fold1");
    expect(mockedFolder).toHaveBeenLastCalledWith({
      where: { id: "fold1", matterId: "m9" },
      select: { id: true },
    });
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(vi.mocked(logActivity).mock.calls[0]![0].matterId).toBe("m9");
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain("/matters/m9/documents");
  });

  test("converted during the upload and the folder no longer resolves: matter root", async () => {
    wireConvertedDuringUpload("m9");
    mockedFolder
      .mockResolvedValueOnce({ id: "fold1" } as never) // resolveTarget
      .mockResolvedValue(null); // under the matter scope
    const res = await POST(
      await makeRequest(
        fdWith({ leadId: "l1", folderId: "fold1" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(200);
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.matterId).toBe("m9");
    expect(data.folderId).toBeNull();
  });

  test("converted during the upload, uploader cannot access the matter: fail closed, bytes removed", async () => {
    wireConvertedDuringUpload("m9");
    vi.mocked(canAccessMatter).mockResolvedValue(false);
    const res = await POST(
      await makeRequest(fdWith({ leadId: "l1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedDelete).toHaveBeenCalledWith("key-a.pdf");
  });

  test("lead deleted during the upload: 404, bytes removed", async () => {
    wireHappyMocks();
    mockedLead.mockResolvedValueOnce({ id: "l1", stage: "new" } as never);
    mockedLead.mockResolvedValueOnce({ id: "l1", stage: "new" } as never);
    mockedLead.mockResolvedValue(null);
    const res = await POST(
      await makeRequest(fdWith({ leadId: "l1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(404);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedDelete).toHaveBeenCalledWith("key-a.pdf");
  });

  test("a converted lead -> 409, nothing stored", async () => {
    wireLead("converted");
    const res = await POST(
      await makeRequest(fdWith({ leadId: "l1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /already converted/
    );
    expect(mockedStore).not.toHaveBeenCalled();
  });

  test("an unknown lead -> 404 Lead not found.", async () => {
    wireLead();
    mockedLead.mockResolvedValue(null);
    const res = await POST(
      await makeRequest(fdWith({ leadId: "ghost" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Lead not found."
    );
    expect(mockedStore).not.toHaveBeenCalled();
  });
});
