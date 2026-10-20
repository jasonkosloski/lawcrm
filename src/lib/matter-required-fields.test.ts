import { describe, it, expect } from "vitest";
import {
  REQUIRED_MATTER_FIELDS,
  isRequiredMatterField,
  missingRequired,
  clearedRequired,
  requiredFieldError,
  requiredKeysFor,
  REQUIRED_FIELD_INPUT_NAME,
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

describe("requiredKeysFor", () => {
  it("is empty without an area", () => {
    expect(requiredKeysFor(null)).toEqual([]);
  });

  it("tolerates a null or undefined list", () => {
    expect(
      requiredKeysFor({ requiredMatterFields: null, hasStatuteOfLimitations: true }),
    ).toEqual([]);
    expect(
      requiredKeysFor({ requiredMatterFields: undefined, hasStatuteOfLimitations: true }),
    ).toEqual([]);
  });

  it("keeps the area's recognised keys in order", () => {
    expect(
      requiredKeysFor({
        requiredMatterFields: ["court", "bogus", "venue"],
        hasStatuteOfLimitations: false,
      }),
    ).toEqual(["court", "venue"]);
  });

  it("counts incidentDate only when the area tracks SOL", () => {
    const fields = ["incidentDate", "court"];
    expect(
      requiredKeysFor({ requiredMatterFields: fields, hasStatuteOfLimitations: false }),
    ).toEqual(["court"]);
    expect(
      requiredKeysFor({ requiredMatterFields: fields, hasStatuteOfLimitations: true }),
    ).toEqual(["incidentDate", "court"]);
  });
});

describe("REQUIRED_FIELD_INPUT_NAME", () => {
  it("maps every required key to its form control name", () => {
    expect(Object.keys(REQUIRED_FIELD_INPUT_NAME).sort()).toEqual(
      REQUIRED_MATTER_FIELDS.map((f) => f.key).sort(),
    );
    expect(REQUIRED_FIELD_INPUT_NAME.venue).toBe("venueId");
    expect(REQUIRED_FIELD_INPUT_NAME.client).toBe("clientId");
    expect(REQUIRED_FIELD_INPUT_NAME.description).toBe("description");
  });
});
