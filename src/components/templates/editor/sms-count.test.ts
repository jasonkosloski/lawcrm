import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATE_DATA } from "@/lib/templates/catalog";
import type { TemplateDoc } from "@/lib/templates/schema";
import { smsCountLabel, smsStats, smsTextWithSamples } from "./sms-count";

describe("smsStats", () => {
  it("GSM text: 160 fits one segment, 161 needs two (153 each)", () => {
    expect(smsStats("a".repeat(160))).toEqual({ characters: 160, segments: 1 });
    expect(smsStats("a".repeat(161))).toEqual({ characters: 161, segments: 2 });
    expect(smsStats("a".repeat(306))).toEqual({ characters: 306, segments: 2 });
    expect(smsStats("a".repeat(307))).toEqual({ characters: 307, segments: 3 });
  });

  it("any non-GSM character switches to 70 / 67", () => {
    expect(smsStats("é".repeat(70))).toEqual({ characters: 70, segments: 1 });
    // é is GSM; ē is not.
    expect(smsStats("ē" + "a".repeat(69))).toEqual({ characters: 70, segments: 1 });
    expect(smsStats("ē" + "a".repeat(70))).toEqual({ characters: 71, segments: 2 });
    expect(smsStats("ē" + "a".repeat(133))).toEqual({ characters: 134, segments: 2 });
    expect(smsStats("ē" + "a".repeat(134))).toEqual({ characters: 135, segments: 3 });
  });

  it("extension characters take two GSM slots", () => {
    expect(smsStats("€".repeat(80))).toEqual({ characters: 80, segments: 1 });
    expect(smsStats("€".repeat(81))).toEqual({ characters: 81, segments: 2 });
  });

  it("empty text is zero segments", () => {
    expect(smsStats("")).toEqual({ characters: 0, segments: 0 });
  });

  it("formats the label", () => {
    expect(smsCountLabel(smsStats("a".repeat(161)))).toBe("161 characters · 2 segments");
    expect(smsCountLabel(smsStats("a"))).toBe("1 character · 1 segment");
  });
});

describe("smsTextWithSamples", () => {
  it("counts each field as its sample value", () => {
    const doc: TemplateDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi " },
            { type: "field", attrs: { path: "firm.name", format: null } },
          ],
        },
      ],
    };
    expect(smsTextWithSamples(doc, "matter")).toBe(`Hi ${SAMPLE_TEMPLATE_DATA.firm.name}`);
  });
});
