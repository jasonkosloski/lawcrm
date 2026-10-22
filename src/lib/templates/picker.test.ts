import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "@/test/integration-helpers";
import { generatableTemplateWhere } from "./picker";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

describe("generatableTemplateWhere", () => {
  test("an appliesTo 'both' template (e.g. a migrated legacy one) is offered on leads and matters", async () => {
    await resetDb();
    const mk = (name: string, appliesTo: string, kind = "letter") =>
      prisma.documentTemplate.create({ data: { name, appliesTo, kind, body: "x" } });
    await mk("both", "both");
    await mk("matter-only", "matter");
    await mk("lead-only", "lead");
    await mk("email", "both", "email");
    const names = async (k: "matter" | "lead") =>
      (await prisma.documentTemplate.findMany({ where: generatableTemplateWhere(k) }))
        .map((t) => t.name)
        .sort();
    expect(await names("lead")).toEqual(["both", "lead-only"]);
    expect(await names("matter")).toEqual(["both", "matter-only"]);
  });
});
