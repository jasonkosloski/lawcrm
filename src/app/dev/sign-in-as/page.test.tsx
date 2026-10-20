import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany } } }));
vi.mock("@/components/auth/staff-clerk-provider", () => ({
  StaffClerkProvider: () => null,
}));
vi.mock("@/components/auth/dev-sign-in-list", () => ({
  DevSignInList: () => null,
}));
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
}));

import DevSignInAsPage from "./page";

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  findMany.mockResolvedValue([]);
});

describe("/dev/sign-in-as page", () => {
  it("404s in production before reading any data", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    await expect(DevSignInAsPage()).rejects.toBeInstanceOf(NotFound);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("404s with a live key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_x");
    await expect(DevSignInAsPage()).rejects.toBeInstanceOf(NotFound);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("lists only active users when dev-allowed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DEV_SIGN_IN", "1");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5433/db");
    await DevSignInAsPage();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    );
  });
});
