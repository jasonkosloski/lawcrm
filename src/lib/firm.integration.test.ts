/**
 * Integration tests for firm.ts admin helpers — `getCurrentFirm`,
 * `isCurrentUserAdmin`, `requireAdmin`. They each reach the DB
 * via `prisma`, so cover them with the real test DB.
 *
 * `requireAdmin` calls `redirect()` from `next/navigation` which
 * throws an internal error in production. The mock here re-throws
 * a recognizable string so we can assert it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(),
}));

import { getCurrentUserId } from "@/lib/current-user";
import {
  getCurrentFirm,
  isCurrentUserAdmin,
  requireAdmin,
} from "@/lib/firm";
import {
  resetDb,
  seedFirm,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let adminRoleId: string;
let defaultRoleId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm({ name: "Acme Law" });
  firmId = f.firmId;
  adminRoleId = f.adminRoleId;
  defaultRoleId = f.defaultRoleId;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentFirm", () => {
  test("returns the user's firm profile", async () => {
    const { userId } = await seedUser({ firmId });
    mockedGetUser.mockResolvedValue(userId);

    const firm = await getCurrentFirm();
    expect(firm.id).toBe(firmId);
    expect(firm.name).toBe("Acme Law");
  });

  test("throws when the user has no firm (data-integrity bug)", async () => {
    // Stub `getCurrentUserId` to point at a user that doesn't
    // exist in the DB — same shape as a stale session pointing at
    // a deleted user.
    mockedGetUser.mockResolvedValue("nonexistent-id");
    await expect(getCurrentFirm()).rejects.toThrow(/data integrity/i);
  });
});

describe("isCurrentUserAdmin", () => {
  test("true for active user holding the Admin role", async () => {
    const { userId } = await seedUser({ firmId, roleIds: [adminRoleId] });
    mockedGetUser.mockResolvedValue(userId);
    expect(await isCurrentUserAdmin()).toBe(true);
  });

  test("false for active user without the Admin role", async () => {
    const { userId } = await seedUser({
      firmId,
      roleIds: [defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(userId);
    expect(await isCurrentUserAdmin()).toBe(false);
  });

  test("false for inactive user even with Admin role (defensive)", async () => {
    const { userId } = await seedUser({
      firmId,
      isActive: false,
      roleIds: [adminRoleId],
    });
    mockedGetUser.mockResolvedValue(userId);
    expect(await isCurrentUserAdmin()).toBe(false);
  });

  test("false for an unknown userId", async () => {
    mockedGetUser.mockResolvedValue("not-a-real-user");
    expect(await isCurrentUserAdmin()).toBe(false);
  });
});

describe("requireAdmin", () => {
  test("returns userId for admins", async () => {
    const { userId } = await seedUser({ firmId, roleIds: [adminRoleId] });
    mockedGetUser.mockResolvedValue(userId);
    const out = await requireAdmin();
    expect(out).toBe(userId);
  });

  test("throws (redirect) for non-admins", async () => {
    const { userId } = await seedUser({
      firmId,
      roleIds: [defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(userId);
    await expect(requireAdmin()).rejects.toThrow(/__REDIRECT__:\//);
  });

  test("throws (redirect) for inactive admin (defense-in-depth)", async () => {
    const { userId } = await seedUser({
      firmId,
      isActive: false,
      roleIds: [adminRoleId],
    });
    mockedGetUser.mockResolvedValue(userId);
    await expect(requireAdmin()).rejects.toThrow(/__REDIRECT__:\//);
  });
});
