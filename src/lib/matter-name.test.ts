import { describe, expect, test } from "vitest";
import { looksLikeOrganization, splitName } from "./matter-name";

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
    (n) => expect(looksLikeOrganization(n)).toBe(true),
  );
  test.each(["Maria Alvarez", "Mary Jane Watson", "Madonna", "Funderburk"])("%s is a person", (n) =>
    expect(looksLikeOrganization(n)).toBe(false),
  );
});
