/**
 * Tests for the file-storage adapter. The adapter writes bytes to
 * the local filesystem under `./uploads/`; tests use a temp
 * directory under the OS temp dir to avoid touching the dev
 * uploads folder.
 *
 * Coverage:
 *   - storeFile writes the bytes + returns key/size/contentType
 *   - statFile reflects size after write; returns null for missing
 *   - openReadStream round-trips the bytes
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
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
