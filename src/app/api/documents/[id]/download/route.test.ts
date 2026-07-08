/**
 * Unit tests for the document download route.
 *
 * Focus: the anti-XSS response headers. `Document.contentType` is
 * uploader-controlled (client-declared `file.type`, size-only
 * validation upstream), so the route must never render untrusted
 * types inline on our origin. These tests pin the allowlist
 * behavior: inline only for known-passive types, `attachment` +
 * `Content-Security-Policy: sandbox` for everything else, and
 * `X-Content-Type-Options: nosniff` on every download.
 *
 * Auth / prisma / storage are mocked — the session gate itself is
 * exercised only at the "no session → 401" boundary; firm-scoping
 * belongs to an integration pass once Contact carries firmId.
 */

import { Readable } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    document: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/file-storage", () => ({
  openReadStream: vi.fn(),
  statFile: vi.fn(),
  // Real (trivial) implementations — the route's blob branch keys
  // off these, and mocking them away would un-test the dispatch.
  isBlobKey: (key: string) => key.startsWith("https://"),
  blobDownloadUrl: (url: string) => `${url}?download=1`,
}));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { openReadStream, statFile } from "@/lib/file-storage";
import { GET } from "./route";

const mockedAuth = vi.mocked(auth);
const mockedFindUser = vi.mocked(prisma.user.findUnique);
const mockedFindDoc = vi.mocked(prisma.document.findFirst);
const mockedStat = vi.mocked(statFile);
const mockedOpen = vi.mocked(openReadStream);

afterEach(() => {
  vi.clearAllMocks();
});

/** Wire the happy path with a doc of the given contentType and
 *  return the route's Response. `bytes` is the fake on-disk file;
 *  the storage mock honors ranged reads the way fs does (inclusive
 *  start/end) so 206 slice assertions are meaningful. */
