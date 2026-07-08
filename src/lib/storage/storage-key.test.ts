/**
 * Tests for the shared (client-safe) storage-key scheme.
 *
 * This module runs in BOTH the browser (client-direct blob uploads
 * name their own pathname) and on the server (local driver + token
 * route validation), so what's pinned here is the cross-boundary
 * contract: key shape, sanitization, the isBlobKey discriminator,
 * and that client-generated keys always pass the server-side
 * validator (they'd be rejected by the token route otherwise).
 */

import { describe, expect, test } from "vitest";
import {
  isBlobKey,
  isValidStorageKey,
  makeStorageKey,
  sanitizeStorageName,
} from "./storage-key";

describe("makeStorageKey", () => {
  test("produces {16-char-base64url}__{name}", () => {
    const key = makeStorageKey("brief.pdf");
    expect(key).toMatch(/^[A-Za-z0-9_-]{16}__brief\.pdf$/);
  });

  test("two keys for the same name differ (collision guard)", () => {
    expect(makeStorageKey("scan.pdf")).not.toBe(makeStorageKey("scan.pdf"));
  });

  test("strips path separators + leading dots from the name", () => {
    const key = makeStorageKey("../../../etc/passwd");
    const [, suffix] = key.split("__");
    expect(suffix).not.toMatch(/[/\\]/);
    expect(suffix.startsWith(".")).toBe(false);
  });

  test("every generated key passes the server-side validator", () => {
    // The token route rejects invalid pathnames — a drift between
    // generator and validator would break ALL blob uploads.
    for (const name of [
      "brief.pdf",
      "bodycam 2026-01-04.mp4",
      "../sneaky\\name.txt",
      "x".repeat(300) + ".bin",
      "文件名.docx",
    ]) {
      expect(isValidStorageKey(makeStorageKey(name))).toBe(true);
    }
  });
});

describe("isValidStorageKey", () => {
  test("rejects shapes the app never generates", () => {
    for (const bad of [
      "no-separator.pdf",
      "short__x.pdf", // prefix under 16 chars
      "AAAAAAAAAAAAAAAA__", // empty name
      "AAAAAAAAAAAAAAAA__.env", // leading-dot name
      "AAAAAAAAAAAAAAAA__a/b.pdf", // path separator → fake folders
      "AAAAAAAAAAAAAAAA__a\\b.pdf",
      `AAAAAAAAAAAAAAAA__${"x".repeat(121)}`, // over length cap
      "https://x.public.blob.vercel-storage.com/k__f.pdf", // a URL is not a key
    ]) {
      expect(isValidStorageKey(bad), bad).toBe(false);
    }
  });

  test("accepts the canonical shape", () => {
    expect(isValidStorageKey("AAAAAAAAAAAAAAAA__exhibit A.pdf")).toBe(true);
  });
});

describe("sanitizeStorageName", () => {
  test("replaces separators/control chars, strips leading dots, caps length", () => {
    expect(sanitizeStorageName("a/b\\c\x00d.txt")).toBe("a_b_c_d.txt");
    expect(sanitizeStorageName("...hidden")).toBe("hidden");
    expect(sanitizeStorageName("y".repeat(200))).toHaveLength(120);
  });
});

describe("isBlobKey", () => {
  test("full https URLs are blob keys; bare keys are not", () => {
    expect(
      isBlobKey("https://x.public.blob.vercel-storage.com/k__f.pdf")
    ).toBe(true);
    expect(isBlobKey("AAAAAAAAAAAAAAAA__f.pdf")).toBe(false);
  });
});
