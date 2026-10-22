/**
 * Integration test for the template foundation schema: structured
 * content defaults on DocumentTemplate and the TemplateBlock library.
 * (Seeded blocks come from the migration SQL, which vitest's schema
 * push does not run — they are verified against a migrated scratch DB.)
 */

import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "@/test/integration-helpers";

beforeEach(async () => {
  await resetDb();
});

describe("template foundation schema", () => {
  test("a template with only name + content gets letter/matter defaults and null body", async () => {
    const t = await prisma.documentTemplate.create({
      data: { name: "T", content: { type: "doc", content: [] } },
    });
    expect(t.kind).toBe("letter");
    expect(t.appliesTo).toBe("matter");
    expect(t.body).toBeNull();
    expect(t.subject).toBeNull();
  });

  test("template block keys are unique", async () => {
    await prisma.templateBlock.create({
      data: { key: "dup", name: "A", content: { type: "doc", content: [] } },
    });
    await expect(
      prisma.templateBlock.create({
        data: { key: "dup", name: "B", content: { type: "doc", content: [] } },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
