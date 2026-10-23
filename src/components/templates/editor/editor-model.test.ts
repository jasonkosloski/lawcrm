import { describe, expect, it } from "vitest";
import type { BlockSource } from "@/lib/templates/render";
import type { TemplateDoc } from "@/lib/templates/schema";
import {
  blockMeta,
  initialDoc,
  insertableBlocks,
  type EditorBlock,
  type EditorProps,
} from "./editor-model";

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

describe("insertableBlocks", () => {
  const ref = (id: string) => ({ type: "block", attrs: { blockId: id } });
  const blk = (id: string, over: Partial<BlockSource> = {}, ...kids: string[]): BlockSource => ({
    id,
    name: id,
    isActive: true,
    content: {
      type: "doc",
      content: kids.length ? kids.map(ref) : [{ type: "paragraph" }],
    } as TemplateDoc,
    ...over,
  });
  // p contains the host h, so h sits at level 2 at best; t1 spans 4 levels.
  const ALL = [
    blk("h"),
    blk("p", {}, "h"),
    blk("archived", { isActive: false }),
    blk("matterOnly", { appliesTo: "matter" }),
    blk("t1", {}, "t2"),
    blk("t2", {}, "t3"),
    blk("t3", {}, "t4"),
    blk("t4"),
    blk("ok"),
  ];
  const ids = (host: Parameters<typeof insertableBlocks>[1]) =>
    insertableBlocks(ALL, host).map((b) => b.id);

  it("a block leaves out itself, its ancestors, scope misfits, archived and too-tall blocks", () => {
    expect(ids({ id: "h", appliesTo: "both", isBlock: true })).toEqual(["t2", "t3", "t4", "ok"]);
  });

  it("a new block (no id) applies only scope, archived and height", () => {
    // Nothing contains it yet: it sits at level 1, so t1 (4 tall) fits.
    expect(ids({ id: null, appliesTo: "both", isBlock: true })).toEqual([
      "h",
      "p",
      "t1",
      "t2",
      "t3",
      "t4",
      "ok",
    ]);
  });

  it("a template offers blocks up to five levels tall that cover its scope", () => {
    expect(ids({ id: null, appliesTo: "matter", isBlock: false })).toEqual([
      "h",
      "p",
      "matterOnly",
      "t1",
      "t2",
      "t3",
      "t4",
      "ok",
    ]);
  });
});
