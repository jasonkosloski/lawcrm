import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const clerk = vi.hoisted(() => ({
  ensureDevClerkUser: vi.fn(),
  createDevSignInToken: vi.fn(),
}));
vi.mock("@/lib/clerk-admin", () => clerk);

const logAuthEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-events", () => ({ logAuthEvent }));

class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
}));

import { devSignInAs } from "./dev-sign-in";

function env(nodeEnv: string, key: string | undefined, vercel?: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", key ?? "");
  vi.stubEnv("VERCEL", vercel ?? "");
  vi.stubEnv("DEV_SIGN_IN", "1");
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5433/db");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  env("development", "pk_test_x");
  clerk.ensureDevClerkUser.mockResolvedValue({ ok: true, clerkUserId: "user_new" });
  clerk.createDevSignInToken.mockResolvedValue({ ok: true, token: "tok" });
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
});

describe("devSignInAs guard", () => {
  it.each([
    ["production + test key", "production", "pk_test_x", undefined],
    ["dev + live key", "development", "pk_live_x", undefined],
    ["dev + no key", "development", undefined, undefined],
    ["dev + test key on Vercel", "development", "pk_test_x", "1"],
  ])("%s -> notFound, touches nothing", async (_n, ne, key, vercel) => {
    env(ne, key, vercel);
    await expect(devSignInAs("u1")).rejects.toBeInstanceOf(NotFound);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(clerk.createDevSignInToken).not.toHaveBeenCalled();
  });
});

describe("devSignInAs", () => {
  it("creates the Clerk user once, stores the id, returns a token, audits", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "leo@kosloskilaw.com",
      clerkUserId: null,
    });
    expect(await devSignInAs("u1")).toEqual({ ok: true, ticket: "tok" });
    expect(clerk.ensureDevClerkUser).toHaveBeenCalledWith("leo@kosloskilaw.com");
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", clerkUserId: null },
      data: { clerkUserId: "user_new" },
    });
    expect(clerk.createDevSignInToken).toHaveBeenCalledWith("user_new");
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", kind: "dev_sign_in" }),
    );
  });

  it("reuses an existing clerkUserId (second call creates nothing)", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "leo@kosloskilaw.com",
      clerkUserId: "user_old",
    });
    expect(await devSignInAs("u1")).toEqual({ ok: true, ticket: "tok" });
    expect(clerk.ensureDevClerkUser).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(clerk.createDevSignInToken).toHaveBeenCalledWith("user_old");
  });

  it("only looks up ACTIVE users; unknown/inactive -> error, no token", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    expect(await devSignInAs("nope")).toEqual({
      ok: false,
      error: "No active user with that id.",
    });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "nope", isActive: true } }),
    );
    expect(clerk.createDevSignInToken).not.toHaveBeenCalled();
  });

  it("surfaces a Clerk failure without a token", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@kosloskilaw.com",
      clerkUserId: "c1",
    });
    clerk.createDevSignInToken.mockResolvedValue({ ok: false, error: "down" });
    expect(await devSignInAs("u1")).toEqual({ ok: false, error: "down" });
  });
});
