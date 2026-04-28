/**
 * Integration tests for the calendar-defaults resolver.
 *
 * The resolver merges per-matter overrides on top of firm-wide
 * defaults — null on the matter inherits the firm value, true/
 * false on the matter overrides. These tests pin every
 * combination so a future schema change can't silently flip the
 * fallback semantics.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { getEffectiveCalendarDefaults } from "@/lib/calendar-defaults";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let firmId: string;
let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  const u = await seedUser({ firmId });
  userId = u.userId;
  const a = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: a.areaId,
    stageId: a.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getEffectiveCalendarDefaults", () => {
  test("matter null + firm true → effective true (inherit)", async () => {
    // seedFirm uses the schema defaults (true for both); seedMatter
    // doesn't set the override fields, so they stay null.
    const eff = await getEffectiveCalendarDefaults(matterId);
    expect(eff).toEqual({
      autoAddTeamToNewEvents: true,
      autoAddTeamToUpcomingEvents: true,
    });
  });

  test("matter null + firm false → effective false (inherit)", async () => {
    await prisma.firm.update({
      where: { id: firmId },
      data: {
        autoAddTeamToNewEvents: false,
        autoAddTeamToUpcomingEvents: false,
      },
    });
    const eff = await getEffectiveCalendarDefaults(matterId);
    expect(eff).toEqual({
      autoAddTeamToNewEvents: false,
      autoAddTeamToUpcomingEvents: false,
    });
  });

  test("matter true + firm false → effective true (override wins)", async () => {
    await prisma.firm.update({
      where: { id: firmId },
      data: {
        autoAddTeamToNewEvents: false,
        autoAddTeamToUpcomingEvents: false,
      },
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: {
        autoAddTeamToNewEvents: true,
        autoAddTeamToUpcomingEvents: true,
      },
    });
    const eff = await getEffectiveCalendarDefaults(matterId);
    expect(eff).toEqual({
      autoAddTeamToNewEvents: true,
      autoAddTeamToUpcomingEvents: true,
    });
  });

  test("matter false + firm true → effective false (override wins)", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: {
        autoAddTeamToNewEvents: false,
        autoAddTeamToUpcomingEvents: false,
      },
    });
    const eff = await getEffectiveCalendarDefaults(matterId);
    expect(eff).toEqual({
      autoAddTeamToNewEvents: false,
      autoAddTeamToUpcomingEvents: false,
    });
  });

  test("missing matter → both false (defensive)", async () => {
    const eff = await getEffectiveCalendarDefaults("no-such-matter");
    expect(eff).toEqual({
      autoAddTeamToNewEvents: false,
      autoAddTeamToUpcomingEvents: false,
    });
  });
});
