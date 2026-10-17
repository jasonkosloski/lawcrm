import { describe, expect, test } from "vitest";
import {
  autoMatterName,
  buildAutoMatterName,
  looksLikeOrganization,
  splitName,
} from "./matter-name";

describe("splitName", () => {
  test("splits on the last token", () => {
    expect(splitName("Maria Alvarez")).toEqual({
      firstName: "Maria",
      lastName: "Alvarez",
      suffix: "",
    });
    expect(splitName("Mary Jane Watson")).toEqual({
      firstName: "Mary Jane",
      lastName: "Watson",
      suffix: "",
    });
  });

  test("single-word and empty names", () => {
    expect(splitName("Madonna")).toEqual({
      firstName: "",
      lastName: "Madonna",
      suffix: "",
    });
    expect(splitName("   ")).toEqual({ firstName: "", lastName: "", suffix: "" });
  });

  test("a trailing suffix is not the surname", () => {
    expect(splitName("Maria Alvarez Jr.")).toEqual({
      firstName: "Maria",
      lastName: "Alvarez",
      suffix: "Jr.",
    });
    expect(splitName("John Smith III")).toMatchObject({
      firstName: "John",
      lastName: "Smith",
      suffix: "III",
    });
    expect(splitName("Dana Lee, Esq.")).toMatchObject({
      firstName: "Dana",
      lastName: "Lee",
      suffix: "Esq.",
    });
  });

  test("organization names are returned whole", () => {
    expect(splitName("Colorado Freedom Fund")).toEqual({
      firstName: "",
      lastName: "Colorado Freedom Fund",
      suffix: "",
    });
  });
});

describe("looksLikeOrganization", () => {
  test.each(["Acme LLC", "Acme, Inc.", "Colorado Freedom Fund", "City of Aurora"])(
    "%s is an organization",
    (n) => expect(looksLikeOrganization(n)).toBe(true)
  );
  test.each(["Maria Alvarez", "Mary Jane Watson", "Madonna", "Funderburk"])(
    "%s is a person",
    (n) => expect(looksLikeOrganization(n)).toBe(false)
  );
});

describe("autoMatterName", () => {
  test("the firm's pattern: Last, First - Case Number - Location", () => {
    expect(
      autoMatterName({
        clientName: "Maria Alvarez",
        caseNumber: "2026-CV-00481",
        location: "Aurora",
      })
    ).toBe("Alvarez, Maria - 2026-CV-00481 - Aurora");
  });

  test("partial fills join only the filled segments", () => {
    expect(
      autoMatterName({ clientName: "Maria Alvarez", caseNumber: "", location: "Aurora" })
    ).toBe("Alvarez, Maria - Aurora");
    expect(
      autoMatterName({ clientName: "", caseNumber: "2026-CV-1", location: "" })
    ).toBe("2026-CV-1");
    expect(autoMatterName({ clientName: "", caseNumber: "", location: "" })).toBe("");
  });

  test("organizations are not inverted ('Fund, Colorado Freedom' regression)", () => {
    expect(
      autoMatterName({
        clientName: "Colorado Freedom Fund",
        caseNumber: "2026-CV-00481",
        location: "",
      })
    ).toBe("Colorado Freedom Fund - 2026-CV-00481");
    // A picked contact known to be an organization, with an
    // organization-less looking name:
    expect(
      autoMatterName({
        clientName: "Rocky Mountain Advocates",
        isOrganization: true,
        caseNumber: "",
        location: "",
      })
    ).toBe("Rocky Mountain Advocates");
  });

  test("suffixes follow the first name ('Jr., Maria Alvarez' regression)", () => {
    expect(
      autoMatterName({ clientName: "Maria Alvarez Jr.", caseNumber: "", location: "" })
    ).toBe("Alvarez, Maria Jr.");
  });
});

describe("buildAutoMatterName", () => {
  test("first name only / last name only", () => {
    expect(
      buildAutoMatterName({ firstName: "Maria", lastName: "", caseNumber: "", location: "" })
    ).toBe("Maria");
    expect(
      buildAutoMatterName({ firstName: "", lastName: "Alvarez", caseNumber: "", location: "" })
    ).toBe("Alvarez");
  });
});
