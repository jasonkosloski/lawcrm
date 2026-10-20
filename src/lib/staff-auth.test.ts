import { beforeEach, describe, expect, test, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  onPortal: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/portal/host", () => ({
  requestIsOnPortalHost: hoisted.onPortal,
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: hoisted.auth,
  clerkClient: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getStaffAuth } from "./staff-auth";

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.onPortal.mockResolvedValue(false);
});

describe("getStaffAuth", () => {
  test("portal host -> signed_out without calling Clerk", async () => {
    hoisted.onPortal.mockResolvedValue(true);
    await expect(getStaffAuth()).resolves.toEqual({ status: "signed_out" });
    expect(hoisted.auth).not.toHaveBeenCalled();
  });

  test("no Clerk user -> signed_out", async () => {
    hoisted.auth.mockResolvedValue({ userId: null, sessionId: null });
    await expect(getStaffAuth()).resolves.toEqual({ status: "signed_out" });
  });
});
