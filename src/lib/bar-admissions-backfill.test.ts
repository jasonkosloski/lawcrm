/**
 * The bar_admissions migration backfills existing User.barNumber values
 * under the firm's state. The migration already ran on an empty DB, so
 * these tests re-run its backfill section against seeded rows.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const MARKER = "-- Backfill: existing bar numbers move to the firm's state.";

function backfillSql(): string {
  const file = path.join(
    process.cwd(),
    "prisma/migrations/20261023140000_bar_admissions/migration.sql",
  );
  const text = readFileSync(file, "utf8");
  const at = text.indexOf(MARKER);
  if (at < 0) throw new Error("backfill marker not found in migration");
  return text.slice(at + MARKER.length);
}

async function seed(state: string | null, barNumber: string | null) {
  const { firmId } = await seedFirm();
  await prisma.firm.update({ where: { id: firmId }, data: { state } });
  const { userId } = await seedUser({ firmId });
  await prisma.user.update({ where: { id: userId }, data: { barNumber } });
  return userId;
}

async function rowsFor(userId: string) {
  return prisma.barAdmission.findMany({
    where: { userId },
    select: { state: true, number: true },
  });
}

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

describe("bar_admissions backfill", () => {
  test("a state code maps the trimmed number to that state", async () => {
    const userId = await seed("CO", " 12345 ");
    await prisma.$executeRawUnsafe(backfillSql());
    expect(await rowsFor(userId)).toEqual([{ state: "CO", number: "12345" }]);
  });

  test("a state name maps to its code", async () => {
    const userId = await seed("Colorado", "777");
    await prisma.$executeRawUnsafe(backfillSql());
    expect(await rowsFor(userId)).toEqual([{ state: "CO", number: "777" }]);
  });

  test("punctuated and multi-word names normalize like stateCode", async () => {
    const userId = await seed("  new   york ", "9");
    await prisma.$executeRawUnsafe(backfillSql());
    expect(await rowsFor(userId)).toEqual([{ state: "NY", number: "9" }]);
    await resetDb();
    const vi = await seed("U.S. Virgin Islands", "10");
    await prisma.$executeRawUnsafe(backfillSql());
    expect(await rowsFor(vi)).toEqual([{ state: "VI", number: "10" }]);
  });

  test("a null or unknown firm state produces no row", async () => {
    const a = await seed(null, "111");
    await resetDb();
    const b = await seed("Narnia", "222");
    await prisma.$executeRawUnsafe(backfillSql());
    expect(await rowsFor(a)).toEqual([]);
    expect(await rowsFor(b)).toEqual([]);
  });

  test("a blank or missing number produces no row", async () => {
    const a = await seed("CO", "   ");
    await prisma.$executeRawUnsafe(backfillSql());
    expect(await rowsFor(a)).toEqual([]);
    await resetDb();
    const b = await seed("CO", null);
    await prisma.$executeRawUnsafe(backfillSql());
    expect(await rowsFor(b)).toEqual([]);
  });

  test("running it twice leaves one row", async () => {
    const userId = await seed("CO", "12345");
    await prisma.$executeRawUnsafe(backfillSql());
    await prisma.$executeRawUnsafe(backfillSql());
    expect(await rowsFor(userId)).toEqual([{ state: "CO", number: "12345" }]);
  });
});
