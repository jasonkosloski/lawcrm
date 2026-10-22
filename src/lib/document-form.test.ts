import { describe, expect, test } from "vitest";
import { parseUploadMeta } from "./document-form";

describe("parseUploadMeta", () => {
  test("defaults: empty name, category other", () => {
    expect(parseUploadMeta({})).toEqual({ name: "", category: "other" });
  });

  test("trims the display name and accepts a known category", () => {
    expect(parseUploadMeta({ name: "  Complaint v2 ", category: "pleading" })).toEqual({
      name: "Complaint v2",
      category: "pleading",
    });
  });

  test("rejects an unknown category", () => {
    expect(parseUploadMeta({ category: "secrets" })).toBeNull();
    expect(parseUploadMeta({ category: 5 })).toBeNull();
  });

  test("rejects a name over 200 chars", () => {
    expect(parseUploadMeta({ name: "x".repeat(201) })).toBeNull();
    expect(parseUploadMeta({ name: "x".repeat(200) })).not.toBeNull();
  });

  test("non-string name is treated as empty", () => {
    expect(parseUploadMeta({ name: 42 })).toEqual({
      name: "",
      category: "other",
    });
  });
});
