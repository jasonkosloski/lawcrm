import { describe, expect, test } from "vitest";
import { DOCUMENT_CATEGORIES } from "@/lib/document-form";
import { documentCategoryLabel, documentStatusMeta, formatFileSize } from "./document-display";

describe("documentCategoryLabel", () => {
  test("every form category has a human label", () => {
    for (const c of DOCUMENT_CATEGORIES) {
      expect(documentCategoryLabel(c)).toMatch(/^[A-Z]/);
    }
    expect(documentCategoryLabel("expert_report")).toBe("Expert report");
  });
  test("unknown keys fall back to the raw key", () => {
    expect(documentCategoryLabel("medical_records")).toBe("medical_records");
  });
});

describe("documentStatusMeta", () => {
  test("known status", () => {
    expect(documentStatusMeta("review").label).toBe("Under review");
  });
  test("unknown status falls back to active", () => {
    expect(documentStatusMeta("bogus").label).toBe("Active");
  });
});

describe("formatFileSize", () => {
  test.each([
    [null, "—"],
    [0, "—"],
    [512, "512 B"],
    [2048, "2.0 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
  ])("%s -> %s", (n, out) => {
    expect(formatFileSize(n)).toBe(out);
  });
});
