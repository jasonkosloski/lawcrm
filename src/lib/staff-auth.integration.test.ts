import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const hoisted = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: async () => ({ users: { getUser: hoisted.getUser } }),
}));

import { resolveStaffUser } from "./staff-auth";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;

/** A Clerk user whose primary email has the given verification status. */
function clerkUser(email: string, status: string | null = "verified") {
  return {
    primaryEmailAddressId: "idn_1",
    emailAddresses: [
      {
        id: "idn_1",
        emailAddress: email,
        verification: status ? { status } : null,
      },
      {
        id: "idn_other",
        emailAddress: "other@example.com",
        verification: { status: "verified" },
      },
    ],
  };
}

beforeEach(async () => {
  await resetDb();
  hoisted.getUser.mockReset();
  firmId = (await seedFirm()).firmId;
});

const linkedRow = (email: string) =>
  prisma.user.findFirst({
    where: { email },
    select: { clerkUserId: true },
  });

describe("resolveStaffUser", () => {
  test("linked + active -> ok", async () => {
    const { userId } = await seedUser({ firmId });
    await prisma.user.update({
      where: { id: userId },
      data: { clerkUserId: "user_a" },
    });
    await expect(resolveStaffUser("user_a", "sess_1")).resolves.toEqual({
      status: "ok",
      userId,
      clerkUserId: "user_a",
      sessionId: "sess_1",
    });
    expect(hoisted.getUser).not.toHaveBeenCalled();
  });

  test("linked + inactive -> no_access", async () => {
    const { userId } = await seedUser({ firmId, isActive: false });
    await prisma.user.update({
      where: { id: userId },
      data: { clerkUserId: "user_a" },
    });
    await expect(resolveStaffUser("user_a", "s")).resolves.toEqual({
      status: "no_access",
      clerkUserId: "user_a",
    });
  });

  test("unlinked, verified email matches -> links, logs once, ok", async () => {
    const { userId } = await seedUser({ firmId, email: "jane@firm.test" });
    hoisted.getUser.mockResolvedValue(clerkUser("Jane@Firm.test"));
    const res = await resolveStaffUser("user_a", "s");
    expect(res).toEqual({
      status: "ok",
      userId,
      clerkUserId: "user_a",
      sessionId: "s",
    });
    expect((await linkedRow("jane@firm.test"))?.clerkUserId).toBe("user_a");
    const rows = await prisma.activityLog.findMany({
      where: { type: "auth", title: "Linked Google sign-in" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
  });

  test("email matches a user already linked to a different Clerk id -> no_access, unchanged", async () => {
    const { userId } = await seedUser({ firmId, email: "jane@firm.test" });
    await prisma.user.update({
      where: { id: userId },
      data: { clerkUserId: "user_first" },
    });
    hoisted.getUser.mockResolvedValue(clerkUser("jane@firm.test"));
    await expect(resolveStaffUser("user_b", "s")).resolves.toEqual({
      status: "no_access",
      clerkUserId: "user_b",
    });
    expect((await linkedRow("jane@firm.test"))?.clerkUserId).toBe("user_first");
  });

  test("unverified email -> no_access, nothing linked", async () => {
    await seedUser({ firmId, email: "jane@firm.test" });
    hoisted.getUser.mockResolvedValue(clerkUser("jane@firm.test", "unverified"));
    await expect(resolveStaffUser("user_a", "s")).resolves.toMatchObject({
      status: "no_access",
    });
    expect((await linkedRow("jane@firm.test"))?.clerkUserId).toBeNull();
  });

  test("deactivated user with matching email is not linked", async () => {
    await seedUser({ firmId, email: "jane@firm.test", isActive: false });
    hoisted.getUser.mockResolvedValue(clerkUser("jane@firm.test"));
    await expect(resolveStaffUser("user_a", "s")).resolves.toMatchObject({
      status: "no_access",
    });
    expect((await linkedRow("jane@firm.test"))?.clerkUserId).toBeNull();
  });

  test("no matching user -> no_access", async () => {
    hoisted.getUser.mockResolvedValue(clerkUser("nobody@firm.test"));
    await expect(resolveStaffUser("user_a", "s")).resolves.toMatchObject({
      status: "no_access",
    });
  });

  test("repeated unlinkable resolutions write one no_access row per Clerk id", async () => {
    hoisted.getUser.mockResolvedValue(clerkUser("nobody@firm.test"));
    await resolveStaffUser("user_a", "s1");
    await resolveStaffUser("user_a", "s2");
    expect(
      await prisma.activityLog.count({
        where: { type: "auth", title: "Signed in without firm access" },
      }),
    ).toBe(1);
    // A different Clerk id is its own audit subject.
    await resolveStaffUser("user_b", "s3");
    expect(
      await prisma.activityLog.count({
        where: { type: "auth", title: "Signed in without firm access" },
      }),
    ).toBe(2);
    // Outside the 15 minute window the event is recorded again.
    await prisma.activityLog.updateMany({
      where: { title: "Signed in without firm access" },
      data: { timestamp: new Date(Date.now() - 16 * 60 * 1000) },
    });
    await resolveStaffUser("user_a", "s4");
    expect(
      await prisma.activityLog.count({
        where: { type: "auth", title: "Signed in without firm access" },
      }),
    ).toBe(3);
  });

  test("race: two Clerk ids, same email -> exactly one ok", async () => {
    await seedUser({ firmId, email: "jane@firm.test" });
    hoisted.getUser.mockResolvedValue(clerkUser("jane@firm.test"));
    const [a, b] = await Promise.all([
      resolveStaffUser("user_a", "s1"),
      resolveStaffUser("user_b", "s2"),
    ]);
    expect([a.status, b.status].sort()).toEqual(["no_access", "ok"]);
    const winner = a.status === "ok" ? "user_a" : "user_b";
    expect((await linkedRow("jane@firm.test"))?.clerkUserId).toBe(winner);
  });

  test("same Clerk id resolving concurrently stays ok for both", async () => {
    await seedUser({ firmId, email: "jane@firm.test" });
    hoisted.getUser.mockResolvedValue(clerkUser("jane@firm.test"));
    const [a, b] = await Promise.all([
      resolveStaffUser("user_a", "s1"),
      resolveStaffUser("user_a", "s2"),
    ]);
    expect([a.status, b.status]).toEqual(["ok", "ok"]);
  });

  test("getUser rejects -> no_access (fail closed)", async () => {
    await seedUser({ firmId, email: "jane@firm.test" });
    hoisted.getUser.mockRejectedValue(new Error("clerk down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(resolveStaffUser("user_a", "s")).resolves.toMatchObject({
      status: "no_access",
    });
    expect(spy).toHaveBeenCalled();
    expect((await linkedRow("jane@firm.test"))?.clerkUserId).toBeNull();
  });
});
