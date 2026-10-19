import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/matter-access", () => ({ assertMatterAccess: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/firm", () => ({
  getCurrentFirm: vi.fn(async () => ({ id: "f1" })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    portalMatterAccess: { findMany: vi.fn(async () => []) },
    matterContact: { findMany: vi.fn(async () => []) },
    firm: { findUnique: vi.fn(async () => ({ portalEnabled: true })) },
  },
}));

import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getPortalCardData } from "./portal-access";

afterEach(() => vi.clearAllMocks());

describe("getPortalCardData", () => {
  test("a walled user gets notFound and no query runs", async () => {
    vi.mocked(assertMatterAccess).mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(getPortalCardData("m1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(prisma.matterContact.findMany).not.toHaveBeenCalled();
    expect(prisma.portalMatterAccess.findMany).not.toHaveBeenCalled();
  });

  test("without portal.view: empty result, no matter-scoped query", async () => {
    vi.mocked(assertMatterAccess).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    expect(await getPortalCardData("m1")).toEqual({
      rows: [],
      contacts: [],
      portalEnabled: false,
    });
    expect(prisma.matterContact.findMany).not.toHaveBeenCalled();
  });

  test("with portal.view: clients first, deduped", async () => {
    vi.mocked(assertMatterAccess).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    const c = (id: string) => ({ id, name: id, email: null });
    vi.mocked(prisma.matterContact.findMany).mockResolvedValue([
      { category: "expert_witness", contact: c("w") },
      { category: "client", contact: c("a") },
      { category: "other", contact: c("a") },
    ] as never);
    const r = await getPortalCardData("m1");
    expect(r.contacts.map((x) => x.id)).toEqual(["a", "w"]);
    expect(r.portalEnabled).toBe(true);
  });
});
