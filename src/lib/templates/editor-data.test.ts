import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import { fromSerializedCourt } from "./court-blocks";
import { loadEditorCourtFormats } from "./editor-data";
import { resetDb } from "@/test/integration-helpers";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});
beforeEach(resetDb);

const content = { type: "doc", content: [] };

describe("loadEditorCourtFormats", () => {
  test("returns active formats with values and replacement blocks, JSON-safe", async () => {
    const a = await prisma.templateBlock.create({
      data: { key: "cap", name: "Caption", content },
    });
    const b = await prisma.templateBlock.create({
      data: { key: "cap2", name: "Court caption", content },
    });
    await prisma.courtFormat.create({
      data: {
        name: "Colorado District",
        paperSize: "legal",
        blocks: { create: { blockId: a.id, replacementBlockId: b.id } },
      },
    });
    await prisma.courtFormat.create({ data: { name: "Old", isActive: false } });

    const out = await loadEditorCourtFormats();
    expect(out.map((c) => c.name)).toEqual(["Colorado District"]);
    expect(out[0]!.values.paperSize).toBe("legal");
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    const ctx = fromSerializedCourt(out[0]!);
    expect(ctx.replacements.get(a.id)?.name).toBe("Court caption");
  });

  test("Preview-as carries a legacy court lineSpacing into the body override", async () => {
    await prisma.courtFormat.create({ data: { name: "Spaced", lineSpacing: "double" } });
    const out = await loadEditorCourtFormats();
    expect(out[0]!.values.styleOverrides.body?.lineSpacing).toBe("double");
  });
});
