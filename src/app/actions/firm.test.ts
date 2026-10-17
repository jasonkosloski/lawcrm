/**
 * Integration tests for the firm profile action.
 *
 * Covers:
 *   - happy-path update of the firm row
 *   - establishedAt parsing: `YYYY-MM-DD` lands as LOCAL midnight
 *     (not UTC — a west-of-UTC user must not see the date drift a
 *     day earlier), empty string nulls the column, and a malformed
 *     value comes back as a field error instead of an unhandled
 *     Prisma crash.
 *   - goal fields (dailyHoursGoal / monthlyBillableGoal): persisted
 *     as numbers, rejected when non-numeric / non-positive / over
 *     the sane ceiling (24 daily, 744 monthly) / more than one
 *     decimal place.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  requirePermissionResult: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/firm", () => ({
  loadCurrentFirm: vi.fn(),
  loadFirmGoals: vi.fn(),
}));

import { loadCurrentFirm, loadFirmGoals } from "@/lib/firm";
import { requirePermissionResult } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { updateFirmAction } from "@/app/actions/firm";
import { firmInitialState } from "@/lib/firm-form";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetFirm = vi.mocked(loadCurrentFirm);
const mockedGetGoals = vi.mocked(loadFirmGoals);
const mockedGate = vi.mocked(requirePermissionResult);

let firmId: string;
let actorId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const seeded = await seedFirm();
  firmId = seeded.firmId;
  actorId = (await seedUser({ firmId, roleIds: [seeded.adminRoleId] })).userId;

  mockedGate.mockReset();
  mockedGate.mockResolvedValue({ ok: true, userId: actorId });
  mockedGetGoals.mockResolvedValue({
    dailyHoursGoal: 6.0,
    monthlyBillableGoal: 200,
  });
  mockedGetFirm.mockResolvedValue({
    id: firmId,
    name: "Test Firm LLC",
    shortName: null,
    ein: null,
    website: null,
    phone: null,
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zip: null,
    country: "US",
    establishedAt: null,
    logoUrl: null,
  });
});

/** Minimal valid form — tests override individual fields. The goal
 *  fields are required (the real form always posts them). */
function firmForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("name", "Kosloski Law");
  fd.set("country", "US");
  fd.set("dailyHoursGoal", "6.0");
  fd.set("monthlyBillableGoal", "200");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

