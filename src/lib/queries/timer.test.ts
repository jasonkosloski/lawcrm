/**
 * Tests for the timer widget queries.
 *
 * getCurrentTimerSession feeds the AppShell widget on every page, so
 * it must (a) resolve the user through the request-cached
 * getCurrentUserId rather than a bare auth() (every auth() runs the
 * jwt callback's DB lookup), (b) return only the viewer's own session,
 * and (c) hand the client an ISO string.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
// Guard: the query must not reach for the session itself.
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(() => {
    throw new Error("getCurrentTimerSession must not call getSession() directly");
  }),
}));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentTimerSession, getTimerMatterOptions } from "./timer";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let otherUserId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId, email: "me@example.com" })).userId;
  otherUserId = (await seedUser({ firmId, email: "you@example.com" })).userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  const area = await seedPracticeArea();
  matterId = (
    await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    })
  ).matterId;
});

describe("getCurrentTimerSession", () => {
  test("null when nothing is running", async () => {
    expect(await getCurrentTimerSession()).toBeNull();
  });

  test("returns the viewer's session with ISO startedAt, matter name and color", async () => {
    const startedAt = new Date("2026-06-15T16:00:00Z");
    await prisma.timerSession.create({
      data: { userId, matterId, activity: "Deposition prep", startedAt },
    });
    await prisma.timerSession.create({
      data: { userId: otherUserId, activity: "Not mine" },
    });

    const session = await getCurrentTimerSession();

    expect(session).toMatchObject({
      matterId,
      activity: "Deposition prep",
      startedAt: "2026-06-15T16:00:00.000Z",
    });
    expect(session!.matterName).toBeTruthy();
    expect(session!.matterColor).toBeTruthy();
  });

  test("a matterless session has null matter fields", async () => {
    await prisma.timerSession.create({ data: { userId } });
    expect(await getCurrentTimerSession()).toMatchObject({
      matterId: null,
      matterName: null,
      matterColor: null,
    });
  });
});

describe("getTimerMatterOptions", () => {
  test("lists active matters only, id + name", async () => {
    const options = await getTimerMatterOptions();
    expect(options.map((o) => o.id)).toContain(matterId);
    expect(Object.keys(options[0]!).sort()).toEqual(["id", "name"]);

    await prisma.matter.update({
      where: { id: matterId },
      data: { isArchived: true },
    });
    expect((await getTimerMatterOptions()).map((o) => o.id)).not.toContain(matterId);
  });
});
