import { describe, expect, it } from "vitest";
import { addressLines, cityStateZip } from "./address";

describe("cityStateZip", () => {
  it("joins whatever parts exist", () => {
    expect(cityStateZip("Denver", "CO", "80202")).toBe("Denver, CO 80202");
    expect(cityStateZip(null, "CO", "80202")).toBe("CO 80202");
    expect(cityStateZip("Denver", null, null)).toBe("Denver");
    expect(cityStateZip(" ", null, "")).toBeNull();
    expect(cityStateZip(null, null, null)).toBeNull();
  });
});

describe("addressLines", () => {
  it("drops blank lines", () => {
    expect(
      addressLines({
        addressLine1: "1437 Bannock St",
        addressLine2: " ",
        city: "Denver",
        state: "CO",
        zip: "80202",
      }),
    ).toEqual(["1437 Bannock St", "Denver, CO 80202"]);
    expect(addressLines({})).toEqual([]);
  });
});
