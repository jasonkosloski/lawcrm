/**
 * Private events (ADR-037): `CalendarEvent.visibility = "private"`
 * shows details to the CREATOR ONLY. Everyone else - invitees, the
 * matter team, a viewer whose creator profile says "show details to
 * everyone" - gets a Busy block on every read surface: calendar
 * grid, event modal, matter Events tab, global search and the
 * dashboard agenda. The creator's show-details profile default can
 * never leak a private event.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getCalendarEventById, getCalendarItems } from "@/lib/queries/calendar";
import { getMatterEvents } from "@/lib/queries/matter-detail";
import { globalSearch } from "@/lib/queries/search";
import { getTodayAgenda } from "@/lib/queries/dashboard";
import {
  resetDb,
  seedCalendarEvent,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

const NOW = new Date("2026-06-15T18:00:00Z");
const START = new Date("2026-06-15T19:00:00Z");
const END = new Date("2026-06-15T20:00:00Z");
const RANGE_START = new Date("2026-06-01T00:00:00Z");
const RANGE_END = new Date("2026-06-30T23:59:59Z");
const TITLE = "Zebracorn deposition prep";

let creatorId: string;
let teammateId: string;
let inviteeId: string;
let strangerId: string;
let matterId: string;
let eventId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  creatorId = (await seedUser({ firmId, name: "Creator", email: "c@f.com" })).userId;
  teammateId = (await seedUser({ firmId, name: "Teammate", email: "t@f.com" })).userId;
  inviteeId = (await seedUser({ firmId, name: "Invitee", email: "i@f.com" })).userId;
  strangerId = (await seedUser({ firmId, name: "Stranger", email: "s@f.com" })).userId;
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: creatorId,
  }));
  await prisma.matterTeamMember.create({
    data: { matterId, userId: teammateId, role: "co_counsel" },
  });
  // The creator shares details firm-wide by profile default; a private
  // event must still be hidden.
  await prisma.user.update({
    where: { id: creatorId },
    data: { defaultEventVisibility: "show_details" },
  });
  ({ eventId } = await seedCalendarEvent({
    createdById: creatorId,
    matterId,
    title: TITLE,
    visibility: "private",
    startTime: START,
    endTime: END,
    attendees: [{ userId: inviteeId, name: "Invitee" }],
  }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// Ids are only known after beforeEach seeds them, so the table holds
// resolvers (a test.each row built at collection time would be undefined).
const viewers = () =>
  [
    ["invitee", () => inviteeId],
    ["matter teammate", () => teammateId],
    ["stranger", () => strangerId],
  ] as const;

describe("private events - calendar grid and modal", () => {
  test.each(viewers())("%s sees Busy with the times intact", async (_label, getUid) => {
    const uid = getUid();
    mockedGetUser.mockResolvedValue(uid);
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const evt = items.find((i) => i.kind === "event" && i.id === eventId);
    if (evt?.kind !== "event") throw new Error("event missing");
    expect(evt.viewerCanSeeDetails).toBe(false);
    expect(evt.title).toBe("Busy");
    expect(evt.startTime).toEqual(START);
    expect(evt.matterName).toBeNull();
    expect(evt.attendeeNames).toEqual([]);
    expect(JSON.stringify(items)).not.toContain(TITLE);

    const detail = await getCalendarEventById(eventId);
    expect(detail?.viewerCanSeeDetails).toBe(false);
    expect(detail?.title).toBe("Busy");
    expect(detail?.attendees).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain(TITLE);
  });

  test("the creator sees full details", async () => {
    mockedGetUser.mockResolvedValue(creatorId);
    const detail = await getCalendarEventById(eventId);
    expect(detail?.viewerCanSeeDetails).toBe(true);
    expect(detail?.title).toBe(TITLE);
    expect(detail?.visibility).toBe("private");
  });

  test("a non-private event of the same creator is still shared by the profile default", async () => {
    const { eventId: shared } = await seedCalendarEvent({
      createdById: creatorId,
      title: "Shared lunch",
      visibility: "default",
      startTime: START,
      endTime: END,
    });
    mockedGetUser.mockResolvedValue(strangerId);
    expect((await getCalendarEventById(shared))?.title).toBe("Shared lunch");
  });
});

describe("private events - matter Events tab", () => {
  test.each(viewers())("%s gets a Busy shell", async (_label, getUid) => {
    const uid = getUid();
    mockedGetUser.mockResolvedValue(uid);
    const rows = await getMatterEvents(matterId);
    expect(rows).toHaveLength(1);
    expect(rows[0].viewerCanSeeDetails).toBe(false);
    expect(rows[0].title).toBe("Busy");
    expect(JSON.stringify(rows)).not.toContain(TITLE);
  });

  test("the creator sees the row", async () => {
    mockedGetUser.mockResolvedValue(creatorId);
    expect((await getMatterEvents(matterId))[0].title).toBe(TITLE);
  });
});

describe("private events - search and dashboard agenda", () => {
  test.each(viewers())("%s never finds it by title in search", async (_label, getUid) => {
    const uid = getUid();
    mockedGetUser.mockResolvedValue(uid);
    const res = await globalSearch("Zebracorn");
    const events = res.groups.find((g) => g.type === "event");
    expect(events?.hits ?? []).toHaveLength(0);
    expect(JSON.stringify(res)).not.toContain(TITLE);
  });

  test("the creator finds it in search", async () => {
    mockedGetUser.mockResolvedValue(creatorId);
    const res = await globalSearch("Zebracorn");
    expect(res.groups.find((g) => g.type === "event")?.hits).toHaveLength(1);
  });

  test.each(viewers())("%s sees Busy on the agenda", async (_label, getUid) => {
    const uid = getUid();
    mockedGetUser.mockResolvedValue(uid);
    const agenda = await getTodayAgenda("America/Denver");
    expect(agenda).toHaveLength(1);
    expect(agenda[0].title).toBe("Busy");
  });

  test("the creator sees the title on the agenda", async () => {
    mockedGetUser.mockResolvedValue(creatorId);
    const agenda = await getTodayAgenda("America/Denver");
    expect(agenda[0].title).toBe(TITLE);
  });
});
