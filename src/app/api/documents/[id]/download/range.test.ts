// @vitest-environment node

/**
 * Range-header resolution tests — pin the RFC 9110 byte math the
 * download route serves 206/416 from. Inclusive ends everywhere;
 * "malformed → ignore (200)" vs "syntactically valid but past EOF
 * → 416" is the distinction browsers actually rely on when seeking.
 */

import { describe, expect, test } from "vitest";
import { resolveRangeHeader } from "./range";

describe("resolveRangeHeader", () => {
  test("no header → full body", () => {
    expect(resolveRangeHeader(null, 10)).toEqual({ kind: "full" });
  });

  test("bounded range resolves inclusively", () => {
    expect(resolveRangeHeader("bytes=2-5", 10)).toEqual({
      kind: "partial",
      start: 2,
      end: 5,
    });
  });

  test("single byte range", () => {
    expect(resolveRangeHeader("bytes=0-0", 10)).toEqual({
      kind: "partial",
      start: 0,
      end: 0,
    });
  });

  test("open-ended range runs to EOF", () => {
    expect(resolveRangeHeader("bytes=4-", 10)).toEqual({
      kind: "partial",
      start: 4,
      end: 9,
    });
  });

  test("suffix range takes the last N bytes", () => {
    expect(resolveRangeHeader("bytes=-3", 10)).toEqual({
      kind: "partial",
      start: 7,
      end: 9,
    });
  });

  test("suffix longer than the file clamps to the whole file", () => {
    expect(resolveRangeHeader("bytes=-999", 10)).toEqual({
      kind: "partial",
      start: 0,
      end: 9,
    });
  });

  test("end past EOF clamps to the last byte", () => {
    expect(resolveRangeHeader("bytes=5-100", 10)).toEqual({
      kind: "partial",
      start: 5,
      end: 9,
    });
  });

  test("start at EOF is unsatisfiable (416)", () => {
    expect(resolveRangeHeader("bytes=10-", 10)).toEqual({
      kind: "unsatisfiable",
    });
    expect(resolveRangeHeader("bytes=99-120", 10)).toEqual({
      kind: "unsatisfiable",
    });
  });

  test("zero-length suffix is unsatisfiable", () => {
    expect(resolveRangeHeader("bytes=-0", 10)).toEqual({
      kind: "unsatisfiable",
    });
  });

  test("empty file: any range is unsatisfiable", () => {
    expect(resolveRangeHeader("bytes=0-", 0)).toEqual({
      kind: "unsatisfiable",
    });
    expect(resolveRangeHeader("bytes=-5", 0)).toEqual({
      kind: "unsatisfiable",
    });
  });

  test("malformed specs are ignored, not 416ed", () => {
    for (const header of [
      "bytes=abc",
      "bytes=5-2", // backwards
      "bytes=-", // neither bound
      "bytes", // no spec at all
      "items=0-3", // unknown unit
    ]) {
      expect(resolveRangeHeader(header, 10)).toEqual({ kind: "full" });
    }
  });

  test("multi-range is lawfully ignored (no multipart/byteranges)", () => {
    expect(resolveRangeHeader("bytes=0-1,4-5", 10)).toEqual({
      kind: "full",
    });
  });
});
