import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "@/test/integration-helpers";
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import { DEFAULT_PARAGRAPH_STYLES } from "./page-style";
import { renderTemplate } from "./render";
import { loadBlockMap } from "./template-source";
import type { TemplateDoc } from "./schema";
import { resolvedToText } from "./to-text";

const holding = (...ids: string[]): TemplateDoc => ({
  type: "doc",
  content: ids.map((blockId) => ({ type: "block", attrs: { blockId } })),
});

/** Stores a chain of blocks, each containing the next; returns their ids. */
async function seedChain(names: string[]): Promise<string[]> {
  const ids: string[] = [];
  // Create innermost first so each block can hold the next one's id.
  for (const name of [...names].reverse()) {
    const b = await prisma.templateBlock.create({
      data: { key: name, name, content: holding(...ids.slice(0, 1)) as object },
      select: { id: true },
    });
    ids.unshift(b.id);
  }
  return ids;
}

describe("loadBlockMap", () => {
  beforeEach(resetDb);

  test("loads blocks nested in blocks", async () => {
    const [a, b, c] = await seedChain(["A", "B", "C"]);
    const map = await loadBlockMap(holding(a));
    expect([...map.values()].map((x) => x.name).sort()).toEqual(["A", "B", "C"]);
    expect(map.get(c)?.content).toEqual(holding());
    expect(map.has(b)).toBe(true);
  });

  test("stops after five levels", async () => {
    const ids = await seedChain(["L1", "L2", "L3", "L4", "L5", "L6", "L7"]);
    const map = await loadBlockMap(holding(ids[0]));
    expect([...map.values()].map((x) => x.name).sort()).toEqual(["L1", "L2", "L3", "L4", "L5"]);
  });

  test("a sixth level loaded from the database prints [Blocks nested too deep]", async () => {
    // Each level prints its name, then holds the next level.
    const names = ["L1", "L2", "L3", "L4", "L5", "L6"];
    let next: string | null = null;
    for (const name of [...names].reverse()) {
      const content: TemplateDoc = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: name }] },
          ...(next ? [{ type: "block" as const, attrs: { blockId: next } }] : []),
        ],
      };
      const b = await prisma.templateBlock.create({
        data: { key: name, name, content: content as object },
        select: { id: true },
      });
      next = b.id;
    }
    const top = holding(next!);
    const { doc, report } = renderTemplate(top, {
      data: { ...SAMPLE_TEMPLATE_DATA, scope: "matter" },
      blocks: await loadBlockMap(top),
      styles: DEFAULT_PARAGRAPH_STYLES,
    });
    expect(resolvedToText(doc).split("\n").filter(Boolean)).toEqual([
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
      "[Blocks nested too deep]",
    ]);
    expect(report.archivedBlocks).toEqual([]);
    expect(report.invalid).toEqual(["A block (nested too deep)"]);
  });

  test("loads replacement blocks' children", async () => {
    const [r, child] = await seedChain(["R", "Child"]);
    const map = await loadBlockMap(holding(), [], [r]);
    expect(map.has(r)).toBe(true);
    expect(map.has(child)).toBe(true);
  });
});
