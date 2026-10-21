/**
 * Integration tests for the per-user email notification settings:
 * category modes (with the deadline guard), matter email mute (behind
 * the matter wall), and the settings reads.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  setMatterEmailMute,
  setNotificationEmailMode,
} from "@/app/actions/notification-preferences";
import {
  getNotificationEmailSettings,
  isMatterEmailMuted,
} from "@/lib/queries/notification-preferences";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let firmId: string;
let userId: string;
let otherId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  ({ userId } = await seedUser({ firmId }));
  ({ userId: otherId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Smith v. Jones",
  }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
});

describe("setNotificationEmailMode", () => {
  test("saves a mode", async () => {
    expect(await setNotificationEmailMode("tasks", "digest")).toEqual({ ok: true });
    expect(await setNotificationEmailMode("tasks", "off")).toEqual({ ok: true });
    const rows = await prisma.notificationPreference.findMany({ where: { userId } });
    expect(rows.map((r) => [r.category, r.emailMode])).toEqual([["tasks", "off"]]);
  });

  test("rejects unknown category", async () => {
    const res = await setNotificationEmailMode("weather", "off");
    expect(res.ok).toBe(false);
    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  test("rejects deadlines off", async () => {
    const res = await setNotificationEmailMode("deadlines", "off");
    expect(res.ok).toBe(false);
    expect(await setNotificationEmailMode("deadlines", "digest")).toEqual({ ok: true });
  });

  test("leaving digest releases that category's held rows", async () => {
    const held = (type: string, user = userId) =>
      prisma.notification.create({
        data: { userId: user, type, title: "x", emailState: "held" },
        select: { id: true },
      });
    const task = await held("task_assigned");
    const billing = await held("invoice_payment_recorded");
    const othersTask = await held("task_assigned", otherId);
    await setNotificationEmailMode("tasks", "digest");
    await setNotificationEmailMode("tasks", "instant");
    const state = async (id: string) =>
      (await prisma.notification.findUniqueOrThrow({ where: { id } })).emailState;
    expect(await state(task.id)).toBe("pending");
    expect(await state(billing.id)).toBe("held");
    expect(await state(othersTask.id)).toBe("held");
  });

  test("only touches the caller's preferences", async () => {
    await setNotificationEmailMode("billing", "off");
    expect(await prisma.notificationPreference.count({ where: { userId: otherId } })).toBe(0);
  });
});

describe("setMatterEmailMute", () => {
  test("mute and unmute idempotent", async () => {
    expect(await setMatterEmailMute(matterId, true)).toEqual({ ok: true, muted: true });
    expect(await setMatterEmailMute(matterId, true)).toEqual({ ok: true, muted: true });
    expect(await isMatterEmailMuted(userId, matterId)).toBe(true);
    expect(await setMatterEmailMute(matterId, false)).toEqual({ ok: true, muted: false });
    expect(await setMatterEmailMute(matterId, false)).toEqual({ ok: true, muted: false });
    expect(await isMatterEmailMuted(userId, matterId)).toBe(false);
  });

  test("mute requires matter access", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    vi.mocked(getCurrentUserId).mockResolvedValue(otherId);
    await expect(setMatterEmailMute(matterId, true)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.notificationMatterMute.count()).toBe(0);
  });
});

describe("getNotificationEmailSettings", () => {
  test("settings defaults to instant for every category", async () => {
    const s = await getNotificationEmailSettings(userId);
    expect(Object.values(s.modes).every((m) => m === "instant")).toBe(true);
    expect(Object.keys(s.modes)).toHaveLength(7);
    expect(s.mutedMatters).toEqual([]);
  });

  test("reflects saved modes and mutes", async () => {
    await setNotificationEmailMode("portal", "digest");
    await setMatterEmailMute(matterId, true);
    const s = await getNotificationEmailSettings(userId);
    expect(s.modes.portal).toBe("digest");
    expect(s.mutedMatters).toEqual([{ id: matterId, name: "Smith v. Jones" }]);
  });

  test("muted list hides matters the user can no longer see", async () => {
    await prisma.notificationMatterMute.create({ data: { userId: otherId, matterId } });
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    const s = await getNotificationEmailSettings(otherId);
    expect(s.mutedMatters).toEqual([]);
  });
});
