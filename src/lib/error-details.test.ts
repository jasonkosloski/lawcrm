import { describe, expect, test } from "vitest";
import { errorDetails } from "./error-details";

describe("errorDetails", () => {
  test("reads message and digest from an Error", () => {
    const e = Object.assign(new Error("boom"), { digest: "abc123" });
    expect(errorDetails(e)).toEqual({ message: "boom", digest: "abc123" });
  });

  test("a non-Error thrown value never throws and yields no message", () => {
    expect(errorDetails("a string")).toEqual({ message: null, digest: null });
    expect(errorDetails(null)).toEqual({ message: null, digest: null });
    expect(errorDetails(undefined)).toEqual({ message: null, digest: null });
    expect(errorDetails(42)).toEqual({ message: null, digest: null });
  });

  test("an object with a digest but no Error shape still surfaces the digest", () => {
    expect(errorDetails({ digest: "d1" })).toEqual({
      message: null,
      digest: "d1",
    });
  });

  test("ignores a non-string digest and an empty message", () => {
    const e = Object.assign(new Error(""), { digest: 7 });
    expect(errorDetails(e)).toEqual({ message: null, digest: null });
  });
});
