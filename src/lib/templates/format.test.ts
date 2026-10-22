import { describe, expect, it } from "vitest";
import type { CatalogField } from "./catalog";
import { formatFieldValue, joinList, splitName } from "./format";

const mk = (type: CatalogField["type"], extra: Partial<CatalogField> = {}): CatalogField => ({
  path: "x",
  label: "X",
  group: "Matter",
  type,
  scopes: ["matter", "lead"],
  formats: [],
  defaultFormat: null,
  get: () => null,
  ...extra,
});

describe("splitName", () => {
  it("splits on the last space", () => {
    expect(splitName("Mary Ann Smith")).toEqual({ first: "Mary Ann", last: "Smith" });
  });
  it("single word is both first and last", () => {
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "Cher" });
  });
  it("trims whitespace", () => {
    expect(splitName("  Ada  Lovelace ")).toEqual({ first: "Ada", last: "Lovelace" });
  });
});

describe("joinList", () => {
  it("and", () => {
    expect(joinList(["A"], "and")).toBe("A");
    expect(joinList(["A", "B"], "and")).toBe("A and B");
    expect(joinList(["A", "B", "C"], "and")).toBe("A, B and C");
  });
  it("oxford_and", () => {
    expect(joinList(["A"], "oxford_and")).toBe("A");
    expect(joinList(["A", "B"], "oxford_and")).toBe("A and B");
    expect(joinList(["A", "B", "C"], "oxford_and")).toBe("A, B, and C");
  });
  it("lines", () => {
    expect(joinList(["A"], "lines")).toBe("A");
    expect(joinList(["A", "B", "C"], "lines")).toBe("A\nB\nC");
  });
  it("empty", () => {
    expect(joinList([], "and")).toBe("");
  });
});

describe("formatFieldValue", () => {
  const instant = new Date(Date.UTC(2026, 9, 22, 3, 0)); // Oct 21 8pm in Denver
  const calendar = new Date(Date.UTC(2026, 9, 22));

  it("returns null for null", () => {
    expect(formatFieldValue(mk("text"), null, null, null)).toBeNull();
  });

  it("formats instants in the given zone", () => {
    const f = mk("date");
    expect(formatFieldValue(f, instant, "long", "America/Denver")).toBe("October 21, 2026");
    expect(formatFieldValue(f, instant, "long", "UTC")).toBe("October 22, 2026");
  });

  it("iso on an instant uses the zone's calendar day", () => {
    const f = mk("date");
    const d = new Date("2026-10-22T02:00:00Z");
    expect(formatFieldValue(f, d, "iso", "America/Denver")).toBe("2026-10-21");
    expect(formatFieldValue(f, d, "iso", "UTC")).toBe("2026-10-22");
  });

  it("date-only values never shift with the zone", () => {
    const f = mk("date", { dateOnly: true });
    expect(formatFieldValue(f, calendar, "long", "America/Los_Angeles")).toBe("October 22, 2026");
    expect(formatFieldValue(f, calendar, "short", "America/Los_Angeles")).toBe("10/22/2026");
    expect(formatFieldValue(f, calendar, "iso", "America/Los_Angeles")).toBe("2026-10-22");
  });

  it("date formats", () => {
    const f = mk("date", { dateOnly: true });
    expect(formatFieldValue(f, calendar, "long", null)).toBe("October 22, 2026");
    expect(formatFieldValue(f, calendar, "short", null)).toBe("10/22/2026");
    expect(formatFieldValue(f, calendar, "iso", null)).toBe("2026-10-22");
    expect(formatFieldValue(f, calendar, null, null)).toBe("October 22, 2026");
  });

  it("person first/last/full", () => {
    const f = mk("person");
    const v = { name: "Mary Smith" };
    expect(formatFieldValue(f, v, "full", null)).toBe("Mary Smith");
    expect(formatFieldValue(f, v, "first", null)).toBe("Mary");
    expect(formatFieldValue(f, v, "last", null)).toBe("Smith");
    expect(formatFieldValue(f, v, null, null)).toBe("Mary Smith");
    expect(formatFieldValue(f, { name: "Cher" }, "last", null)).toBe("Cher");
  });

  it("organizations always render full", () => {
    const f = mk("person");
    const v = { name: "Acme Hospital Inc", isOrganization: true };
    expect(formatFieldValue(f, v, "first", null)).toBe("Acme Hospital Inc");
    expect(formatFieldValue(f, v, "last", null)).toBe("Acme Hospital Inc");
  });

  it("text as_is and upper", () => {
    const f = mk("text");
    expect(formatFieldValue(f, "Hello", "as_is", null)).toBe("Hello");
    expect(formatFieldValue(f, "Hello", "upper", null)).toBe("HELLO");
    expect(formatFieldValue(f, "Hello", null, null)).toBe("Hello");
    expect(formatFieldValue(mk("enum"), "open", "upper", null)).toBe("OPEN");
  });

  it("address block and one_line", () => {
    const f = mk("address");
    const v = { lines: ["1 Main St", "Suite 2", "Denver, CO 80202"] };
    expect(formatFieldValue(f, v, "block", null)).toBe("1 Main St\nSuite 2\nDenver, CO 80202");
    expect(formatFieldValue(f, v, "one_line", null)).toBe("1 Main St, Suite 2, Denver, CO 80202");
    expect(formatFieldValue(f, v, null, null)).toBe("1 Main St, Suite 2, Denver, CO 80202");
  });

  it("empty address is null", () => {
    expect(formatFieldValue(mk("address"), { lines: [] }, "block", null)).toBeNull();
  });

  it("boolean", () => {
    expect(formatFieldValue(mk("boolean"), true, null, null)).toBe("Yes");
    expect(formatFieldValue(mk("boolean"), false, null, null)).toBe("No");
  });

  it("blank text is null", () => {
    expect(formatFieldValue(mk("text"), "   ", null, null)).toBeNull();
  });
});
