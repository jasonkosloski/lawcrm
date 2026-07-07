/**
 * Tests for the file-storage adapter. The adapter writes bytes to
 * the local filesystem under `./uploads/`; tests use a temp
 * directory under the OS temp dir to avoid touching the dev
 * uploads folder.
 *
 * Coverage:
 *   - storeFile writes the bytes + returns key/size/contentType
 *   - storeStream (the GB-scale upload path): byte counting, cap
 *     enforcement, partial-file cleanup on abort
 *   - statFile reflects size after write; returns null for missing
 *   - openReadStream round-trips the bytes; ranged reads return the
 *     exact inclusive slice (feeds HTTP 206 responses)
 *   - deleteFile is best-effort (succeeds on missing files)
 *   - path-traversal keys are rejected (defense-in-depth)
 *
 * Why a dynamic import: STORAGE_ROOT is resolved once at module
 * load via `process.cwd()`. ESM hoists static imports before any
 * top-level statement, so a top-level `process.chdir(...)` runs
 * AFTER the module has already captured the project root. Doing
 * the import inside `beforeAll` (after chdir) lets the module
 * resolve STORAGE_ROOT under our temp dir.
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

// `tmpdir()` on macOS is the `/var/...` symlink but `process.cwd()`
// resolves it to the real `/private/var/...` path — normalize so
// downstream join() comparisons line up.
const TEST_TMP = realpathSync(mkdtempSync(join(tmpdir(), "lawcrm-files-")));

type FileStorage = typeof import("./file-storage");
let mod: FileStorage;

beforeAll(async () => {
  process.chdir(TEST_TMP);
  expect(process.cwd()).toBe(TEST_TMP);
  // Dynamic import after chdir so STORAGE_ROOT resolves under the
  // temp dir.
  mod = await import("./file-storage");
});

afterEach(() => {
  // Wipe the uploads dir between tests so they don't pollute one
  // another. Best-effort.
  try {
    rmSync(join(TEST_TMP, "uploads"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Build a `File` from a string for tests — File ships in
 *  Node 20+ via the global. */
const makeFile = (content: string, name: string, type = "text/plain"): File =>
  new File([content], name, { type });

describe("storeFile", () => {
  test("writes bytes + returns size + contentType", async () => {
    const f = makeFile("hello world", "greeting.txt");
    const stored = await mod.storeFile(f);
    expect(stored.key).toMatch(/^[A-Za-z0-9_-]+__greeting\.txt$/);
    expect(stored.size).toBe(11); // "hello world" is 11 ASCII bytes
    expect(stored.contentType).toBe("text/plain");

    // The on-disk file matches.
    const onDisk = readFileSync(join(TEST_TMP, "uploads", stored.key));
    expect(onDisk.toString("utf8")).toBe("hello world");
  });

  test("falls back to octet-stream when File.type is empty", async () => {
    const f = makeFile("data", "blob.bin", "");
    const stored = await mod.storeFile(f);
    expect(stored.contentType).toBe("application/octet-stream");
  });

  test("strips path-traversal slashes from the filename", async () => {
    // The cuid prefix is generated; the safe-name suffix is what
    // we sanitize. The adapter replaces `/` and `\` with `_`; the
    // result MUST NOT contain a literal slash that the FS could
    // resolve as a directory boundary. Internal `..` substrings
    // are harmless once the separators are gone.
    const f = makeFile("payload", "../../../etc/passwd");
    const stored = await mod.storeFile(f);
    const [, safeName] = stored.key.split("__");
    expect(safeName).not.toMatch(/[/\\]/);
    // Leading dots get stripped — won't start with `.`
    expect(safeName?.startsWith(".")).toBe(false);
  });

  test("two storeFile calls with the same name produce different keys", async () => {
    const a = await mod.storeFile(makeFile("v1", "doc.txt"));
    const b = await mod.storeFile(makeFile("v2", "doc.txt"));
    expect(a.key).not.toBe(b.key);
  });
});

