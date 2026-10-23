import { describe, expect, it } from "vitest";
import { stateCode, US_STATES } from "./us-states";

describe("stateCode", () => {
  it("accepts codes and names, ignoring case, periods and spaces", () => {
    expect(stateCode("CO")).toBe("CO");
    expect(stateCode(" co ")).toBe("CO");
    expect(stateCode("C.O.")).toBe("CO");
    expect(stateCode("Colorado")).toBe("CO");
    expect(stateCode("new  york")).toBe("NY");
    expect(stateCode("District of Columbia")).toBe("DC");
    expect(stateCode("US Virgin Islands")).toBe("VI");
    expect(stateCode("U.S. Virgin Islands")).toBe("VI");
  });

  it("returns null for anything else", () => {
    for (const t of ["Colo.", "XX", "", null, undefined]) {
      expect(stateCode(t)).toBeNull();
    }
  });
});

describe("US_STATES", () => {
  it("has 56 unique codes", () => {
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(56);
  });
});
