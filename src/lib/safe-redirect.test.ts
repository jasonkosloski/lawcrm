import { describe, expect, test } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  test.each([
    ["/", "/"],
    ["/dashboard", "/dashboard"],
    ["/matters/abc?tab=notes&x=1#frag", "/matters/abc?tab=notes&x=1#frag"],
    ["/matters/a%20b?q=%5Cx", "/matters/a%20b?q=%5Cx"],
    // Literal percent-encoded backslash is a same-origin path segment.
    ["/%5Cevil.example", "/%5Cevil.example"],
  ])("keeps safe path %j", (input, out) => {
    expect(safeRedirectPath(input)).toBe(out);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["absolute https", "https://evil.example"],
    ["absolute http", "http://evil.example/x"],
    ["javascript scheme", "javascript:alert(1)"],
    ["no leading slash", "evil.example"],
    ["protocol-relative", "//evil.example"],
    ["slash backslash", "/\\evil.example"],
    ["backslash slash", "\\/evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["slash tab slash", "/\t/evil.example"],
    ["slash newline slash", "/\n/evil.example"],
    ["slash CR slash", "/\r/evil.example"],
    ["tab inside path", "/ok\tpath"],
    ["trailing newline", "/ok\n"],
    ["NUL", "/ok\u0000"],
    ["DEL", "/ok\u007f"],
    ["backslash in query", "/ok?x=\\y"],
  ])("rejects %s", (_name, input) => {
    expect(safeRedirectPath(input as string | null | undefined)).toBe("/");
  });
});
