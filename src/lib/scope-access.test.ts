import { beforeEach, describe, expect, test, vi } from "vitest";

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
}));
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "u1"),
}));
vi.mock("@/lib/lead-access", () => ({
  assertLeadAccess: vi.fn(async () => "u1"),
}));

import { prisma } from "@/lib/prisma";
import { assertLeadAccess } from "@/lib/lead-access";
import {
  assertScopeAccess,
  assertScopeWritable,
  revalidateDocumentScope,
} from "./scope-access";

const findUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  revalidatePath.mockClear();
  findUnique.mockReset();
});

describe("revalidateDocumentScope", () => {
  test("lead scope revalidates intake paths, never 'null'", () => {
    revalidateDocumentScope({ kind: "lead", leadId: "l1" }, "d1");
    expect(revalidatePath.mock.calls).toEqual([
      ["/intake/l1/documents", "layout"],
      ["/intake/l1"],
      ["/intake/l1/records/[requestId]", "page"],
      ["/intake/l1/documents/d1"],
    ]);
    expect(JSON.stringify(revalidatePath.mock.calls)).not.toContain("null");
  });

  test("matter scope preserves today's behavior", () => {
    revalidateDocumentScope({ kind: "matter", matterId: "m1" });
    expect(revalidatePath.mock.calls).toEqual([
      ["/matters/m1/documents", "layout"],
      ["/matters/m1"],
      ["/matters/m1/records/[requestId]", "page"],
    ]);
  });
});

describe("assertScopeAccess", () => {
  test("lead scope goes through the lead wall (ADR-049)", async () => {
    vi.mocked(assertLeadAccess).mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(assertScopeAccess({ kind: "lead", leadId: "x" })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    await expect(assertScopeAccess({ kind: "lead", leadId: "l1" })).resolves.toBe("u1");
    expect(assertLeadAccess).toHaveBeenLastCalledWith("l1");
  });
});

describe("assertScopeWritable", () => {
  test("matter scope is always writable; converted lead is not", async () => {
    await expect(
      assertScopeWritable({ kind: "matter", matterId: "m1" })
    ).resolves.toBeNull();
    findUnique.mockResolvedValueOnce({ stage: "converted" });
    expect(await assertScopeWritable({ kind: "lead", leadId: "l1" })).toMatch(
      /converted/
    );
    findUnique.mockResolvedValueOnce({ stage: "new" });
    expect(await assertScopeWritable({ kind: "lead", leadId: "l1" })).toBeNull();
  });
});
