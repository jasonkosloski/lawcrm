import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import {
  applyCourtBlocks,
  fromSerializedCourt,
  toSerializedCourt,
  type CourtContext,
} from "./court-blocks";
import { DEFAULT_DOCUMENT_STYLE } from "./page-style";
import { effectiveBlocks, renderPage } from "./page-render";
import type { BlockSource } from "./render";
import type { TemplateDoc } from "./schema";
import { resolvedToText } from "./to-text";

const doc = (text: string): TemplateDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const ref = (blockId: string): TemplateDoc => ({
  type: "doc",
  content: [{ type: "block", attrs: { blockId } }],
});
const src = (id: string, name: string, text: string, isActive = true): BlockSource => ({
  id,
  name,
  isActive,
  content: doc(text),
});
const blocks = new Map<string, BlockSource>([
  ["cap", src("cap", "Caption", "DEFAULT CAPTION")],
  ["sig", src("sig", "Signature", "DEFAULT SIG")],
]);
const values = {
  fontKey: null,
  fontSizeHalfPt: 26,
  lineSpacing: "double" as const,
  spaceAfterPt: null,
  marginTopIn: null,
  marginRightIn: null,
  marginBottomIn: null,
  marginLeftIn: null,
  pageNumbers: null,
  paperSize: "legal" as const,
};
const court = (over: Partial<CourtContext> = {}, repl?: BlockSource): CourtContext => ({
  id: "c1",
  name: "Colorado District",
  isActive: true,
  values,
  replacements: new Map([["cap", repl ?? src("cap2", "Colorado Caption", "CO CAPTION")]]),
  ...over,
});
const data = { ...SAMPLE_TEMPLATE_DATA, scope: "matter" as const };
const render = (d: TemplateDoc, kind: "letter" | "filing", c?: CourtContext | null) =>
  renderPage({ doc: d, kind, data, blocks, style: DEFAULT_DOCUMENT_STYLE, logo: null, court: c });

describe("applyCourtBlocks", () => {
  it("is an identity copy with no replacements", () => {
    const out = applyCourtBlocks(blocks, new Map());
    expect(out).not.toBe(blocks);
    expect([...out.entries()]).toEqual([...blocks.entries()]);
  });
  it("swaps only the replaced keys", () => {
    const r = src("cap2", "Other", "X");
    const out = applyCourtBlocks(blocks, new Map([["cap", r]]));
    expect(out.get("cap")).toBe(r);
    expect(out.get("sig")).toBe(blocks.get("sig"));
  });
});

describe("serialization", () => {
  it("round-trips", () => {
    const c = court();
    const back = fromSerializedCourt(JSON.parse(JSON.stringify(toSerializedCourt(c))));
    expect(back).toEqual(c);
  });
});

describe("renderPage with a court", () => {
  it("replaces a block in the template body", () => {
    const r = render(ref("cap"), "filing", court());
    expect(resolvedToText(r.body)).toBe("CO CAPTION");
    expect(r.style.paperSize).toBe("legal");
  });
  it("renders the replacement's fields, including the court caption", () => {
    const repl: BlockSource = {
      id: "cap2",
      name: "Colorado Caption",
      isActive: true,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "field", attrs: { path: "matter.courtCaption", format: null } }],
          },
        ],
      },
    };
    const r = render(ref("cap"), "filing", court({}, repl));
    expect(resolvedToText(r.body)).toBe(
      "DISTRICT COURT, CITY AND COUNTY OF SAMPLE, STATE OF EXAMPLE",
    );
    expect(r.report.missing).toEqual([]);
  });
  it("reports an archived replacement by its own name", () => {
    const c = court({}, src("cap2", "Colorado Caption", "CO", false));
    const r = render(ref("cap"), "filing", c);
    expect(r.report.archivedBlocks).toEqual(["Colorado Caption"]);
    expect(resolvedToText(r.body)).toContain("[Colorado Caption block — archived]");
  });
  it("ignores an inactive court", () => {
    const r = render(ref("cap"), "filing", court({ isActive: false }));
    expect(resolvedToText(r.body)).toBe("DEFAULT CAPTION");
    expect(r.style.paperSize).toBe("letter");
  });
  it("ignores the court for letters", () => {
    const r = render(ref("cap"), "letter", court());
    expect(resolvedToText(r.body)).toBe("DEFAULT CAPTION");
    expect(r.style.paperSize).toBe("letter");
  });
  it("effectiveBlocks follows the same rule", () => {
    expect(effectiveBlocks("filing", blocks, court()).get("cap")?.name).toBe("Colorado Caption");
    expect(effectiveBlocks("filing", blocks, court({ isActive: false }))).toBe(blocks);
    expect(effectiveBlocks("letter", blocks, court())).toBe(blocks);
    expect(effectiveBlocks("filing", blocks, null)).toBe(blocks);
  });
});
