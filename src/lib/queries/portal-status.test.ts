import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/matter-access", () => ({ assertMatterAccess: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    portalStatusUpdate: { findMany: vi.fn(async () => []) },
    portalMatterAccess: { count: vi.fn(async () => 1) },
  },
}));

import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getClientStatusCardData } from "./portal-status";

afterEach(() => vi.clearAllMocks());

describe("getClientStatusCardData", () => {
  test("a walled user gets notFound and no query runs", async () => {
    vi.mocked(assertMatterAccess).mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(getClientStatusCardData("m1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(prisma.portalStatusUpdate.findMany).not.toHaveBeenCalled();
  });

  test("without portal.view: null, no matter-scoped query", async () => {
    vi.mocked(assertMatterAccess).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    expect(await getClientStatusCardData("m1")).toBeNull();
    expect(prisma.portalStatusUpdate.findMany).not.toHaveBeenCalled();
    expect(prisma.portalMatterAccess.count).not.toHaveBeenCalled();
  });

  test("with portal.view: newest first, flattened author, live access", async () => {
    vi.mocked(assertMatterAccess).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    const at = new Date("2026-10-01T12:00:00Z");
    vi.mocked(prisma.portalStatusUpdate.findMany).mockResolvedValue([
      {
        id: "s1",
        stageLabel: "Discovery",
        body: "Waiting on records.",
        postedAt: at,
        editedAt: null,
        emailedAt: null,
        postedBy: { name: "Pat Lawyer" },
      },
    ] as never);
    const r = await getClientStatusCardData("m1");
    expect(r).toEqual({
      updates: [
        {
          id: "s1",
          stageLabel: "Discovery",
          body: "Waiting on records.",
          postedAt: at,
          editedAt: null,
          emailedAt: null,
          postedByName: "Pat Lawyer",
        },
      ],
      hasLiveAccess: true,
    });
    expect(prisma.portalStatusUpdate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matterId: "m1" },
        orderBy: { postedAt: "desc" },
      })
    );
  });
});
