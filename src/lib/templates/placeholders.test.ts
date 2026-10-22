import { describe, expect, test } from "vitest";
import { hasTemplatePlaceholders } from "./placeholders";

describe("hasTemplatePlaceholders", () => {
  test.each([
    "Dear [Client name — not on file],",
    "Re {{client.nmae}}",
    "[Signature block — archived]",
    "Before [Missing block] after",
  ])("finds %s", (t) => expect(hasTemplatePlaceholders(t)).toBe(true));

  test.each(["Dear Maria,", "See [1] and {{ not a key }}", "[note — draft]"])("ignores %s", (t) =>
    expect(hasTemplatePlaceholders(t)).toBe(false),
  );
});
