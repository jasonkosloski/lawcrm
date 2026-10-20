import { describe, expect, test } from "vitest";
import { agreementGateErrors, originatingDocLabel } from "./originating-doc";

const today = "2026-10-20";

describe("originatingDocLabel", () => {
  test("falls back to Fee agreement", () => {
    expect(originatingDocLabel(null)).toBe("Fee agreement");
    expect(originatingDocLabel({ originatingDocLabel: null })).toBe("Fee agreement");
    expect(originatingDocLabel({ originatingDocLabel: "" })).toBe("Fee agreement");
    expect(originatingDocLabel({ originatingDocLabel: "  " })).toBe("Fee agreement");
  });
  test("uses the trimmed area label", () => {
    expect(originatingDocLabel({ originatingDocLabel: " Retainer " })).toBe("Retainer");
  });
});

describe("agreementGateErrors", () => {
  test("required + nothing -> all three errors with label", () => {
    const e = agreementGateErrors(
      { status: "", signedDate: "", hasOriginatingFile: false },
      { required: true, label: "Retainer", today }
    );
    expect(Object.keys(e).sort()).toEqual([
      "agreementSignedDate",
      "agreementStatus",
      "originatingFileId",
    ]);
    expect(e.originatingFileId).toBe("Attach the signed Retainer.");
    expect(e.agreementStatus).toBe("Mark the Retainer as signed.");
    expect(e.agreementSignedDate).toBe("Enter the date it was signed.");
  });
  test("future date errors; today does not", () => {
    const base = { status: "signed", hasOriginatingFile: true };
    const opts = { required: true, label: "Fee agreement", today };
    expect(
      agreementGateErrors({ ...base, signedDate: "2026-10-21" }, opts).agreementSignedDate
    ).toBeTruthy();
    expect(agreementGateErrors({ ...base, signedDate: today }, opts)).toEqual({});
  });
  test("not required + empty -> {}", () => {
    expect(
      agreementGateErrors(
        { status: "", signedDate: "", hasOriginatingFile: false },
        { required: false, label: "x", today }
      )
    ).toEqual({});
  });
  test("not required: malformed or future date still errors", () => {
    const opts = { required: false, label: "x", today };
    expect(
      agreementGateErrors({ status: "", signedDate: "garbage", hasOriginatingFile: false }, opts)
        .agreementSignedDate
    ).toBeTruthy();
    expect(
      agreementGateErrors({ status: "", signedDate: "2027-01-01", hasOriginatingFile: false }, opts)
        .agreementSignedDate
    ).toBeTruthy();
  });
  test("unknown status errors", () => {
    expect(
      agreementGateErrors(
        { status: "bogus", signedDate: "", hasOriginatingFile: true },
        { required: false, label: "x", today }
      ).agreementStatus
    ).toBeTruthy();
  });
});
