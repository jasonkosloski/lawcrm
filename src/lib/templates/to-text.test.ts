import { describe, expect, it } from "vitest";
import { resolvedToText } from "./to-text";
import { renderFixture } from "./converters-fixture";

describe("resolvedToText", () => {
  it("separates blocks with blank lines, renders lists and tables", () => {
    const text = resolvedToText(renderFixture());
    expect(text).toContain("Re: <b>Notice</b>\n\nDear ");
    expect(text).toContain("- one\n- two");
    expect(text).toContain("1. first");
    expect(text).toContain("A\tB\n1\t2");
    expect(text).toContain("[Signer bar number — not on file]");
    expect(text.endsWith("End")).toBe(true);
  });
  it("is empty for an empty doc", () => {
    expect(resolvedToText({ type: "doc" })).toBe("");
  });
});
