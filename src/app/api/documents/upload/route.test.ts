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

// This route is excluded from the Clerk middleware matcher, so anything
// that reads Clerk request state throws in production (Clerk's auth()
// "can't detect clerkMiddleware"). Model that: every request-context
// identity path throws, and only getStaffAuthFromRequest works.
const NO_CLERK_STATE = "Clerk request state is unavailable on this route";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => {
    throw new Error(NO_CLERK_STATE);
  }),
}));
vi.mock("@/lib/staff-auth", () => ({
  getStaffAuthFromRequest: vi.fn(),
  getStaffAuth: vi.fn(async () => {
    throw new Error(NO_CLERK_STATE);
  }),
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => {
    throw new Error(NO_CLERK_STATE);
  }),
}));
vi.mock("@/lib/permission-check", () => ({
  userHasPermission: vi.fn(),
  currentUserHasPermission: vi.fn(async () => {
    throw new Error(NO_CLERK_STATE);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    matter: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn() },
    matterDraft: { findUnique: vi.fn() },
    matterDraftFile: { count: vi.fn(), create: vi.fn() },
    documentFolder: { findFirst: vi.fn() },
    document: { create: vi.fn() },
    recordsRequest: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));
vi.mock("@/lib/lead-access", () => ({
  canAccessLead: vi.fn(async () => true),
}));
vi.mock("@/lib/matter-access", () => ({
  canAccessMatter: vi.fn(async () => true),
}));
vi.mock("@/lib/draft-access", () => ({
  canAccessDraft: vi.fn(async () => true),
}));
vi.mock("@/lib/records-requests/folder", () => ({
  resolveRecordsUpload: vi.fn(),
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

import { getStaffAuthFromRequest } from "@/lib/staff-auth";
import { userHasPermission } from "@/lib/permission-check";
import { auth as clerkAuth } from "@clerk/nextjs/server";
import { getStaffAuth } from "@/lib/staff-auth";
import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { canAccessMatter } from "@/lib/matter-access";
import { canAccessLead } from "@/lib/lead-access";
import { canAccessDraft } from "@/lib/draft-access";
import { resolveRecordsUpload } from "@/lib/records-requests/folder";
import { revalidatePath } from "next/cache";
import {
  FileTooLargeError,
  deleteFile,
  storeStream,
} from "@/lib/file-storage";
import { POST } from "./route";

const mockedAuth = vi.mocked(getStaffAuthFromRequest);
const OK = {
  status: "ok",
  userId: "u1",
  clerkUserId: "clerk_1",
  sessionId: "sess_1",
} as const;
const mockedPerm = vi.mocked(userHasPermission);
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
   
  mockedAuth.mockResolvedValue(OK);
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
    mockedAuth.mockResolvedValue({ status: "signed_out" });
    const res = await POST(await makeRequest(fdWith({ matterId: "m1" }, [])));
    expect(res.status).toBe(401);
  });

  test("401 for a signed-in user with no firm access", async () => {
    mockedAuth.mockResolvedValue({
      status: "no_access",
      clerkUserId: "clerk_1",
    });
    const res = await POST(await makeRequest(fdWith({ matterId: "m1" }, [])));
    expect(res.status).toBe(401);
    expect(mockedPerm).not.toHaveBeenCalled();
  });

  test("403 without documents.upload", async () => {
    mockedAuth.mockResolvedValue(OK);
    mockedPerm.mockResolvedValue(false);
    const res = await POST(
      await makeRequest(fdWith({ matterId: "m1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(403);
    expect(mockedPerm).toHaveBeenCalledWith("u1", "documents.upload");
    expect(mockedStore).not.toHaveBeenCalled();
  });

  test("400 on a non-multipart body", async () => {
    mockedAuth.mockResolvedValue(OK);
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

  test("never reads Clerk request state or the session-based resolvers (matcher-excluded route)", async () => {
    wireHappyMocks();
    const res = await POST(
      await makeRequest(fdWith({ matterId: "m1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(200);
    expect(mockedPerm).toHaveBeenCalledWith("u1", "documents.upload");
    expect(clerkAuth).not.toHaveBeenCalled();
    expect(getStaffAuth).not.toHaveBeenCalled();
    expect(getCurrentUserId).not.toHaveBeenCalled();
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

  test("a restricted lead the uploader isn't on -> 404 before any byte is stored (ADR-049)", async () => {
    wireLead();
    vi.mocked(canAccessLead).mockResolvedValueOnce(false);
    const res = await POST(
      await makeRequest(fdWith({ leadId: "l1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(404);
    expect(mockedStore).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
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

describe("POST /api/documents/upload — records requests", () => {
  const REQ_ERROR = "Records request not found in this matter or intake.";
  const mockedReq = vi.mocked(prisma.recordsRequest.findFirst);
  const mockedResolve = vi.mocked(resolveRecordsUpload);
  const TAGGED = {
    folderId: "recfold",
    recordsRequestId: "rr1",
    recordsRequestRole: "received_records",
  } as const;

  test("tags the document received_records and files it in the request folder", async () => {
    wireHappyMocks();
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    mockedResolve.mockResolvedValue(TAGGED);
    const res = await POST(
      await makeRequest(
        fdWith({ matterId: "m1", recordsRequestId: "rr1" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(200);
    expect(mockedReq).toHaveBeenCalledWith({
      where: { id: "rr1", matterId: "m1" },
      select: { id: true },
    });
    expect(mockedResolve).toHaveBeenCalledWith(
      expect.anything(),
      "rr1",
      { kind: "matter", matterId: "m1" },
      null,
      "received_records"
    );
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.recordsRequestId).toBe("rr1");
    expect(data.recordsRequestRole).toBe("received_records");
    expect(data.folderId).toBe("recfold");
  });

  test("a request from another scope -> 400 before any byte is stored", async () => {
    wireHappyMocks();
    mockedReq.mockResolvedValue(null);
    const res = await POST(
      await makeRequest(
        fdWith({ matterId: "m1", recordsRequestId: "other" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(REQ_ERROR);
    expect(mockedStore).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  test("without records.edit -> 403 before any byte is stored", async () => {
    wireHappyMocks();
    mockedPerm.mockImplementation(async (_u, k) => k !== "records.edit");
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    const res = await POST(
      await makeRequest(
        fdWith({ matterId: "m1", recordsRequestId: "rr1" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(403);
    expect(mockedStore).not.toHaveBeenCalled();
  });

  test("an explicit folderId is kept (only the tag is added)", async () => {
    wireHappyMocks();
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    mockedResolve.mockResolvedValue({ ...TAGGED, folderId: "fold1" });
    await POST(
      await makeRequest(
        fdWith({ matterId: "m1", recordsRequestId: "rr1", folderId: "fold1" }, [
          { name: "a.pdf" },
        ])
      )
    );
    expect(mockedResolve.mock.calls[0]![3]).toBe("fold1");
  });

  test("no recordsRequestId: untouched behavior, no records lookups", async () => {
    wireHappyMocks();
    await POST(await makeRequest(fdWith({ matterId: "m1" }, [{ name: "a.pdf" }])));
    expect(mockedReq).not.toHaveBeenCalled();
    expect(mockedResolve).not.toHaveBeenCalled();
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.recordsRequestId).toBeUndefined();
  });

  test("lead upload rerouted to the converted matter re-checks the request against the FINAL scope", async () => {
    wireHappyMocks();
    mockedLead.mockResolvedValueOnce({ id: "l1", stage: "new" } as never);
    mockedLead.mockResolvedValueOnce({ id: "l1", stage: "new" } as never);
    mockedLead.mockResolvedValue({
      id: "l1",
      stage: "converted",
      convertedMatterId: "m9",
    } as never);
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    mockedResolve.mockResolvedValue(TAGGED);
    const res = await POST(
      await makeRequest(
        fdWith({ leadId: "l1", recordsRequestId: "rr1" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(200);
    expect(mockedResolve.mock.calls[0]![2]).toEqual({
      kind: "matter",
      matterId: "m9",
    });
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.matterId).toBe("m9");
    expect(data.recordsRequestId).toBe("rr1");
  });

  test("request no longer matches the final scope: filed untagged, upload not failed", async () => {
    wireHappyMocks();
    mockedLead.mockResolvedValueOnce({ id: "l1", stage: "new" } as never);
    mockedLead.mockResolvedValueOnce({ id: "l1", stage: "new" } as never);
    mockedLead.mockResolvedValue({
      id: "l1",
      stage: "converted",
      convertedMatterId: "m9",
    } as never);
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    mockedResolve.mockResolvedValue(null);
    const res = await POST(
      await makeRequest(
        fdWith({ leadId: "l1", recordsRequestId: "rr1" }, [{ name: "a.pdf" }])
      )
    );
    expect(res.status).toBe(200);
    expect(mockedDelete).not.toHaveBeenCalled();
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.matterId).toBe("m9");
    expect(data.recordsRequestId).toBeUndefined();
    expect(data.recordsRequestRole).toBeUndefined();
  });

  test("a recordsRequestId after the first file part -> 400, nothing stored", async () => {
    wireHappyMocks();
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    const fd = new FormData();
    fd.append("matterId", "m1");
    fd.append("files", new File(["x"], "a.pdf"));
    fd.append("recordsRequestId", "rr1");
    const res = await POST(await makeRequest(fd));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "recordsRequestId must precede file parts in the form data."
    );
    expect(mockedCreate).not.toHaveBeenCalled();
    // Either never stored, or stored and cleaned up.
    expect(mockedDelete.mock.calls.length).toBe(mockedStore.mock.calls.length);
  });

  test("recordsRole routes to the resolver and tags the document", async () => {
    wireHappyMocks();
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    mockedResolve.mockResolvedValue({ ...TAGGED, recordsRequestRole: "request_letter" });
    const res = await POST(
      await makeRequest(
        fdWith({ matterId: "m1", recordsRequestId: "rr1", recordsRole: "request_letter" }, [
          { name: "a.pdf" },
        ])
      )
    );
    expect(res.status).toBe(200);
    expect(mockedResolve.mock.calls[0]![4]).toBe("request_letter");
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.recordsRequestRole).toBe("request_letter");
  });

  test("an invalid recordsRole -> 400 before any byte, nothing stored", async () => {
    wireHappyMocks();
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    const res = await POST(
      await makeRequest(
        fdWith({ matterId: "m1", recordsRequestId: "rr1", recordsRole: "bogus" }, [
          { name: "a.pdf" },
        ])
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Invalid records document kind."
    );
    expect(mockedStore).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  test("an omitted recordsRole defaults to received_records", async () => {
    wireHappyMocks();
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    mockedResolve.mockResolvedValue(TAGGED);
    await POST(
      await makeRequest(
        fdWith({ matterId: "m1", recordsRequestId: "rr1" }, [{ name: "a.pdf" }])
      )
    );
    expect(mockedResolve.mock.calls[0]![4]).toBe("received_records");
  });

  test("a recordsRole after the first file part -> 400, nothing stored", async () => {
    wireHappyMocks();
    mockedReq.mockResolvedValue({ id: "rr1" } as never);
    const fd = new FormData();
    fd.append("matterId", "m1");
    fd.append("recordsRequestId", "rr1");
    fd.append("files", new File(["x"], "a.pdf"));
    fd.append("recordsRole", "request_letter");
    const res = await POST(await makeRequest(fd));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "recordsRole must precede file parts in the form data."
    );
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedDelete.mock.calls.length).toBe(mockedStore.mock.calls.length);
  });
});

describe("POST /api/documents/upload — draft target", () => {
  function wireDraft(existing = 0) {
    wireHappyMocks();
    vi.mocked(canAccessDraft).mockResolvedValue(true);
    vi.mocked(prisma.matterDraft.findUnique).mockResolvedValue({
      id: "d1",
    } as never);
    vi.mocked(prisma.matterDraftFile.count).mockResolvedValue(existing);
    vi.mocked(prisma.matterDraftFile.create).mockImplementation(((args: {
      data: { name: string };
    }) =>
      Promise.resolve({
        id: `df-${args.data.name}`,
        name: args.data.name,
      })) as never);
  }

  test("writes draft-file rows (no Document) and returns their ids", async () => {
    wireDraft();
    const res = await POST(
      await makeRequest(
        fdWith({ draftId: "d1" }, [{ name: "agreement.pdf" }, { name: "b.pdf" }])
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: { id: string; name: string }[] };
    expect(body.documents).toEqual([
      { id: "df-agreement.pdf", name: "agreement.pdf" },
      { id: "df-b.pdf", name: "b.pdf" },
    ]);
    expect(prisma.matterDraftFile.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prisma.matterDraftFile.create).mock.calls[0][0].data).toMatchObject({
      draftId: "d1",
      name: "agreement.pdf",
      fileUrl: "key-agreement.pdf",
      uploadedBy: "u1",
    });
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        matterId: null,
        type: "filing",
        title: "File attached to a matter draft",
      })
    );
    expect(JSON.stringify(vi.mocked(logActivity).mock.calls)).not.toContain("agreement.pdf");
  });

  test("combined with matterId, leadId, folderId or recordsRequestId -> 400", async () => {
    const extras: Record<string, string>[] = [
      { matterId: "m1" },
      { leadId: "l1" },
      { folderId: "fold1" },
      { recordsRequestId: "r1" },
    ];
    for (const extra of extras) {
      wireDraft();
      const res = await POST(
        await makeRequest(fdWith({ draftId: "d1", ...extra }, [{ name: "a.pdf" }]))
      );
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(mockedStore).not.toHaveBeenCalled();
      vi.clearAllMocks();
    }
    wireDraft();
    const res = await POST(
      await makeRequest(fdWith({ draftId: "d1", matterId: "m1" }, [{ name: "a.pdf" }]))
    );
    expect((await res.json()).error).toBe(
      "Choose exactly one of a matter, a lead or a draft."
    );
  });

  test("no draft access -> 404 before any byte is stored", async () => {
    wireDraft();
    vi.mocked(canAccessDraft).mockResolvedValue(false);
    const res = await POST(
      await makeRequest(fdWith({ draftId: "d1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(404);
    expect(mockedStore).not.toHaveBeenCalled();
  });

  test("403 without documents.upload", async () => {
    wireDraft();
    mockedPerm.mockResolvedValue(false);
    const res = await POST(
      await makeRequest(fdWith({ draftId: "d1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(403);
  });

  test("over the 50 MB per-file cap -> 400 with the draft message", async () => {
    wireDraft();
    mockedStore.mockImplementation((async (
      stream: NodeJS.ReadableStream,
      _f: string,
      cap: number
    ) => {
      await drain(stream);
      if (cap === 50 * 1024 * 1024) throw new FileTooLargeError(cap);
      return { key: "k", size: 1, url: "k" };
    }) as unknown as typeof storeStream);
    const res = await POST(
      await makeRequest(fdWith({ draftId: "d1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Draft files are limited to 50 MB each.");
    expect(prisma.matterDraftFile.create).not.toHaveBeenCalled();
  });

  test("existing rows + this batch over 20 -> 400, nothing written", async () => {
    wireDraft(19);
    const res = await POST(
      await makeRequest(
        fdWith({ draftId: "d1" }, [{ name: "a.pdf" }, { name: "b.pdf" }])
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A draft can hold up to 20 files.");
    expect(prisma.matterDraftFile.create).not.toHaveBeenCalled();
    expect(mockedDelete).toHaveBeenCalled();
  });

  test("draft deleted while the bytes streamed -> 404 and files removed", async () => {
    wireDraft();
    vi.mocked(prisma.matterDraft.findUnique).mockResolvedValue(null);
    const res = await POST(
      await makeRequest(fdWith({ draftId: "d1" }, [{ name: "a.pdf" }]))
    );
    expect(res.status).toBe(404);
    expect(mockedDelete).toHaveBeenCalledWith("key-a.pdf");
    expect(prisma.matterDraftFile.create).not.toHaveBeenCalled();
  });
});
