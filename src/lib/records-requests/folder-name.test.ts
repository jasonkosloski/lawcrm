import { describe, expect, it } from "vitest";
import {
  RECORDS_INVESTIGATION_FOLDER_NAME,
  RECORDS_ROOT_FOLDER_NAME,
  recordsFolderName,
} from "./folder-name";

describe("recordsFolderName", () => {
  it("trims, collapses whitespace and joins with an em dash", () => {
    expect(recordsFolderName(" Memorial  Hospital ", "Medical (HIPAA)")).toBe(
      "Memorial Hospital — Medical (HIPAA)",
    );
  });

  it("replaces slashes and backslashes with hyphens", () => {
    expect(recordsFolderName("A/B\\C", "Pay/Roll")).toBe("A-B-C — Pay-Roll");
  });

  it("caps the result at 120 characters", () => {
    const long = "x".repeat(200);
    expect(recordsFolderName(long, long).length).toBeLessThanOrEqual(120);
  });

  it("exposes the parent folder names", () => {
    expect(RECORDS_INVESTIGATION_FOLDER_NAME).toBe("Investigation");
    expect(RECORDS_ROOT_FOLDER_NAME).toBe("Records Requests");
  });
});
