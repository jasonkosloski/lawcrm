/**
 * Tests for the attorney helpers: bar-number lookup (pure) and the
 * attorney check against the database.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { barNumberFor, isAttorney } from "@/lib/attorneys";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

describe("barNumberFor", () => {
  const admissions = [
    { state: "CO", number: "1" },
    { state: "WY", number: "2" },
  ];

  test("matches a state by its name", () => {
    expect(barNumberFor(admissions, "Colorado")).toBe("1");
  });

  test("matches a state by its code, ignoring case and spacing", () => {
    expect(barNumberFor(admissions, " wy ")).toBe("2");
  });

  test("returns null when the state has no admission", () => {
    expect(barNumberFor(admissions, "UT")).toBeNull();
  });

  test("returns null for missing or unmatched text", () => {
    expect(barNumberFor(admissions, null)).toBeNull();
    expect(barNumberFor(admissions, "Narnia")).toBeNull();
  });
});

describe("isAttorney", () => {
  let firmId: string;

  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    firmId = (await seedFirm()).firmId;
  });

  test("is true for an active user with a bar admission", async () => {
    const { userId } = await seedUser({ firmId });
    await prisma.barAdmission.create({ data: { userId, state: "CO", number: "123" } });
    expect(await isAttorney(userId)).toBe(true);
  });

  test("is false for an active user with no bar admission", async () => {
    const { userId } = await seedUser({ firmId });
    expect(await isAttorney(userId)).toBe(false);
  });

  test("is false for an inactive user even with a bar admission", async () => {
    const { userId } = await seedUser({ firmId, isActive: false });
    await prisma.barAdmission.create({ data: { userId, state: "CO", number: "123" } });
    expect(await isAttorney(userId)).toBe(false);
  });
});
