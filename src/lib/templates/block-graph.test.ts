import { describe, expect, it } from "vitest";
import { ancestors, childIds, depthAbove, height, loopPath, scopeCovers } from "./block-graph";
import type { BlockSource } from "./render";
import type { BlockNode, TemplateDoc } from "./schema";

const ref = (id: string): BlockNode => ({ type: "block", attrs: { blockId: id } });
const doc = (...content: BlockNode[]): TemplateDoc => ({ type: "doc", content });
const block = (id: string, ...children: string[]): [string, BlockSource] => [
  id,
  { id, name: id, isActive: true, content: doc(...children.map(ref)) },
];
const map = (...entries: [string, BlockSource][]) => new Map(entries);

describe("block graph", () => {
  // A contains B, B contains C.
  const chain = map(block("A", "B"), block("B", "C"), block("C"));

  it("childIds lists a doc's block references", () => {
    expect(childIds(doc(ref("A"), ref("B"), ref("A")))).toEqual(["A", "B"]);
  });

  it("height counts the levels a block spans", () => {
    expect(height("A", chain)).toBe(3);
    expect(height("C", chain)).toBe(1);
    // A child missing from the map counts as one level.
    expect(height("X", map(block("X", "gone")))).toBe(2);
  });

  it("height terminates on a loop", () => {
    const loop = map(block("A", "B"), block("B", "A"));
    expect(height("A", loop)).toBe(2);
  });

  it("ancestors are every block that transitively contains the id", () => {
    expect(ancestors("C", chain)).toEqual(new Set(["A", "B"]));
    expect(ancestors("A", chain)).toEqual(new Set());
  });

  it("depthAbove is the longest chain of block ancestors", () => {
    expect(depthAbove("C", chain)).toBe(2);
    expect(depthAbove("A", chain)).toBe(0);
  });

  it("loopPath finds a child that already contains the saved block", () => {
    expect(loopPath("A", doc(ref("B")), map(block("B", "A")))).toEqual(["B"]);
    expect(loopPath("A", doc(ref("C")), map(block("C", "B"), block("B", "A")))).toEqual(["C", "B"]);
    expect(loopPath("A", doc(ref("B")), map(block("B", "C"), block("C")))).toBeNull();
  });

  it("scopeCovers: a both-block fits anywhere, a scoped one only its scope", () => {
    expect(scopeCovers("both", "lead")).toBe(true);
    expect(scopeCovers("lead", "lead")).toBe(true);
    expect(scopeCovers("matter", "both")).toBe(false);
  });
});
