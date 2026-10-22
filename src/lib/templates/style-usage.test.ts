import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "@/test/integration-helpers";
import { styleKeysIn, styleUsage } from "./style-usage";

describe("styleKeysIn", () => {
  test("finds attrs.style at any depth, ignoring non-strings", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { style: "caption" } },
        {
          type: "table",
          content: [
            { type: "tableCell", content: [{ type: "paragraph", attrs: { style: "x-1" } }] },
          ],
        },
        { type: "paragraph", attrs: { style: 3 } },
        { type: "paragraph" },
      ],
    };
    expect([...styleKeysIn(doc)].sort()).toEqual(["caption", "x-1"]);
  });

  test("tolerates null and primitives", () => {
    expect(styleKeysIn(null).size).toBe(0);
    expect(styleKeysIn("x").size).toBe(0);
  });
});

describe("styleUsage", () => {
  beforeEach(resetDb);
  const doc = (style: string) => ({
    type: "doc",
    content: [{ type: "paragraph", attrs: { style } }],
  });

  test("names the templates and blocks that reference the key", async () => {
    await prisma.documentTemplate.create({
      data: { name: "Letter A", content: doc("caption") },
    });
    await prisma.documentTemplate.create({
      data: { name: "Letter B", content: doc("title") },
    });
    await prisma.templateBlock.create({
      data: { key: "b1", name: "Block One", content: doc("caption") },
    });
    expect(await styleUsage("caption")).toEqual({ templates: ["Letter A"], blocks: ["Block One"] });
    expect(await styleUsage("nothing")).toEqual({ templates: [], blocks: [] });
  });
});
