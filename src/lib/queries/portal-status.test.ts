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
    portalSharedEvent: { findUnique: vi.fn() },
  },
}));

import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getClientStatusCardData, getEventPortalShareProp, getEventShare } from "./portal-status";

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
        orderBy: [{ postedAt: "desc" }, { id: "desc" }],
      }),
    );
  });
});

describe("getEventShare", () => {
  const row = (shareMatter: string, eventMatter: string | null) => ({
    clientTitle: "Hearing",
    clientNote: "Bring ID",
    matterId: shareMatter,
    event: { matterId: eventMatter },
  });

  test("returns the client-facing fields when the matter still matches", async () => {
    vi.mocked(prisma.portalSharedEvent.findUnique).mockResolvedValue(row("m1", "m1") as never);
    expect(await getEventShare("e1")).toEqual({
      clientTitle: "Hearing",
      clientNote: "Bring ID",
    });
  });

  test("null when there is no share", async () => {
    vi.mocked(prisma.portalSharedEvent.findUnique).mockResolvedValue(null);
    expect(await getEventShare("e1")).toBeNull();
  });

  test("null after the event was re-filed to another matter", async () => {
    vi.mocked(prisma.portalSharedEvent.findUnique).mockResolvedValue(row("m1", "m2") as never);
    expect(await getEventShare("e1")).toBeNull();
  });

  test("null when the event lost its matter", async () => {
    vi.mocked(prisma.portalSharedEvent.findUnique).mockResolvedValue(row("m1", null) as never);
    expect(await getEventShare("e1")).toBeNull();
  });
});

describe("getEventPortalShareProp", () => {
  test("undefined for lead events, with no query", async () => {
    expect(await getEventPortalShareProp("e1", null)).toBeUndefined();
    expect(prisma.portalSharedEvent.findUnique).not.toHaveBeenCalled();
  });

  test("undefined without portal.view, with no query", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    expect(await getEventPortalShareProp("e1", "m1")).toBeUndefined();
    expect(prisma.portalSharedEvent.findUnique).not.toHaveBeenCalled();
  });

  test("canShare follows portal.share_events", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k === "portal.view",
    );
    vi.mocked(prisma.portalSharedEvent.findUnique).mockResolvedValue(null);
    expect(await getEventPortalShareProp("e1", "m1")).toEqual({
      canShare: false,
      share: null,
    });
  });
});
