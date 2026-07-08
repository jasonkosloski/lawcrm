/**
 * Unit tests for the Vercel Blob storage driver — @vercel/blob is
 * mocked (put/del/head are network calls); the real error classes
 * and `getDownloadUrl` are kept via importOriginal so instanceof
 * branches and URL munging run for real.
 *
 * What's pinned: the argument contracts we send the SDK (access,
 * contentType, addRandomSuffix/allowOverwrite OFF, the cache TTL),
 * the key↔URL mapping (put under a `{rand}__{name}` pathname, hand
 * back the FULL blob URL as the storage key), and the
 * BlobNotFoundError → null/no-op translations that keep the facade
 * contract identical to the local driver's.
 */

import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return { ...actual, put: vi.fn(), del: vi.fn(), head: vi.fn() };
});

import { BlobNotFoundError, del, head, put } from "@vercel/blob";
import {
  BLOB_CACHE_MAX_AGE_SECONDS,
  blobDownloadUrl,
  deleteFileBlob,
  statFileBlob,
  storeFileBlob,
} from "./blob-driver";

const mockedPut = vi.mocked(put);
const mockedDel = vi.mocked(del);
const mockedHead = vi.mocked(head);

const STORE = "https://abc123.public.blob.vercel-storage.com";

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
      access: "public",
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
    await expect(
      deleteFileBlob(`${STORE}/k__gone.pdf`)
    ).resolves.toBeUndefined();
  });

  test("other SDK errors still propagate", async () => {
    mockedDel.mockRejectedValue(new Error("store suspended"));
    await expect(deleteFileBlob(`${STORE}/k__x.pdf`)).rejects.toThrow(
      "store suspended"
    );
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
    await expect(statFileBlob(`${STORE}/k__a.mp4`)).rejects.toThrow(
      "rate limited"
    );
  });
});

describe("blobDownloadUrl", () => {
  test("appends the CDN's ?download=1 attachment forcer", () => {
    // Real getDownloadUrl (not mocked) — pins the actual SDK
    // behavior we lean on for disposition forcing.
    const url = blobDownloadUrl(`${STORE}/k__report.html`);
    expect(url).toBe(`${STORE}/k__report.html?download=1`);
  });
});
