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
 *  return the route's Response. */
async function download(contentType: string | null): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedFindUser.mockResolvedValue({ firmId: "f1" } as any);
  mockedFindDoc.mockResolvedValue({
    id: "d1",
    name: "exhibit A.bin",
    contentType,
    fileUrl: "key__exhibit-A.bin",
    fileSize: 4,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  mockedStat.mockResolvedValue({ size: 4 });
  mockedOpen.mockReturnValue(Readable.from([Buffer.from("data")]));

  const req = new Request("http://localhost/api/documents/d1/download");
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
});
