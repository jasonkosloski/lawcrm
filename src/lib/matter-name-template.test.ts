import { describe, expect, test } from "vitest";
import {
  DEFAULT_MATTER_NAME_TEMPLATE as D,
  effectiveTemplate,
  parseTemplate,
  renderMatterName,
  type MatterNameInput,
} from "./matter-name-template";

const base: MatterNameInput = {
  clientName: "",
  caseNumber: "",
  venue: null,
  opposingParty: "",
  practiceAreaName: "",
  now: new Date("2026-06-01T12:00:00Z"),
  timeZone: "America/Denver",
};
const aurora = { name: "Aurora", county: "Arapahoe", state: "CO" };
const r = (tpl: string, o: Partial<MatterNameInput>) => renderMatterName(tpl, { ...base, ...o });

describe("default template (old autoMatterName cases)", () => {
  test("full pattern", () => {
    expect(r(D, { clientName: "Maria Alvarez", caseNumber: "2026-CV-00481", venue: aurora })).toBe(
      "Alvarez, Maria - 2026-CV-00481 - Aurora",
    );
  });
  test("partial fills", () => {
    expect(r(D, { clientName: "Maria Alvarez", venue: aurora })).toBe("Alvarez, Maria - Aurora");
    expect(r(D, { caseNumber: "2026-CV-1" })).toBe("2026-CV-1");
    expect(r(D, {})).toBe("");
  });
  test("organizations are not inverted", () => {
    expect(r(D, { clientName: "Colorado Freedom Fund", caseNumber: "2026-CV-00481" })).toBe(
      "Colorado Freedom Fund - 2026-CV-00481",
    );
    expect(r(D, { clientName: "Rocky Mountain Advocates", isOrganization: true })).toBe(
      "Rocky Mountain Advocates",
    );
  });
  test("suffix follows the first name", () => {
    expect(r(D, { clientName: "Maria Alvarez Jr." })).toBe("Alvarez, Maria Jr.");
  });
  test("first name only / last name only", () => {
    expect(r(D, { clientName: "Madonna" })).toBe("Madonna");
  });
});

describe("custom templates", () => {
  test("empty trailing token drops its literal", () => {
    expect(r("{client_last} v. {opposing_party}", { clientName: "Maria Alvarez" })).toBe("Alvarez");
  });
  test("all tokens empty gives empty string", () => {
    expect(r("State v. {client_last} - {case_number}", {})).toBe("");
  });
  test("partial", () => {
    expect(r("State v. {client_last} - {case_number}", { clientName: "Maria Alvarez" })).toBe(
      "State v. Alvarez",
    );
  });
  test("venue tokens, and null venue drops them", () => {
    expect(r("{county} {state} {location}", { venue: aurora, clientName: "x" })).toBe(
      "Arapahoe CO Aurora",
    );
    expect(r("{client_full} - {county}/{state}/{location}", { clientName: "Maria Alvarez" })).toBe(
      "Maria Alvarez",
    );
  });
  test("year uses the firm zone", () => {
    expect(r("{year}", { now: new Date("2026-01-01T03:00:00Z") })).toBe("2025");
  });
  test("invalid template renders empty", () => {
    expect(r("{foo}", { clientName: "Maria Alvarez" })).toBe("");
  });
});

describe("parseTemplate", () => {
  test("unknown token names it", () => {
    const p = parseTemplate("{foo}");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toContain("foo");
  });
  test("unbalanced", () => {
    const p = parseTemplate("{client_last");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(/unbalanced/i);
  });
  test("no tokens", () => {
    expect(parseTemplate("no tokens").ok).toBe(false);
  });
  test("valid", () => {
    const p = parseTemplate("a {year} b");
    expect(p).toEqual({
      ok: true,
      segments: [
        { kind: "literal", text: "a " },
        { kind: "token", token: "year" },
        { kind: "literal", text: " b" },
      ],
    });
  });
});

describe("effectiveTemplate", () => {
  test("falls back to the firm template", () => {
    expect(effectiveTemplate({ matterNameTemplate: null }, D)).toBe(D);
    expect(effectiveTemplate(null, D)).toBe(D);
    expect(effectiveTemplate({ matterNameTemplate: "X {year}" }, D)).toBe("X {year}");
  });
});
