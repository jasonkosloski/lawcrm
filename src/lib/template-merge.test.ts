/**
 * Unit tests for the template merge engine.
 *
 * Pins the three-way token semantics (resolved / missing / unknown),
 * the catalog's shape, and the TZ-aware date formatting — the parts
 * a letter actually depends on. UI wiring is not tested here.
 */

import { describe, expect, test } from "vitest";
import {
  MERGE_FIELDS,
  MERGE_FIELD_GROUPS,
  SAMPLE_MERGE_CONTEXT,
  composeCityStateZip,
  mergeTemplate,
  type MergeContext,
} from "@/lib/template-merge";

/** Fully-populated context with knowable values for assertions. */
const ctx: MergeContext = {
  matter: {
    name: "Alvarez v. City of Aurora",
    caseNumber: "2026-CV-00481",
    practiceArea: "Civil Rights",
    stage: "Discovery",
    court: "D. Colorado · Hon. L. Martinez",
    opposingParty: "City of Aurora",
    incidentDate: new Date(Date.UTC(2025, 0, 10, 12)), // Jan 10, 2025 noon UTC
    solDate: new Date(Date.UTC(2027, 0, 10, 12)),
  },
  client: {
    name: "Maria Alvarez",
    email: "maria@example.com",
    phone: "(720) 555-0142",
    address: "88 Pine St, Aurora, CO 80010",
  },
  firm: {
    name: "Kosloski Law, P.C.",
    addressLine1: "100 Main St",
    addressLine2: "Suite 200",
    city: "Denver",
    state: "CO",
    zip: "80202",
    phone: "(303) 555-0100",
    email: "info@kosloskilaw.com",
  },
  user: { name: "Jason Kosloski" },
  today: new Date(Date.UTC(2026, 3, 15, 12)),
  timeZone: "America/Denver",
};

describe("mergeTemplate", () => {
  test("replaces known tokens with resolved values", () => {
    const { text, unresolved, missing } = mergeTemplate(
      "Re: {{matter.name}}, No. {{matter.caseNumber}}\nDear {{client.name}},",
      ctx
    );
    expect(text).toBe(
      "Re: Alvarez v. City of Aurora, No. 2026-CV-00481\nDear Maria Alvarez,"
    );
    expect(unresolved).toEqual([]);
    expect(missing).toEqual([]);
  });

  test("tolerates whitespace inside the braces", () => {
    const { text } = mergeTemplate("Hello {{ client.name }}!", ctx);
    expect(text).toBe("Hello Maria Alvarez!");
  });

  test("formats dates long-style in the context time zone", () => {
    const { text } = mergeTemplate(
      "{{today}} / incident {{matter.incidentDate}} / SOL {{matter.solDate}}",
      ctx
    );
    expect(text).toBe(
      "April 15, 2026 / incident January 10, 2025 / SOL January 10, 2027"
    );
  });

  test("unknown tokens are left intact AND reported in unresolved", () => {
    const body = "Dear {{client.nmae}}, re {{matter.name}} {{client.nmae}}";
    const { text, unresolved, missing } = mergeTemplate(body, ctx);
    // The typo'd token survives verbatim — never silently swallowed —
    // and is reported once despite appearing twice.
    expect(text).toBe(
      "Dear {{client.nmae}}, re Alvarez v. City of Aurora {{client.nmae}}"
    );
    expect(unresolved).toEqual(["client.nmae"]);
    expect(missing).toEqual([]);
  });

  test("null resolutions render a visible placeholder and report in missing", () => {
    const noClient: MergeContext = { ...ctx, client: null };
    const { text, unresolved, missing } = mergeTemplate(
      "To {{client.name}} at {{client.email}}",
      noClient
    );
    expect(text).toBe(
      "To [client.name — not on file] at [client.email — not on file]"
    );
    expect(missing).toEqual(["client.name", "client.email"]);
    expect(unresolved).toEqual([]);
  });

  test("blank-string values count as missing, not as an invisible merge", () => {
    const blankCase: MergeContext = {
      ...ctx,
      matter: { ...ctx.matter, caseNumber: "   " },
    };
    const { text, missing } = mergeTemplate("No. {{matter.caseNumber}}", blankCase);
    expect(text).toBe("No. [matter.caseNumber — not on file]");
    expect(missing).toEqual(["matter.caseNumber"]);
  });

  test("non-token braces and empty bodies pass through untouched", () => {
    expect(mergeTemplate("", ctx).text).toBe("");
    // `{{ not a key }}` has spaces inside the identifier — not a
    // token, stays literal and is NOT reported.
    const res = mergeTemplate("{{ not a key }} and { single }", ctx);
    expect(res.text).toBe("{{ not a key }} and { single }");
    expect(res.unresolved).toEqual([]);
  });
});

describe("field catalog", () => {
  test("covers the required keys", () => {
    const keys = MERGE_FIELDS.map((f) => f.key);
    for (const required of [
      "matter.name",
      "matter.caseNumber",
      "matter.practiceArea",
      "matter.stage",
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
      "user.name",
      "today",
    ]) {
      expect(keys).toContain(required);
    }
    // No duplicate keys — the merge map would silently drop one.
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every field carries picker metadata and lands in a group", () => {
    for (const f of MERGE_FIELDS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
    }
    const grouped = MERGE_FIELD_GROUPS.flatMap((g) => g.fields);
    expect(grouped.length).toBe(MERGE_FIELDS.length);
  });

  test("every field resolves against the sample context (preview never warns about sample gaps)", () => {
    for (const f of MERGE_FIELDS) {
      expect(f.resolve(SAMPLE_MERGE_CONTEXT), f.key).not.toBeNull();
    }
  });
});

describe("composeCityStateZip", () => {
  test("all parts", () => {
    expect(composeCityStateZip("Denver", "CO", "80202")).toBe(
      "Denver, CO 80202"
    );
  });
  test("partial parts", () => {
    expect(composeCityStateZip("Denver", null, null)).toBe("Denver");
    expect(composeCityStateZip(null, "CO", "80202")).toBe("CO 80202");
  });
  test("nothing → null", () => {
    expect(composeCityStateZip(null, null, null)).toBeNull();
  });
});
