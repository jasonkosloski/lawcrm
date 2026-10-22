/**
 * Unit tests for the Vercel Blob storage driver — @vercel/blob is
 * mocked (put/del/head are network calls); the real error classes
 * and `getDownloadUrl` are kept via importOriginal so instanceof
 * branches and URL munging run for real.
 *
 * What's pinned: the argument contracts we send the SDK (PRIVATE
 * access, contentType, addRandomSuffix/allowOverwrite OFF, the cache
 * TTL), the key↔URL mapping (put under a `{rand}__{name}` pathname,
 * hand back the FULL blob URL as the storage key), signed-URL scoping
 * (one pathname, get-only, TTL by media vs document) and the
 * BlobNotFoundError → null/no-op translations that keep the facade
 * contract identical to the local driver's.
 */

import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return {
    ...actual,
    put: vi.fn(),
    del: vi.fn(),
    head: vi.fn(),
    get: vi.fn(),
    issueSignedToken: vi.fn(),
    presignUrl: vi.fn(),
  };
});

import { BlobNotFoundError, del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";
import {
  BLOB_CACHE_MAX_AGE_SECONDS,
  SIGNED_MEDIA_URL_TTL_MS,
  SIGNED_URL_TTL_MS,
  blobPathname,
  deleteFileBlob,
  readBlobBytes,
  signedBlobUrl,
  statFileBlob,
  storeFileBlob,
} from "./blob-driver";

const mockedPut = vi.mocked(put);
const mockedDel = vi.mocked(del);
const mockedHead = vi.mocked(head);

const STORE = "https://abc123.private.blob.vercel-storage.com";

afterEach(() => {
  vi.clearAllMocks();
});

describe("storeFileBlob", () => {
  test("puts under the shared key scheme and returns the URL as the key", async () => {
    mockedPut.mockImplementation(async (pathname) => ({
      url: `${STORE}/${pathname}`,
      downloadUrl: `${STORE}/${pathname}?download=1`,
      pathname,
      contentType: "application/pdf",
      contentDisposition: "inline",
      etag: "e1",
    }));

    const file = new File(["pdf bytes"], "brief.pdf", {
      type: "application/pdf",
    });
    const stored = await storeFileBlob(file);

    expect(mockedPut).toHaveBeenCalledTimes(1);
    const [pathname, body, opts] = mockedPut.mock.calls[0];
    // Blob pathname keeps the SAME opaque key scheme as local keys.
    expect(pathname).toMatch(/^[A-Za-z0-9_-]{16}__brief\.pdf$/);
    expect(body).toBe(file);
    expect(opts).toEqual({
      access: "private",
      contentType: "application/pdf",
      // Our key already carries the entropy; a Vercel-added suffix
      // would diverge the pathname from the key scheme.
      addRandomSuffix: false,
      // A colliding key must fail loudly, never overwrite.
      allowOverwrite: false,
      cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
    });

    // key↔URL mapping: Document.fileUrl gets the FULL blob URL.
    expect(stored.key).toBe(`${STORE}/${pathname}`);
    expect(stored.size).toBe(file.size);
    expect(stored.contentType).toBe("application/pdf");
  });

  test("empty File.type falls back to octet-stream (local-driver parity)", async () => {
    mockedPut.mockResolvedValue({
      url: `${STORE}/k__b.bin`,
      downloadUrl: `${STORE}/k__b.bin?download=1`,
      pathname: "k__b.bin",
      contentType: "application/octet-stream",
      contentDisposition: "attachment",
      etag: "e2",
    });
    const stored = await storeFileBlob(new File(["x"], "b.bin", { type: "" }));
    expect(mockedPut.mock.calls[0][2]).toMatchObject({
      contentType: "application/octet-stream",
    });
    expect(stored.contentType).toBe("application/octet-stream");
  });
});

describe("deleteFileBlob", () => {
  test("deletes by URL", async () => {
    mockedDel.mockResolvedValue(undefined);
    await deleteFileBlob(`${STORE}/k__gone.pdf`);
    expect(mockedDel).toHaveBeenCalledWith(`${STORE}/k__gone.pdf`);
  });

  test("already-gone blob is a no-op (best-effort contract)", async () => {
    mockedDel.mockRejectedValue(new BlobNotFoundError());
    await expect(deleteFileBlob(`${STORE}/k__gone.pdf`)).resolves.toBeUndefined();
  });

  test("other SDK errors still propagate", async () => {
    mockedDel.mockRejectedValue(new Error("store suspended"));
    await expect(deleteFileBlob(`${STORE}/k__x.pdf`)).rejects.toThrow("store suspended");
  });
});

describe("statFileBlob", () => {
  test("maps head() to the { size } probe contract", async () => {
    mockedHead.mockResolvedValue({
      size: 1234,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await expect(statFileBlob(`${STORE}/k__a.mp4`)).resolves.toEqual({
      size: 1234,
    });
    expect(mockedHead).toHaveBeenCalledWith(`${STORE}/k__a.mp4`);
  });

  test("missing blob → null (the download route's 410 signal)", async () => {
    mockedHead.mockRejectedValue(new BlobNotFoundError());
    await expect(statFileBlob(`${STORE}/k__a.mp4`)).resolves.toBeNull();
  });

  test("other SDK errors still propagate", async () => {
    mockedHead.mockRejectedValue(new Error("rate limited"));
    await expect(statFileBlob(`${STORE}/k__a.mp4`)).rejects.toThrow("rate limited");
  });
});

describe("blobPathname", () => {
  test("recovers the (decoded) pathname from a stored URL", () => {
    expect(blobPathname(`${STORE}/k__brief%20v2.pdf`)).toBe("k__brief v2.pdf");
  });

  test("decodes #, ? and % escapes", () => {
    expect(blobPathname(`${STORE}/k__Exhibit%20%233%3F%2050%25.pdf`)).toBe(
      "k__Exhibit #3? 50%.pdf",
    );
  });

  test("an invalid escape falls back to the raw path instead of throwing", () => {
    expect(blobPathname(`${STORE}/k__bad%zz.pdf`)).toBe("k__bad%zz.pdf");
  });
});

describe("signedBlobUrl", () => {
  const signed = `${STORE}/k__brief.pdf?vercel-blob-delegation=d&vercel-blob-signature=s`;

  function wire() {
    vi.mocked(issueSignedToken).mockResolvedValue({
      delegationToken: "d",
      clientSigningToken: "c",
      validUntil: 0,
    });
    vi.mocked(presignUrl).mockResolvedValue({ presignedUrl: signed });
  }

  test("scopes the token to one pathname, get-only, short-lived", async () => {
    wire();
    const before = Date.now();
    const url = await signedBlobUrl(`${STORE}/k__brief.pdf`);
    expect(url).toBe(signed);

    const tokenOpts = vi.mocked(issueSignedToken).mock.calls[0][0];
    expect(tokenOpts.pathname).toBe("k__brief.pdf");
    expect(tokenOpts.operations).toEqual(["get"]);
    expect(tokenOpts.validUntil! - before).toBeGreaterThanOrEqual(SIGNED_URL_TTL_MS - 50);
    expect(tokenOpts.validUntil! - before).toBeLessThanOrEqual(SIGNED_URL_TTL_MS + 1000);

    expect(vi.mocked(presignUrl).mock.calls[0][1]).toMatchObject({
      operation: "get",
      pathname: "k__brief.pdf",
      access: "private",
      validUntil: tokenOpts.validUntil,
    });
  });

  test("media gets the long lifetime (seeking through long recordings)", async () => {
    wire();
    const before = Date.now();
    await signedBlobUrl(`${STORE}/k__bodycam.mp4`, { media: true });
    const { validUntil } = vi.mocked(issueSignedToken).mock.calls[0][0];
    expect(validUntil! - before).toBeGreaterThanOrEqual(SIGNED_MEDIA_URL_TTL_MS - 50);
  });

  test("a name with #, ? and % still addresses the right blob (SDK concatenates the pathname unencoded)", async () => {
    vi.mocked(issueSignedToken).mockResolvedValue({
      delegationToken: "d",
      clientSigningToken: "c",
      validUntil: 0,
    });
    // Mimic the SDK (constructBlobUrl + addPresignedParams): bare
    // concatenation of the DECODED pathname, parse, then searchParams.set
    // — a `#`/`?` in the name corrupts the path of this URL.
    vi.mocked(presignUrl).mockImplementation(async (_t, opts) => {
      const u = new URL(`${STORE}/${opts.pathname}`);
      u.searchParams.set("vercel-blob-delegation", "d");
      u.searchParams.set("vercel-blob-signature", "s");
      return { presignedUrl: u.toString() };
    });
    const key = "k__Exhibit #3? 50%.pdf";
    const url = new URL(await signedBlobUrl(`${STORE}/${encodeURIComponent(key)}`));
    expect(decodeURIComponent(url.pathname.slice(1))).toBe(key);
    expect(url.hash).toBe("");
    expect(url.searchParams.get("vercel-blob-signature")).toBe("s");
    expect([...url.searchParams.keys()].sort()).toEqual([
      "vercel-blob-delegation",
      "vercel-blob-signature",
    ]);
  });

  test("download appends the CDN attachment flag outside the signature", async () => {
    wire();
    const url = new URL(await signedBlobUrl(`${STORE}/k__brief.pdf`, { download: true }));
    expect(url.searchParams.get("download")).toBe("1");
    expect(url.searchParams.get("vercel-blob-signature")).toBe("s");
  });
});

describe("readBlobBytes", () => {
  function streamOf(...parts: string[]) {
    return new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    });
  }

  test("authenticated private get, ranged to the cap", async () => {
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: streamOf("hello ", "world"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const buf = await readBlobBytes(`${STORE}/k__a.txt`, 5);
    expect(buf?.toString()).toBe("hello");
    expect(vi.mocked(get)).toHaveBeenCalledWith(`${STORE}/k__a.txt`, {
      access: "private",
      headers: { range: "bytes=0-4" },
    });
  });

  test("uncapped read returns everything", async () => {
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: streamOf("a", "b", "c"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect((await readBlobBytes(`${STORE}/k__a.txt`))?.toString()).toBe("abc");
    expect(vi.mocked(get).mock.calls[0][1]).toEqual({ access: "private" });
  });

  test("missing blob → null", async () => {
    vi.mocked(get).mockResolvedValue(null);
    await expect(readBlobBytes(`${STORE}/k__gone.txt`)).resolves.toBeNull();
  });
});
