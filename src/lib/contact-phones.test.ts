import { describe, expect, test } from "vitest";
import {
  parsePhonesJson,
  phonesSignature,
  MAX_PHONES_PER_CONTACT,
} from "./contact-phones";
import {
  isOpposingCounselRole,
  representationFlag,
} from "./party-constants";

describe("parsePhonesJson", () => {
  test("parses and normalizes to exactly one primary", () => {
    const r = parsePhonesJson(
      JSON.stringify([
        { label: " Mobile ", number: " 555-0100 ", isPrimary: true },
        { label: "", number: "555-0101", isPrimary: true },
      ])
    );
    expect(r).toEqual({
      ok: true,
      phones: [
        { label: "Mobile", number: "555-0100", isPrimary: true },
        { label: "", number: "555-0101", isPrimary: false },
      ],
    });
  });

  test("promotes the first entry when none is primary", () => {
    const r = parsePhonesJson(
      JSON.stringify([{ number: "1" }, { number: "2" }])
    );
    expect(r.ok && r.phones.map((p) => p.isPrimary)).toEqual([true, false]);
  });

  test("an explicit empty array is a valid clear-all", () => {
    expect(parsePhonesJson("[]")).toEqual({ ok: true, phones: [] });
  });

  test("drops blank numbers via normalization", () => {
    const r = parsePhonesJson(
      JSON.stringify([{ number: "  " }, { number: "555" }])
    );
    expect(r.ok && r.phones).toEqual([
      { label: "", number: "555", isPrimary: true },
    ]);
  });

  test.each([
    ["malformed JSON", "{nope"],
    ["not an array", JSON.stringify({ number: "1" })],
    ["label over 40", JSON.stringify([{ label: "x".repeat(41), number: "1" }])],
    ["number over 80", JSON.stringify([{ number: "9".repeat(81) }])],
    [
      "too many entries",
      JSON.stringify(
        Array.from({ length: MAX_PHONES_PER_CONTACT + 1 }, () => ({
          number: "1",
        }))
      ),
    ],
  ])("%s is an error, never an empty list", (_name, raw) => {
    expect(parsePhonesJson(raw).ok).toBe(false);
  });
});

describe("phonesSignature", () => {
  test("treats several stored primaries like the normalized list", () => {
    const a = phonesSignature([
      { label: "", number: "1", isPrimary: true },
      { label: "", number: "2", isPrimary: true },
    ]);
    const b = phonesSignature([
      { label: "", number: "1", isPrimary: true },
      { label: "", number: "2", isPrimary: false },
    ]);
    expect(a).toBe(b);
  });

  test("differs when a number or the primary changes", () => {
    const base = [
      { label: "", number: "1", isPrimary: true },
      { label: "", number: "2", isPrimary: false },
    ];
    expect(phonesSignature(base)).not.toBe(
      phonesSignature([{ ...base[0], number: "9" }, base[1]])
    );
    expect(phonesSignature(base)).not.toBe(
      phonesSignature([
        { ...base[0], isPrimary: false },
        { ...base[1], isPrimary: true },
      ])
    );
  });
});

describe("party constants helpers", () => {
  test("isOpposingCounselRole matches natural spellings only", () => {
    for (const r of [
      "opposing_counsel",
      "Opposing counsel",
      " opposing-counsel ",
      "OPPOSING ATTORNEY",
    ]) {
      expect(isOpposingCounselRole(r)).toBe(true);
    }
    for (const r of ["defendant", "counsel", "opposing", "", null, undefined]) {
      expect(isOpposingCounselRole(r)).toBe(false);
    }
  });

  test("representationFlag never persists for clients", () => {
    expect(representationFlag("yes", true)).toBeNull();
    expect(representationFlag("yes", false)).toBe(true);
    expect(representationFlag("no", false)).toBe(false);
    expect(representationFlag("unknown", false)).toBeNull();
  });
});
