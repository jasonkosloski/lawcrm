import { describe, expect, it } from "vitest";
import { smallCapsRuns } from "./small-caps";

describe("smallCapsRuns", () => {
  it("turns lowercase into small capitals and keeps capitals full size", () => {
    expect(smallCapsRuns("Sam v. Doe 2")).toEqual([
      { text: "S", small: false },
      { text: "AM", small: true },
      { text: " ", small: false },
      { text: "V", small: true },
      { text: ". D", small: false },
      { text: "OE", small: true },
      { text: " 2", small: false },
    ]);
  });

  it("handles letters whose capital is longer", () => {
    expect(smallCapsRuns("Straße")).toEqual([
      { text: "S", small: false },
      { text: "TRASSE", small: true },
    ]);
  });
});