describe("updateFirmAction", () => {
  test("updates the firm row on valid input", async () => {
    const res = await updateFirmAction(
      firmInitialState,
      firmForm({ city: "Denver", state: "CO" })
    );
    expect(res.status).toBe("ok");
    const firm = await prisma.firm.findUniqueOrThrow({
      where: { id: firmId },
    });
    expect(firm.name).toBe("Kosloski Law");
    expect(firm.city).toBe("Denver");
    expect(firm.state).toBe("CO");
  });

  test("rejects empty name with a field error", async () => {
    const res = await updateFirmAction(
      firmInitialState,
      firmForm({ name: "   " })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.name?.length).toBeGreaterThan(0);
  });

  describe("establishedAt", () => {
    test("stores YYYY-MM-DD as UTC midnight of that day (date-only, ADR-012)", async () => {
      const res = await updateFirmAction(
        firmInitialState,
        firmForm({ establishedAt: "2015-03-09" })
      );
      expect(res.status).toBe("ok");
      const firm = await prisma.firm.findUniqueOrThrow({
        where: { id: firmId },
        select: { establishedAt: true },
      });
      // Date-only values are UTC midnight regardless of the server's
      // zone: a server-local `new Date(2015, 2, 9)` is Mar 8 23:00Z
      // anywhere east of UTC and drifts a day on every re-save.
      expect(firm.establishedAt?.toISOString()).toBe("2015-03-09T00:00:00.000Z");
    });

    test("empty string nulls out the date", async () => {
      await prisma.firm.update({
        where: { id: firmId },
        data: { establishedAt: new Date("2015-03-09T00:00:00.000Z") },
      });
      const res = await updateFirmAction(
        firmInitialState,
        firmForm({ establishedAt: "" })
      );
      expect(res.status).toBe("ok");
      const firm = await prisma.firm.findUniqueOrThrow({
        where: { id: firmId },
        select: { establishedAt: true },
      });
      expect(firm.establishedAt).toBeNull();
    });

    test("malformed value returns a field error instead of crashing", async () => {
      // A tampered post ("abc") used to reach Prisma as an Invalid
      // Date and blow up with an unhandled runtime error.
      const res = await updateFirmAction(
        firmInitialState,
        firmForm({ establishedAt: "abc" })
      );
      expect(res.status).toBe("error");
      expect(res.errors?.establishedAt?.length).toBeGreaterThan(0);
      // And nothing was written.
      const firm = await prisma.firm.findUniqueOrThrow({
        where: { id: firmId },
      });
      expect(firm.name).toBe("Test Firm LLC");
      expect(firm.establishedAt).toBeNull();
    });
  });

  describe("permission gate", () => {
    test("a denied caller gets a form error (no redirect) and nothing is written", async () => {
      mockedGate.mockResolvedValue({
        ok: false,
        error: "You do not have permission to do that.",
      });
      const res = await updateFirmAction(firmInitialState, firmForm());
      expect(res.status).toBe("error");
      expect(res.errors?._form?.[0]).toMatch(/permission/);
      expect(mockedGate).toHaveBeenCalledWith("firm.edit_info");
      const firm = await prisma.firm.findUniqueOrThrow({
        where: { id: firmId },
      });
      expect(firm.name).not.toBe("Kosloski Law");
    });
  });

  describe("audit trail", () => {
    test("logs which fields changed without ever logging values like the EIN", async () => {
      const res = await updateFirmAction(
        firmInitialState,
        firmForm({
          ein: "12-3456789",
          city: "Denver",
          establishedAt: "2015-03-09",
          dailyHoursGoal: "7.5",
        })
      );
      expect(res.status).toBe("ok");
      const log = await prisma.activityLog.findFirstOrThrow({
        where: { userId: actorId, title: "Updated firm profile" },
      });
      expect(log.type).toBe("auth");
      expect(log.matterId).toBeNull();
      expect(log.detail).toContain("name");
      expect(log.detail).toContain("ein");
      expect(log.detail).toContain("city");
      expect(log.detail).toContain("establishedAt");
      expect(log.detail).toContain("dailyHoursGoal (6 -> 7.5)");
      expect(log.detail).not.toContain("monthlyBillableGoal");
      expect(log.detail).not.toContain("12-3456789");
      expect(log.detail).not.toContain("Denver");
    });

    test("an unchanged re-save writes no log row", async () => {
      const res = await updateFirmAction(
        firmInitialState,
        firmForm({ name: "Test Firm LLC" })
      );
      expect(res.status).toBe("ok");
      expect(
        await prisma.activityLog.count({
          where: { title: "Updated firm profile" },
        })
      ).toBe(0);
    });
  });

  describe("goal fields", () => {
    test("persists both goals as numbers", async () => {
      const res = await updateFirmAction(
        firmInitialState,
        firmForm({ dailyHoursGoal: "7.5", monthlyBillableGoal: "160" })
      );
      expect(res.status).toBe("ok");
      const firm = await prisma.firm.findUniqueOrThrow({
        where: { id: firmId },
        select: { dailyHoursGoal: true, monthlyBillableGoal: true },
      });
      expect(firm.dailyHoursGoal).toBe(7.5);
      expect(firm.monthlyBillableGoal).toBe(160);
    });

    test.each([
      ["empty", ""],
      ["non-numeric", "abc"],
      ["zero", "0"],
      ["negative", "-2"],
      ["two decimals", "6.25"],
      ["over the 24h ceiling", "25"],
    ])("rejects a %s dailyHoursGoal", async (_label, value) => {
      const res = await updateFirmAction(
        firmInitialState,
        firmForm({ dailyHoursGoal: value })
      );
      expect(res.status).toBe("error");
      expect(res.errors?.dailyHoursGoal?.length).toBeGreaterThan(0);
      // Nothing written — the row keeps the schema default.
      const firm = await prisma.firm.findUniqueOrThrow({
        where: { id: firmId },
        select: { dailyHoursGoal: true },
      });
      expect(firm.dailyHoursGoal).toBe(6.0);
    });

    test("rejects a monthlyBillableGoal above 744", async () => {
      const res = await updateFirmAction(
        firmInitialState,
        firmForm({ monthlyBillableGoal: "2000" })
      );
      expect(res.status).toBe("error");
      expect(res.errors?.monthlyBillableGoal?.length).toBeGreaterThan(0);
    });
  });
});
