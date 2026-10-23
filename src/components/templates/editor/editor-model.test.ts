import { describe, expect, it } from "vitest";
import { blockMeta, initialDoc, type EditorBlock, type EditorProps } from "./editor-model";

describe("initialDoc heading conversion", () => {
  const content = {
    type: "doc",
    content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "T" }] }],
  };
  it("converts headings in a template and in a block", () => {
    const tpl = initialDoc({
      canSave: true,
      template: { id: "1", content, body: null },
    } as unknown as EditorProps);
    expect(JSON.stringify(tpl.doc)).toContain('"style":"heading1"');
    const blk = initialDoc({
      canSave: true,
      block: { id: "1", content },
    } as unknown as EditorProps);
    expect(JSON.stringify(blk.doc)).not.toContain('"heading"');
  });
});

describe("blockMeta", () => {
  const block = { id: "1", key: "k", name: "N", description: null } as EditorBlock;
  it("carries the scope and defaults it to both", () => {
    expect(blockMeta({ ...block, appliesTo: "lead" }).appliesTo).toBe("lead");
    expect(blockMeta(block).appliesTo).toBe("both");
  });
});
