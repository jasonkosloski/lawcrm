import { describe, expect, it } from "vitest";
import {
  FIELDS,
  FIELD_GROUPS,
  LISTS,
  SAMPLE_TEMPLATE_DATA,
  fieldByPath,
  fieldsForScope,
  listByPath,
} from "./catalog";
import { formatFieldValue } from "./format";

/** Keys the removed `template-merge.ts` engine supported; stored legacy
 *  `{{token}}` bodies still use them. */
const LEGACY_KEYS = [
  "matter.name",
  "matter.caseNumber",
  "matter.practiceArea",
  "matter.stage",
  "matter.court",
  "matter.opposingParty",
  "matter.incidentDate",
  "matter.solDate",
  "client.name",
  "client.email",
  "client.phone",
  "client.address",
  "firm.name",
  "firm.addressLine1",
  "firm.addressLine2",
  "firm.cityStateZip",
  "firm.phone",
  "firm.email",
  "request.subject",
  "request.description",
  "request.type",
  "request.dateRangeStart",
  "request.dateRangeEnd",
  "request.responseDueDate",
  "request.sentDate",
  "custodian.name",
  "custodian.organization",
  "custodian.address",
  "custodian.email",
  "custodian.phone",
  "user.name",
  "today",
];

describe("catalog", () => {
  it("every legacy key resolves", () => {
    for (const key of LEGACY_KEYS) {
      expect(fieldByPath(key), key).toBeDefined();
    }
  });

  it("seeded block paths exist", () => {
    for (const p of [
      "firm.name",
      "firm.address",
      "firm.phone",
      "firm.email",
      "signer.name",
      "signer.title",
      "signer.barNumber",
    ]) {
      expect(fieldByPath(p), p).toBeDefined();
    }
    expect(fieldByPath("firm.address")?.type).toBe("address");
    expect(fieldByPath("firm.address")?.formats).toContain("one_line");
  });

  it("paths are unique", () => {
    const paths = FIELDS.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("every field's group is a known group and defaultFormat is allowed", () => {
    for (const f of FIELDS) {
      expect(FIELD_GROUPS, f.path).toContain(f.group);
      if (f.defaultFormat) expect(f.formats, f.path).toContain(f.defaultFormat);
    }
  });

  it("groups are in the specified order", () => {
    expect([...FIELD_GROUPS]).toEqual([
      "Firm",
      "Today & user",
      "Matter",
      "Lead",
      "Client",
      "Signer",
      "Recipient",
      "Parties",
      "Records request",
    ]);
  });

  it("every field resolves non-null on the sample data", () => {
    for (const f of FIELDS) {
      expect(f.get(SAMPLE_TEMPLATE_DATA), f.path).not.toBeNull();
    }
  });

  it("every list has >= 2 sample items and item fields resolve", () => {
    for (const l of LISTS) {
      const items = l.get(SAMPLE_TEMPLATE_DATA);
      expect(items.length, l.path).toBeGreaterThanOrEqual(2);
      for (const f of l.itemFields) {
        expect(f.get(SAMPLE_TEMPLATE_DATA, items[0]), `${l.path}:${f.path}`).not.toBeNull();
      }
    }
  });

  it("listByPath", () => {
    expect(listByPath("parties.defendants")?.scopes).toEqual(["matter"]);
    expect(listByPath("team")?.scopes).toEqual(["matter", "lead"]);
    expect(listByPath("nope")).toBeUndefined();
    for (const p of [
      "parties.clients",
      "parties.opposing",
      "parties.defendants",
      "parties.plaintiffs",
      "parties.opposingCounsel",
      "parties.witnesses",
      "parties.experts",
      "team",
    ])
      expect(listByPath(p), p).toBeDefined();
  });

  it("fieldsForScope", () => {
    const lead = fieldsForScope("lead").map((f) => f.path);
    expect(lead).not.toContain("matter.caseNumber");
    expect(lead).toContain("lead.name");
    expect(lead).toContain("client.name");
    const matter = fieldsForScope("matter").map((f) => f.path);
    expect(matter).toContain("matter.caseNumber");
    expect(matter).not.toContain("lead.name");
    const both = fieldsForScope("both").map((f) => f.path);
    expect(both.some((p) => p.startsWith("matter."))).toBe(false);
    expect(both.some((p) => p.startsWith("lead."))).toBe(false);
    expect(both).toContain("firm.name");
  });

  it("sample date-only fields format without zone shift", () => {
    const f = fieldByPath("matter.incidentDate")!;
    expect(formatFieldValue(f, f.get(SAMPLE_TEMPLATE_DATA), "long", "Pacific/Honolulu")).toBe(
      "June 1, 2025",
    );
  });

  it("today formats in the data time zone", () => {
    const f = fieldByPath("today")!;
    expect(f.dateOnly).toBeFalsy();
    expect(formatFieldValue(f, new Date(Date.UTC(2026, 3, 15, 2)), "long", "America/Denver")).toBe(
      "April 14, 2026",
    );
  });

  it("legacy keys keep their legacy-compatible text on sample data", () => {
    const f = fieldByPath("firm.cityStateZip")!;
    expect(formatFieldValue(f, f.get(SAMPLE_TEMPLATE_DATA), null, null)).toBe(
      "Sampletown, CO 80000",
    );
  });
});
