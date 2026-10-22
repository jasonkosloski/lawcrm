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
    // Date-only values are stored at UTC midnight (ADR-012) — the
    // fixture must match, or the west-of-UTC day-shift bug is hidden.
    incidentDate: new Date("2025-01-10"),
    solDate: new Date("2027-01-10"),
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
  request: null,
  custodian: null,
  today: new Date(Date.UTC(2026, 3, 15, 12)),
  timeZone: "America/Denver",
};

const recordsCtx: MergeContext = {
  ...ctx,
  request: {
    subject: "Chart 2024",
    description: "All charts and billing.",
    type: "CORA",
    dateRangeStart: new Date("2024-01-05"),
    dateRangeEnd: null,
    responseDueDate: new Date("2026-05-01"),
    sentDate: new Date("2026-04-15"),
  },
  custodian: {
    name: "Memorial Hospital",
    organization: "Memorial Health",
    address: "1 Hospital Way, Denver, CO 80202",
    email: "records@memorial.example",
    phone: "(303) 555-0111",
  },
};

describe("records request merge fields", () => {
  test("resolve from a request context (date-only fields on the UTC grid)", () => {
    const { text, missing } = mergeTemplate(
      "{{custodian.name}}|{{custodian.organization}}|{{custodian.address}}|{{custodian.email}}|{{custodian.phone}}|{{request.subject}}|{{request.description}}|{{request.type}}|{{request.dateRangeStart}}|{{request.responseDueDate}}|{{request.sentDate}}|{{request.dateRangeEnd}}",
      recordsCtx,
    );
    expect(text).toBe(
      "Memorial Hospital|Memorial Health|1 Hospital Way, Denver, CO 80202|records@memorial.example|(303) 555-0111|Chart 2024|All charts and billing.|CORA|January 5, 2024|May 1, 2026|April 15, 2026|[request.dateRangeEnd — not on file]",
    );
    expect(missing).toEqual(["request.dateRangeEnd"]);
  });

  test("outside a request they render the not-on-file placeholder", () => {
    const { text, missing, unresolved } = mergeTemplate(
      "{{custodian.name}} {{request.subject}}",
      ctx,
    );
    expect(text).toBe("[custodian.name — not on file] [request.subject — not on file]");
    expect(missing).toEqual(["custodian.name", "request.subject"]);
    expect(unresolved).toEqual([]);
  });
});

describe("mergeTemplate", () => {
  test("replaces known tokens with resolved values", () => {
    const { text, unresolved, missing } = mergeTemplate(
      "Re: {{matter.name}}, No. {{matter.caseNumber}}\nDear {{client.name}},",
      ctx,
    );
    expect(text).toBe("Re: Alvarez v. City of Aurora, No. 2026-CV-00481\nDear Maria Alvarez,");
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
      ctx,
    );
    expect(text).toBe("April 15, 2026 / incident January 10, 2025 / SOL January 10, 2027");
  });

  test("unknown tokens are left intact AND reported in unresolved", () => {
    const body = "Dear {{client.nmae}}, re {{matter.name}} {{client.nmae}}";
    const { text, unresolved, missing } = mergeTemplate(body, ctx);
    // The typo'd token survives verbatim — never silently swallowed —
    // and is reported once despite appearing twice.
    expect(text).toBe("Dear {{client.nmae}}, re Alvarez v. City of Aurora {{client.nmae}}");
    expect(unresolved).toEqual(["client.nmae"]);
    expect(missing).toEqual([]);
  });

  test("null resolutions render a visible placeholder and report in missing", () => {
    const noClient: MergeContext = { ...ctx, client: null };
    const { text, unresolved, missing } = mergeTemplate(
      "To {{client.name}} at {{client.email}}",
      noClient,
    );
    expect(text).toBe("To [client.name — not on file] at [client.email — not on file]");
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
    // Single braces are not tokens at all.
    const res = mergeTemplate("{ single } and {not} either", ctx);
    expect(res.text).toBe("{ single } and {not} either");
    expect(res.unresolved).toEqual([]);
  });

  test("malformed tokens (hyphen / space) stay literal AND are reported", () => {
    const res = mergeTemplate(
      "Dear {{client-name}}, {{ client name }} and {{client-name}} again; {{matter.name}}",
      ctx,
    );
    expect(res.text).toBe(
      "Dear {{client-name}}, {{ client name }} and {{client-name}} again; Alvarez v. City of Aurora",
    );
    expect(res.unresolved).toEqual(["client-name", "client name"]);
    expect(res.missing).toEqual([]);
  });

  test("a resolved value that looks like a token is not re-reported", () => {
    const tricky: MergeContext = {
      ...ctx,
      client: { ...ctx.client!, name: "{{x-y}}" },
    };
    const res = mergeTemplate("{{client.name}}", tricky);
    expect(res.text).toBe("{{x-y}}");
    expect(res.unresolved).toEqual([]);
  });
});

describe("date-only fields (ADR-012)", () => {
  // The bug only reproduces west of UTC, so pin the zone-independent
  // contract: whatever zone the user is in, the stored UTC-midnight
  // calendar date is what prints.
  test.each(["America/Denver", "Pacific/Honolulu", "UTC", "Asia/Tokyo", null])(
    "incident/SOL dates print on the stored calendar day in %s",
    (timeZone) => {
      const res = mergeTemplate("{{matter.incidentDate}} | {{matter.solDate}}", {
        ...ctx,
        timeZone,
      });
      expect(res.text).toBe("January 10, 2025 | January 10, 2027");
    },
  );

  test("{{today}} still follows the user's zone (it is a real instant)", () => {
    // 2026-04-16 03:00Z is Apr 15 9 PM in Denver, Apr 16 in Tokyo.
    const late = { ...ctx, today: new Date("2026-04-16T03:00:00Z") };
    expect(mergeTemplate("{{today}}", { ...late, timeZone: "America/Denver" }).text).toBe(
      "April 15, 2026",
    );
    expect(mergeTemplate("{{today}}", { ...late, timeZone: "Asia/Tokyo" }).text).toBe(
      "April 16, 2026",
    );
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
    expect(composeCityStateZip("Denver", "CO", "80202")).toBe("Denver, CO 80202");
  });
  test("partial parts", () => {
    expect(composeCityStateZip("Denver", null, null)).toBe("Denver");
    expect(composeCityStateZip(null, "CO", "80202")).toBe("CO 80202");
  });
  test("nothing → null", () => {
    expect(composeCityStateZip(null, null, null)).toBeNull();
  });
});
