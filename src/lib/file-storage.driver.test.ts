/**
 * Facade-level tests for driver selection + dispatch (ADR-015).
 * Complements file-storage.test.ts, which exercises the LOCAL
 * driver's byte-level behavior and stays untouched.
 *
 * Pinned here:
 *   - the env → driver matrix (STORAGE_DRIVER override beats
 *     BLOB_READ_WRITE_TOKEN detection; bad values throw instead of
 *     silently writing prod uploads to an ephemeral disk)
 *   - WRITES dispatch on the active driver, READS/DELETES dispatch
 *     on key shape — so documents written under a previous driver
 *     are never stranded by a driver switch
 *   - the loud capability gaps: storeStream/openReadStream refuse
 *     what the blob driver can't do
 *
 * @vercel/blob is mocked; env is stubbed per-test.
 */

import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return { ...actual, put: vi.fn(), del: vi.fn(), head: vi.fn() };
});

import { del, head, put } from "@vercel/blob";
import {
  activeStorageDriver,
  deleteFile,
  openReadStream,
  statFile,
  storeFile,
  storeStream,
} from "./file-storage";
import { Readable } from "node:stream";

const mockedPut = vi.mocked(put);
const mockedDel = vi.mocked(del);
const mockedHead = vi.mocked(head);

const BLOB_URL =
  "https://abc123.public.blob.vercel-storage.com/AAAAAAAAAAAAAAAA__x.pdf";

/** Baseline: neither env set (stubEnv("", …) unsets for the test). */
function clearStorageEnv() {
  vi.stubEnv("STORAGE_DRIVER", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("activeStorageDriver — env matrix", () => {
  test("no env at all → local (the dev default)", () => {
    clearStorageEnv();
    expect(activeStorageDriver()).toBe("local");
  });

  test("BLOB_READ_WRITE_TOKEN alone → vercel-blob", () => {
    clearStorageEnv();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
    expect(activeStorageDriver()).toBe("vercel-blob");
  });

  test("STORAGE_DRIVER=local beats a present token (vercel env pull case)", () => {
    clearStorageEnv();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
    vi.stubEnv("STORAGE_DRIVER", "local");
    expect(activeStorageDriver()).toBe("local");
  });

  test("STORAGE_DRIVER=vercel-blob + token → vercel-blob", () => {
    clearStorageEnv();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
    vi.stubEnv("STORAGE_DRIVER", "vercel-blob");
    expect(activeStorageDriver()).toBe("vercel-blob");
  });

  test("STORAGE_DRIVER=vercel-blob WITHOUT a token throws (misconfig must be loud)", () => {
    clearStorageEnv();
    vi.stubEnv("STORAGE_DRIVER", "vercel-blob");
    expect(() => activeStorageDriver()).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  test("unknown STORAGE_DRIVER value throws instead of falling back", () => {
    clearStorageEnv();
    vi.stubEnv("STORAGE_DRIVER", "s3");
    expect(() => activeStorageDriver()).toThrow(/Unknown STORAGE_DRIVER/);
  });
});

describe("write dispatch — active driver decides", () => {
  test("storeFile routes to the blob driver when it's active", async () => {
    clearStorageEnv();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
    mockedPut.mockImplementation(async (pathname) => ({
      url: `https://abc123.public.blob.vercel-storage.com/${pathname}`,
      downloadUrl: "",
      pathname: String(pathname),
      contentType: "application/pdf",
      contentDisposition: "inline",
      etag: "e",
    }));

    const stored = await storeFile(
      new File(["x"], "brief.pdf", { type: "application/pdf" })
    );
    expect(mockedPut).toHaveBeenCalledTimes(1);
    expect(stored.key).toMatch(
      /^https:\/\/abc123\.public\.blob\.vercel-storage\.com\//
    );
  });

  test("storeStream refuses the blob driver — GB uploads go client-direct", async () => {
    clearStorageEnv();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
    await expect(
      storeStream(Readable.from([Buffer.from("x")]), "clip.mp4", 1024)
    ).rejects.toThrow(/client-direct/);
  });
});

describe("read/delete dispatch — key shape decides (driver-switch safety)", () => {
  test("deleteFile on a blob URL calls del() even under the LOCAL driver", async () => {
    clearStorageEnv(); // active driver: local
    mockedDel.mockResolvedValue(undefined);
    await deleteFile(BLOB_URL);
    expect(mockedDel).toHaveBeenCalledWith(BLOB_URL);
  });

  test("statFile on a blob URL calls head() even under the LOCAL driver", async () => {
    clearStorageEnv();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedHead.mockResolvedValue({ size: 42 } as any);
    await expect(statFile(BLOB_URL)).resolves.toEqual({ size: 42 });
    expect(mockedHead).toHaveBeenCalledWith(BLOB_URL);
  });

  test("deleteFile on a local key never touches the blob SDK", async () => {
    clearStorageEnv();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
    // Missing local file → best-effort no-op, and del() stays cold.
    await expect(
      deleteFile("AAAAAAAAAAAAAAAA__never-existed.pdf")
    ).resolves.toBeUndefined();
    expect(mockedDel).not.toHaveBeenCalled();
  });

  test("openReadStream refuses blob keys — serving redirects instead", () => {
    clearStorageEnv();
    expect(() => openReadStream(BLOB_URL)).toThrow(/redirect/);
  });
});