describe("storeStream", () => {
  test("streams chunks to disk and reports the byte count", async () => {
    const { key, size } = await mod.storeStream(
      Readable.from([Buffer.from("01234"), Buffer.from("56789")]),
      "clip.mp4",
      1024
    );
    expect(size).toBe(10);
    expect(await mod.statFile(key)).toEqual({ size: 10 });
    const onDisk = readFileSync(join(TEST_TMP, "uploads", key));
    expect(onDisk.toString("utf8")).toBe("0123456789");
  });

  test("a file exactly at the cap is allowed", async () => {
    const { size } = await mod.storeStream(
      Readable.from([Buffer.alloc(8, "x")]),
      "at-cap.bin",
      8
    );
    expect(size).toBe(8);
  });

  test("one byte over the cap rejects and removes the partial file", async () => {
    await expect(
      mod.storeStream(
        // Two chunks: the first fits, so bytes DO land on disk
        // before the cap trips — that partial must be unlinked
        // (a partial with no Document row is an invisible orphan).
        Readable.from([Buffer.alloc(6, "a"), Buffer.alloc(3, "b")]),
        "over-cap.bin",
        8
      )
    ).rejects.toBeInstanceOf(mod.FileTooLargeError);

    const leftovers = readdirSync(join(TEST_TMP, "uploads")).filter((f) =>
      f.endsWith("__over-cap.bin")
    );
    expect(leftovers).toEqual([]);
  });

  test("FileTooLargeError carries the cap for the 413 message", async () => {
    const err = await mod
      .storeStream(Readable.from([Buffer.alloc(9, "z")]), "big.bin", 4)
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(err).toBeInstanceOf(mod.FileTooLargeError);
    expect((err as InstanceType<FileStorage["FileTooLargeError"]>).maxBytes).toBe(4);
  });
});

describe("statFile", () => {
  test("returns size after a successful write", async () => {
    const stored = await mod.storeFile(makeFile("12345", "five.txt"));
    const s = await mod.statFile(stored.key);
    expect(s).toEqual({ size: 5 });
  });

  test("returns null for an unknown key", async () => {
    const s = await mod.statFile("nonexistent__file.txt");
    expect(s).toBeNull();
  });
});

describe("openReadStream", () => {
  test("round-trips the bytes from disk", async () => {
    const stored = await mod.storeFile(makeFile("round-trip", "rt.txt"));
    const stream = mod.openReadStream(stored.key);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    const all = Buffer.concat(chunks).toString("utf8");
    expect(all).toBe("round-trip");
  });

  test("ranged read returns the exact inclusive slice", async () => {
    // Both bounds inclusive — matches fs.createReadStream AND the
    // HTTP Range contract the download route serves 206s from.
    const stored = await mod.storeFile(makeFile("0123456789", "r.bin"));
    const stream = mod.openReadStream(stored.key, { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("2345");
  });
});

describe("deleteFile", () => {
  test("removes the file on disk", async () => {
    const stored = await mod.storeFile(makeFile("byebye", "x.txt"));
    expect(await mod.statFile(stored.key)).not.toBeNull();
    await mod.deleteFile(stored.key);
    expect(await mod.statFile(stored.key)).toBeNull();
  });

  test("missing file is a no-op (best-effort delete)", async () => {
    // No throw — delete on a key that was never written is fine
    // because the DB row may already be gone.
    await expect(
      mod.deleteFile("never-existed__file.txt")
    ).resolves.toBeUndefined();
  });
});

describe("path-traversal guard", () => {
  test("statFile refuses keys that escape STORAGE_ROOT", async () => {
    await expect(
      mod.statFile("../../../etc/passwd")
    ).rejects.toThrow(/STORAGE_ROOT/);
  });

  test("deleteFile refuses keys that escape STORAGE_ROOT", async () => {
    await expect(mod.deleteFile("../escape")).rejects.toThrow(
      /STORAGE_ROOT/
    );
  });

  test("openReadStream refuses keys that escape STORAGE_ROOT", () => {
    expect(() => mod.openReadStream("../../escape")).toThrow(/STORAGE_ROOT/);
  });
});