async function download(
  contentType: string | null,
  opts?: { bytes?: string; range?: string }
): Promise<Response> {
  const bytes = Buffer.from(opts?.bytes ?? "data");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedFindUser.mockResolvedValue({ firmId: "f1" } as any);
  mockedFindDoc.mockResolvedValue({
    id: "d1",
    name: "exhibit A.bin",
    contentType,
    fileUrl: "key__exhibit-A.bin",
    fileSize: bytes.length,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  mockedStat.mockResolvedValue({ size: bytes.length });
  mockedOpen.mockImplementation((_key, range) =>
    Readable.from([
      range ? bytes.subarray(range.start, range.end + 1) : bytes,
    ])
  );

  const req = new Request("http://localhost/api/documents/d1/download", {
    headers: opts?.range ? { range: opts.range } : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return GET(req as any, { params: Promise.resolve({ id: "d1" }) });
}

describe("GET /api/documents/[id]/download — auth gate", () => {
  test("401 without a session", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue(null as any);
    const req = new Request("http://localhost/api/documents/d1/download");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any, {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/documents/[id]/download — XSS-hardened headers", () => {
  test("every download carries nosniff", async () => {
    const res = await download("application/pdf");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("allowlisted types (pdf, png) render inline, without CSP sandbox", async () => {
    for (const type of ["application/pdf", "image/png"]) {
      const res = await download(type);
      expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
      // sandbox would break Chrome's PDF plugin; inline types are
      // passive so the header is deliberately absent here.
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
    }
  });

  test("user-declared text/html is forced to attachment + sandboxed", async () => {
    const res = await download("text/html");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("MIME parameters can't smuggle past the allowlist", async () => {
    const res = await download("text/html; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  test("image/svg+xml is NOT inline-safe (scriptable image)", async () => {
    const res = await download("image/svg+xml");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  test("missing contentType falls back to octet-stream attachment", async () => {
    const res = await download(null);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  test("streams the file bytes and preserves the original name", async () => {
    const res = await download("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(
      `filename*=UTF-8''${encodeURIComponent("exhibit A.bin")}`
    );
    expect(await res.text()).toBe("data");
  });

  test("media types render inline for the discovery viewer (no sandbox)", async () => {
    for (const type of ["video/mp4", "audio/mpeg", "text/plain"]) {
      const res = await download(type);
      expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
    }
  });
});

describe("GET /api/documents/[id]/download — Range requests", () => {
  const TEN = "0123456789";

  test("full responses advertise Accept-Ranges: bytes", async () => {
    const res = await download("video/mp4", { bytes: TEN });
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Length")).toBe("10");
  });

  test("bounded range → 206 with the exact inclusive slice", async () => {
    const res = await download("video/mp4", {
      bytes: TEN,
      range: "bytes=2-5",
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await res.text()).toBe("2345");
    // The slice happened at the fs layer, not by streaming the whole
    // file and throwing bytes away.
    expect(mockedOpen).toHaveBeenCalledWith("key__exhibit-A.bin", {
      start: 2,
      end: 5,
    });
  });

  test("open-ended range runs to EOF", async () => {
    const res = await download("video/mp4", {
      bytes: TEN,
      range: "bytes=6-",
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 6-9/10");
    expect(await res.text()).toBe("6789");
  });

  test("suffix range serves the last N bytes", async () => {
    const res = await download("video/mp4", {
      bytes: TEN,
      range: "bytes=-4",
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 6-9/10");
    expect(await res.text()).toBe("6789");
  });

  test("range past EOF → 416 with the real size", async () => {
    const res = await download("video/mp4", {
      bytes: TEN,
      range: "bytes=10-",
    });
    expect(res.status).toBe(416);
    // `bytes */10` teaches the media element the real length so it
    // can retry with a valid offset.
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  test("malformed range is ignored → 200 full body", async () => {
    const res = await download("video/mp4", {
      bytes: TEN,
      range: "bytes=5-2",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(TEN);
  });

  test("206 keeps the XSS headers (nosniff + disposition)", async () => {
    const res = await download("video/mp4", {
      bytes: TEN,
      range: "bytes=0-3",
    });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
  });
});

describe("GET /api/documents/[id]/download — blob-stored documents (302)", () => {
  const BLOB_URL =
    "https://abc123.public.blob.vercel-storage.com/AAAAAAAAAAAAAAAA__clip.mp4";

  /** Same happy wiring as `download()` but with a blob-URL fileUrl —
   *  the shape that selects the redirect branch (ADR-015). */
  async function downloadBlob(
    contentType: string | null,
    opts?: { missing?: boolean }
  ): Promise<Response> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedFindUser.mockResolvedValue({ firmId: "f1" } as any);
    mockedFindDoc.mockResolvedValue({
      id: "d1",
      name: "clip.mp4",
      contentType,
      fileUrl: BLOB_URL,
      fileSize: 100,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    mockedStat.mockResolvedValue(opts?.missing ? null : { size: 100 });

    const req = new Request("http://localhost/api/documents/d1/download");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return GET(req as any, { params: Promise.resolve({ id: "d1" }) });
  }

  test("inline-safe type → 302 to the bare blob URL, never proxied", async () => {
    const res = await downloadBlob("video/mp4");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(BLOB_URL);
    // The bytes must not flow through the route.
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  test("non-inline-safe type → 302 to the ?download=1 attachment URL", async () => {
    // text/html on the isolated blob origin can't ride our session,
    // but forcing download preserves the local path's UX contract.
    const res = await downloadBlob("text/html");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`${BLOB_URL}?download=1`);
  });

  test("redirect (the auth boundary) is never cacheable", async () => {
    const res = await downloadBlob("video/mp4");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  test("blob gone (stat null) → 410, same as a missing local file", async () => {
    const res = await downloadBlob("video/mp4", { missing: true });
    expect(res.status).toBe(410);
  });

  test("still 401 without a session — the gate precedes the redirect", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedAuth.mockResolvedValue(null as any);
    const req = new Request("http://localhost/api/documents/d1/download");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any, {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(401);
  });
});
