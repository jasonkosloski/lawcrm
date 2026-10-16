import { describe, expect, it } from "vitest";
import { stripNul, stripNulOrNull } from "./strip-nul";

describe("stripNul", () => {
  it("removes every NUL and leaves other text untouched", () => {
    expect(stripNul("a\u0000b\u0000\u0000c")).toBe("abc");
    expect(stripNul("plain \t\n text")).toBe("plain \t\n text");
    expect(stripNul("")).toBe("");
  });

  it("null-tolerant variant", () => {
    expect(stripNulOrNull(null)).toBeNull();
    expect(stripNulOrNull(undefined)).toBeNull();
    expect(stripNulOrNull("x\u0000y")).toBe("xy");
  });
});
