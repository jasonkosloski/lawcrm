/**
 * Blob-branch tests for GET /api/email-attachments/[id]/download
 * (F629/F707).
 *
 * The blob driver 302s to a presigned URL, and whether that URL carries
 * `download=1` (forced attachment) was decided from the SENDER-declared
 * content type - but the blob is stored (and the CDN serves it) with the
 * type derived from the filename. A sender could therefore attach
 * "invoice.html" declaring application/pdf and get it rendered inline as
 * text/html from the blob origin. The decision must use the server-derived
 * type. Storage is mocked at the facade; the route and
 * `contentTypeForFilename` are real.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const BLOB_KEY = "https://abc123.private.blob.vercel-storage.com/AAAAAAAAAAAAAAAA__file";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { emailAttachment: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/matter-access", () => ({
  optionalRecordAccessClause: vi.fn(async () => []),
}));
vi.mock("@/lib/email-attachments", () => ({
  AttachmentBytesError: class AttachmentBytesError extends Error {},
  ensureAttachmentBytes: vi.fn(),
}));
vi.mock("@/lib/file-storage", () => ({
  isBlobKey: (key: string) => key.startsWith("https://"),
  statFile: vi.fn(),
  openReadStream: vi.fn(),
  signedBlobUrl: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureAttachmentBytes } from "@/lib/email-attachments";
import { signedBlobUrl, statFile } from "@/lib/file-storage";
import { GET } from "./route";

async function redirectFor(filename: string, declared: string | null) {
  vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(prisma.emailAttachment.findFirst).mockResolvedValue({
    id: "a1",
    filename,
    // The route must not even select this, but a stale/hostile value
    // being present must make no difference.
    contentType: declared,
  } as never);
  vi.mocked(ensureAttachmentBytes).mockResolvedValue({
    key: `${BLOB_KEY}-${filename}`,
  } as never);
  vi.mocked(statFile).mockResolvedValue({ size: 10 });
  vi.mocked(signedBlobUrl).mockResolvedValue(
    "https://abc123.private.blob.vercel-storage.com/signed",
  );
  const res = await GET(
    new Request("http://localhost/api/email-attachments/a1/download") as never,
    { params: Promise.resolve({ id: "a1" }) },
  );
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("email attachment blob redirect uses the server-derived type", () => {
  test("invoice.html declaring application/pdf is forced to download", async () => {
    const res = await redirectFor("invoice.html", "application/pdf");
    expect(res.status).toBe(302);
    expect(vi.mocked(signedBlobUrl)).toHaveBeenCalledWith(expect.any(String), {
      download: true,
      media: false,
    });
  });

  test("a real .pdf declaring text/html is allowed inline", async () => {
    const res = await redirectFor("brief.pdf", "text/html");
    expect(res.status).toBe(302);
    expect(vi.mocked(signedBlobUrl)).toHaveBeenCalledWith(expect.any(String), {
      download: false,
      media: false,
    });
  });

  test("unknown / missing extension is download-only even if declared pdf", async () => {
    await redirectFor("report", "application/pdf");
    expect(vi.mocked(signedBlobUrl)).toHaveBeenCalledWith(expect.any(String), {
      download: true,
      media: false,
    });
  });

  test("svg (active content) is download-only regardless of declaration", async () => {
    await redirectFor("logo.svg", "image/png");
    expect(vi.mocked(signedBlobUrl)).toHaveBeenCalledWith(expect.any(String), {
      download: true,
      media: false,
    });
  });
});

describe("email attachment blob redirect - TTL, caching and failure shapes", () => {
  test("audio / video attachments get the long media TTL (ADR-018)", async () => {
    await redirectFor("voicemail.mp3", null);
    expect(vi.mocked(signedBlobUrl)).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ media: true }),
    );
    await redirectFor("clip.mp4", null);
    expect(vi.mocked(signedBlobUrl)).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ media: true }),
    );
  });

  test("the redirect (the auth boundary) is never cacheable and is not proxied", async () => {
    const res = await redirectFor("brief.pdf", null);
    expect(res.headers.get("Location")).toBe(
      "https://abc123.private.blob.vercel-storage.com/signed",
    );
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  test("blob gone (stat null) -> 410 and nothing is signed", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(prisma.emailAttachment.findFirst).mockResolvedValue({
      id: "a1",
      filename: "brief.pdf",
    } as never);
    vi.mocked(ensureAttachmentBytes).mockResolvedValue({
      key: BLOB_KEY,
    } as never);
    vi.mocked(statFile).mockResolvedValue(null);
    const res = await GET(
      new Request("http://localhost/api/email-attachments/a1/download") as never,
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(410);
    expect(vi.mocked(signedBlobUrl)).not.toHaveBeenCalled();
  });

  test("an unexpected failure while caching bytes is a logged JSON 502, not a bare 500", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(prisma.emailAttachment.findFirst).mockResolvedValue({
      id: "a1",
      filename: "brief.pdf",
    } as never);
    vi.mocked(ensureAttachmentBytes).mockRejectedValue(new Error("blob store down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(
      new Request("http://localhost/api/email-attachments/a1/download") as never,
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/try again/i),
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
