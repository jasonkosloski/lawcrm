import { describe, expect, test } from "vitest";
import { parseBarAdmissions } from "@/lib/bar-admissions";

describe("parseBarAdmissions", () => {
  test("absent field means leave unchanged", () => {
    expect(parseBarAdmissions(null)).toEqual({ ok: true, value: undefined });
  });

  test("normalizes states and trims numbers", () => {
    expect(parseBarAdmissions(JSON.stringify([{ state: "co", number: " 1 " }]))).toEqual({
      ok: true,
      value: [{ state: "CO", number: "1" }],
    });
  });

  test("rejects duplicate states, even by different spellings", () => {
    const r = parseBarAdmissions(
      JSON.stringify([
        { state: "CO", number: "1" },
        { state: "Colorado", number: "2" },
      ]),
    );
    expect(r.ok).toBe(false);
  });

  test("rejects unknown state, empty or long number, too many rows, bad JSON", () => {
    const bad = (v: unknown) => parseBarAdmissions(typeof v === "string" ? v : JSON.stringify(v));
    expect(bad([{ state: "Narnia", number: "1" }]).ok).toBe(false);
    expect(bad([{ state: "CO", number: "  " }]).ok).toBe(false);
    expect(bad([{ state: "CO", number: "x".repeat(41) }]).ok).toBe(false);
    expect(bad("{nope").ok).toBe(false);
    expect(bad({ state: "CO" }).ok).toBe(false);
    const many = Array.from({ length: 61 }, (_, i) => ({ state: "CO", number: String(i) }));
    expect(bad(many).ok).toBe(false);
  });

  test("empty array is a valid clear", () => {
    expect(parseBarAdmissions("[]")).toEqual({ ok: true, value: [] });
  });
});
