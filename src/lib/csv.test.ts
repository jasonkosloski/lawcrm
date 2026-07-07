/**
 * Tests for the CSV building helpers.
 *
 * Pins the RFC 4180 escaping rules (quote wrapping + quote
 * doubling), the null/undefined → empty-cell contract, the
 * formula-injection guard (= and @ neutralized, + and − left alone
 * for phones/negatives), and the CRLF document shape.
 */

import { describe, expect, test } from "vitest";
import { buildCsv, csvEscape } from "./csv";

describe("csvEscape", () => {
  test("passes plain values through untouched", () => {
    expect(csvEscape("Dana Whitfield")).toBe("Dana Whitfield");
  });

  test("renders null and undefined as empty cells", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape("")).toBe("");
  });

  test("quotes cells containing a comma", () => {
    expect(csvEscape("Whitfield, Dana")).toBe('"Whitfield, Dana"');
  });

  test("quotes and doubles embedded double quotes", () => {
    expect(csvEscape('Dana "Dee" Whitfield')).toBe(
      '"Dana ""Dee"" Whitfield"'
    );
  });

  test("quotes cells containing line breaks", () => {
    expect(csvEscape("1 Main St\nSuite 4")).toBe('"1 Main St\nSuite 4"');
    expect(csvEscape("1 Main St\r\nSuite 4")).toBe('"1 Main St\r\nSuite 4"');
  });

  test("neutralizes leading = and @ (formula injection)", () => {
    expect(csvEscape("=HYPERLINK(\"http://evil\")")).toBe(
      "\"'=HYPERLINK(\"\"http://evil\"\")\""
    );
    expect(csvEscape("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
  });

  test("leaves leading + and - alone (phones, negatives)", () => {
    expect(csvEscape("+1 303-555-0101")).toBe("+1 303-555-0101");
    expect(csvEscape("-42")).toBe("-42");
  });
});

describe("buildCsv", () => {
  test("emits header + rows, CRLF-joined, with a trailing newline", () => {
    const csv = buildCsv(
      ["Name", "Email"],
      [
        ["Dana", "dana@example.com"],
        ["Riley, Jr.", null],
      ]
    );
    expect(csv).toBe(
      'Name,Email\r\nDana,dana@example.com\r\n"Riley, Jr.",\r\n'
    );
  });

  test("escapes header cells too", () => {
    expect(buildCsv(['A "B"'], [])).toBe('"A ""B"""\r\n');
  });

  test("handles zero data rows", () => {
    expect(buildCsv(["Name"], [])).toBe("Name\r\n");
  });
});
