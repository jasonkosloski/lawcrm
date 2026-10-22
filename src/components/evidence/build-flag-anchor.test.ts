/**
 * Pure rules behind the flag composer's anchor fields (F1000).
 */

import { describe, expect, test } from "vitest";
import { MAX_PDF_PAGE, MAX_QUOTE_CHARS } from "@/lib/flag-anchor";
import { buildFlagAnchor, type FlagAnchorText } from "./build-flag-anchor";

const blank: FlagAnchorText = {
  timeText: "",
  endText: "",
  pageText: "",
  quoteText: "",
};
const text = (patch: Partial<FlagAnchorText>): FlagAnchorText => ({
  ...blank,
  ...patch,
});

describe("buildFlagAnchor — time + transcript quote", () => {
  test("a selected transcript passage rides with the span, trimmed and capped", () => {
    expect(
      buildFlagAnchor(
        "time",
        text({ timeText: "1:15", endText: "2:30", quoteText: "  red light " }),
        false
      )
    ).toEqual({
      ok: true,
      anchor: { timeSeconds: 75, endSeconds: 150, quote: "red light" },
    });
    const res = buildFlagAnchor(
      "time",
      text({ timeText: "1:15", quoteText: "x".repeat(MAX_QUOTE_CHARS + 9) }),
      false
    );
    expect(res.ok && res.anchor.quote).toHaveLength(MAX_QUOTE_CHARS);
  });

  test("a quote never stands in for the time", () => {
    const res = buildFlagAnchor("time", text({ timeText: "", quoteText: "red light" }), false);
    expect(res.ok).toBe(false);
  });
});

describe("buildFlagAnchor — time", () => {
  test("point moment", () => {
    expect(buildFlagAnchor("time", text({ timeText: "1:15" }), false)).toEqual({
      ok: true,
      anchor: { timeSeconds: 75 },
    });
  });

  test("span with a later end", () => {
    expect(
      buildFlagAnchor("time", text({ timeText: "1:15", endText: "2:30" }), false)
    ).toEqual({ ok: true, anchor: { timeSeconds: 75, endSeconds: 150 } });
  });

  test.each([
    [{ timeText: "abc" }, /start time/i],
    [{ timeText: "" }, /start time/i],
    [{ timeText: "1:15", endText: "x" }, /span end must be a clock/i],
    [{ timeText: "1:15", endText: "1:15" }, /after the start/i],
    [{ timeText: "1:15", endText: "0:30" }, /after the start/i],
  ])("rejects %o", (patch, message) => {
    const res = buildFlagAnchor("time", text(patch), false);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(message);
  });
});

describe("buildFlagAnchor — page", () => {
  test("a quote selected on a page rides with the page", () => {
    expect(buildFlagAnchor("page", text({ pageText: "4", quoteText: "  red light " }), false)).toEqual({
      ok: true,
      anchor: { pageNumber: 4, quote: "red light" },
    });
  });

  test("an optional last page makes a span; same/blank last page means one page", () => {
    expect(buildFlagAnchor("page", text({ pageText: "4", endPageText: "6" }), false)).toEqual({
      ok: true,
      anchor: { pageNumber: 4, endPageNumber: 6 },
    });
    expect(buildFlagAnchor("page", text({ pageText: "4", endPageText: "4" }), false)).toEqual({
      ok: true,
      anchor: { pageNumber: 4 },
    });
    expect(buildFlagAnchor("page", text({ pageText: "4", endPageText: " " }), false)).toEqual({
      ok: true,
      anchor: { pageNumber: 4 },
    });
  });

  test.each([
    ["before the first", { pageText: "6", endPageText: "4" }, /before the first/i],
    ["not a number", { pageText: "6", endPageText: "x" }, /whole number/i],
    ["too long", { pageText: "1", endPageText: "40" }, /at most 25 pages/i],
    ["no first page", { pageText: "", endPageText: "3" }, /needs its first page/i],
  ])("span errors: last page %s", (_label, fields, msg) => {
    const res = buildFlagAnchor("page", text(fields), false);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(msg);
  });

  test("a quote without its page is an error, not a silent whole-document flag", () => {
    const res = buildFlagAnchor("page", text({ pageText: "", quoteText: "red light" }), false);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/needs the page/i);
  });

  test("blank page means a whole-document flag on create", () => {
    expect(buildFlagAnchor("page", text({ pageText: "  " }), false)).toEqual({
      ok: true,
      anchor: {},
    });
  });

  test("blank page is an error on edit (the kind is locked)", () => {
    const res = buildFlagAnchor("page", text({ pageText: "" }), true);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/enter a page number/i);
  });

  test("a valid page", () => {
    expect(buildFlagAnchor("page", text({ pageText: " 12 " }), false)).toEqual({
      ok: true,
      anchor: { pageNumber: 12 },
    });
  });

  test.each(["0", "1.5", "-3", "twelve", String(MAX_PDF_PAGE + 1)])(
    "rejects page %s",
    (pageText) => {
      expect(buildFlagAnchor("page", text({ pageText }), false).ok).toBe(false);
    }
  );

  test("the cap itself is accepted", () => {
    expect(
      buildFlagAnchor("page", text({ pageText: String(MAX_PDF_PAGE) }), false)
    ).toEqual({ ok: true, anchor: { pageNumber: MAX_PDF_PAGE } });
  });
});

describe("buildFlagAnchor — quote", () => {
  test("trims and keeps the text", () => {
    expect(
      buildFlagAnchor("quote", text({ quoteText: "  I don't recall.  " }), false)
    ).toEqual({ ok: true, anchor: { quote: "I don't recall." } });
  });

  test("caps at MAX_QUOTE_CHARS", () => {
    const res = buildFlagAnchor(
      "quote",
      text({ quoteText: "x".repeat(MAX_QUOTE_CHARS + 50) }),
      false
    );
    expect(res.ok && res.anchor.quote).toHaveLength(MAX_QUOTE_CHARS);
  });

  test("blank quote is an error", () => {
    const res = buildFlagAnchor("quote", text({ quoteText: "   " }), false);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/can't be empty/i);
  });
});

describe("buildFlagAnchor — document", () => {
  test("carries no anchor fields", () => {
    expect(buildFlagAnchor("document", blank, false)).toEqual({
      ok: true,
      anchor: {},
    });
  });
});
