import { afterEach, describe, expect, test, vi } from "vitest";
import { UserFacingError, toUserMessage } from "@/lib/user-facing-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toUserMessage", () => {
  test("passes a UserFacingError message through without logging", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(toUserMessage(new UserFacingError("Nothing to bill"), "x", "ctx")).toBe(
      "Nothing to bill"
    );
    expect(spy).not.toHaveBeenCalled();
  });

  test("replaces any other error with the fallback and logs the original", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("Invalid `prisma.invoice.create()` invocation in /var/task/x.js");
    expect(toUserMessage(boom, "Couldn't generate invoice.", "billing")).toBe(
      "Couldn't generate invoice."
    );
    expect(spy).toHaveBeenCalledWith("[billing]", boom);
  });

  test("non-Error throws also get the fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(toUserMessage("weird", "fallback", "ctx")).toBe("fallback");
  });
});
