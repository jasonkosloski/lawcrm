import { describe, it, expect } from "vitest";
import {
  REQUIRED_MATTER_FIELDS,
  isRequiredMatterField,
  missingRequired,
  clearedRequired,
  requiredFieldError,
} from "./matter-required-fields";

describe("matter required fields", () => {
  it("lists the ten keys in order with labels", () => {
    expect(REQUIRED_MATTER_FIELDS.map((f) => f.key)).toEqual([
      "venue",
      "caseNumber",
      "court",
      "filedDate",
      "trialDate",
      "incidentDate",
      "opposingParty",
      "opposingFirm",
      "description",
      "client",
    ]);
    expect(REQUIRED_MATTER_FIELDS.find((f) => f.key === "description")?.label).toBe("Summary");
  });

  it("isRequiredMatterField narrows known keys", () => {
    expect(isRequiredMatterField("court")).toBe(true);
    expect(isRequiredMatterField("nope")).toBe(false);
  });

  it("missingRequired treats whitespace as empty", () => {
    expect(missingRequired(["caseNumber", "venue"], { caseNumber: "  ", venue: "v1" })).toEqual(["caseNumber"]);
  });

  it("missingRequired ignores unknown keys and flags absent values", () => {
    expect(missingRequired(["bogus", "court"], {})).toEqual(["court"]);
  });

  it("clearedRequired flags non-empty before and empty after", () => {
    expect(clearedRequired(["court"], { court: "D. Colo" }, { court: "" })).toEqual(["court"]);
  });

  it("clearedRequired ignores already-empty fields", () => {
    expect(clearedRequired(["court"], { court: null }, { court: "" })).toEqual([]);
  });

  it("exports the error message", () => {
    expect(requiredFieldError).toBe("Required for this practice area.");
  });
});
