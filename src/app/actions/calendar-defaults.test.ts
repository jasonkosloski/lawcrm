/**
 * Integration tests for the calendar-defaults actions.
 *
 * Pins: the permission keys (firm scope = firm.edit_info, matter scope
 * = matters.edit), the tri-state parse (inherit -> null, true/false ->
 * boolean), invalid input rejected without writing, an unknown matter
 * returning a form error instead of a Prisma throw, and the audit rows.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCurrentFirm } from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";
import {
  updateFirmCalendarDefaults,
  updateMatterCalendarDefaults,
} from "@/app/actions/calendar-defaults";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedRequire = vi.mocked(requirePermission);
const idle = { status: "idle" as const };

let firmId: string;
let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  firmId = (await seedFirm()).firmId;
  userId = (await seedUser({ firmId })).userId;
  const a = await seedPracticeArea();
  matterId = (
    await seedMatter({
      practiceAreaId: a.areaId,
      stageId: a.stageId,
      leadUserId: userId,
    })
  ).matterId;
  mockedRequire.mockReset();
  mockedRequire.mockResolvedValue(userId);
  vi.mocked(getCurrentFirm).mockResolvedValue({ id: firmId } as never);
});

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("updateFirmCalendarDefaults", () => {
  test("gates on firm.edit_info; checkbox present = true, absent = false; audits", async () => {
    const res = await updateFirmCalendarDefaults(
      idle,
      form({ autoAddTeamToNewEvents: "on" })
    );
    expect(res.status).toBe("ok");
    expect(mockedRequire).toHaveBeenCalledWith("firm.edit_info");
    const firm = await prisma.firm.findUniqueOrThrow({ where: { id: firmId } });
    expect(firm.autoAddTeamToNewEvents).toBe(true);
    expect(firm.autoAddTeamToUpcomingEvents).toBe(false);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Firm calendar defaults updated" },
    });
    expect(log.detail).toBe(
      "Auto-add team to new events: on; to upcoming events: off"
    );
  });

  test("rejects a non-'on' value without writing", async () => {
    const res = await updateFirmCalendarDefaults(
      idle,
      form({ autoAddTeamToNewEvents: "yes" })
    );
    expect(res.status).toBe("error");
    const firm = await prisma.firm.findUniqueOrThrow({ where: { id: firmId } });
    expect(firm.autoAddTeamToNewEvents).toBe(true); // schema default untouched
  });

  test("a denied permission propagates and writes nothing", async () => {
    mockedRequire.mockRejectedValue(new Error("__DENIED__"));
    await expect(
      updateFirmCalendarDefaults(idle, form({}))
    ).rejects.toThrow("__DENIED__");
    const firm = await prisma.firm.findUniqueOrThrow({ where: { id: firmId } });
    expect(firm.autoAddTeamToUpcomingEvents).toBe(true);
  });
});

describe("updateMatterCalendarDefaults", () => {
  test("gates on matters.edit and parses the tri-state: true / false / inherit -> null", async () => {
    const res = await updateMatterCalendarDefaults(
      matterId,
      idle,
      form({
        autoAddTeamToNewEvents: "true",
        autoAddTeamToUpcomingEvents: "false",
      })
    );
    expect(res.status).toBe("ok");
    expect(mockedRequire).toHaveBeenCalledWith("matters.edit");
    let m = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(m.autoAddTeamToNewEvents).toBe(true);
    expect(m.autoAddTeamToUpcomingEvents).toBe(false);

    await updateMatterCalendarDefaults(
      matterId,
      idle,
      form({
        autoAddTeamToNewEvents: "inherit",
        autoAddTeamToUpcomingEvents: "inherit",
      })
    );
    m = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(m.autoAddTeamToNewEvents).toBeNull();
    expect(m.autoAddTeamToUpcomingEvents).toBeNull();
  });

  test("missing fields default to inherit (null)", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { autoAddTeamToNewEvents: true },
    });
    await updateMatterCalendarDefaults(matterId, idle, form({}));
    const m = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(m.autoAddTeamToNewEvents).toBeNull();
  });

  test("an invalid value is rejected without writing", async () => {
    const res = await updateMatterCalendarDefaults(
      matterId,
      idle,
      form({ autoAddTeamToNewEvents: "maybe" })
    );
    expect(res.status).toBe("error");
    expect(await prisma.activityLog.count()).toBe(0);
  });

  test("an unknown matter returns a form error instead of throwing", async () => {
    const res = await updateMatterCalendarDefaults("nope", idle, form({}));
    expect(res).toEqual({ status: "error", error: "Matter not found." });
  });

  test("writes a matter-scoped audit row", async () => {
    await updateMatterCalendarDefaults(
      matterId,
      idle,
      form({ autoAddTeamToNewEvents: "false" })
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Matter calendar defaults updated" },
    });
    expect(log.matterId).toBe(matterId);
    expect(log.detail).toContain("new events: false");
  });
});
