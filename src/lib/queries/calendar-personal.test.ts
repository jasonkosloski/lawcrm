/**
 * Integration tests for the personal-event visibility scope on
 * `getCalendarItems`.
 *
 * Personal events (events with `ownerUserId` set) are private to
 * their owner. Matter events + legacy firm-wide events
 * (ownerUserId IS NULL) are visible to everyone in the firm.
 * These tests pin both branches in place so a future refactor
 * can't silently broaden the scope.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getCalendarItems } from "@/lib/queries/calendar";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let aliceId: string;
let bobId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  const a = await seedUser({ firmId, name: "Alice", email: "alice@firm.com" });
  aliceId = a.userId;
  const b = await seedUser({ firmId, name: "Bob", email: "bob@firm.com" });
  bobId = b.userId;
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: aliceId,
  });
  matterId = m.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

const seedEvent = (data: {
  title: string;
  matterId?: string | null;
  ownerUserId?: string | null;
  start?: Date;
  end?: Date;
}) =>
  prisma.calendarEvent.create({
    data: {
      title: data.title,
      type: "meeting",
      startTime: data.start ?? new Date("2026-07-01T10:00:00Z"),
      endTime: data.end ?? new Date("2026-07-01T11:00:00Z"),
      matterId: data.matterId ?? null,
      ownerUserId: data.ownerUserId ?? null,
    },
  });

const range = {
  start: new Date("2026-06-01"),
  end: new Date("2026-08-01"),
};

describe("getCalendarItems — personal-event visibility", () => {
  test("matter events are visible to everyone", async () => {
    await seedEvent({ title: "Matter event", matterId });
    mockedGetUser.mockResolvedValue(aliceId);
    const aliceSees = await getCalendarItems(range.start, range.end);
    mockedGetUser.mockResolvedValue(bobId);
    const bobSees = await getCalendarItems(range.start, range.end);
    expect(aliceSees.find((i) => i.title === "Matter event")).toBeDefined();
    expect(bobSees.find((i) => i.title === "Matter event")).toBeDefined();
  });

  test("personal events are visible only to their owner", async () => {
    await seedEvent({
      title: "Alice's lunch block",
      ownerUserId: aliceId,
    });
    mockedGetUser.mockResolvedValue(aliceId);
    const aliceSees = await getCalendarItems(range.start, range.end);
    expect(
      aliceSees.find((i) => i.title === "Alice's lunch block")
    ).toBeDefined();

    mockedGetUser.mockResolvedValue(bobId);
    const bobSees = await getCalendarItems(range.start, range.end);
    expect(
      bobSees.find((i) => i.title === "Alice's lunch block")
    ).toBeUndefined();
  });

  test("legacy firm-wide events (matterId + ownerUserId both null) are visible to everyone", async () => {
    await seedEvent({ title: "Firm meeting" }); // both nulls
    mockedGetUser.mockResolvedValue(aliceId);
    const aliceSees = await getCalendarItems(range.start, range.end);
    mockedGetUser.mockResolvedValue(bobId);
    const bobSees = await getCalendarItems(range.start, range.end);
    expect(aliceSees.find((i) => i.title === "Firm meeting")).toBeDefined();
    expect(bobSees.find((i) => i.title === "Firm meeting")).toBeDefined();
  });

  test("each user sees their own personal events alongside shared events", async () => {
    await seedEvent({ title: "Matter event", matterId });
    await seedEvent({ title: "Alice personal", ownerUserId: aliceId });
    await seedEvent({ title: "Bob personal", ownerUserId: bobId });

    mockedGetUser.mockResolvedValue(aliceId);
    const aliceTitles = (await getCalendarItems(range.start, range.end)).map(
      (i) => i.title
    );
    expect(aliceTitles).toContain("Matter event");
    expect(aliceTitles).toContain("Alice personal");
    expect(aliceTitles).not.toContain("Bob personal");

    mockedGetUser.mockResolvedValue(bobId);
    const bobTitles = (await getCalendarItems(range.start, range.end)).map(
      (i) => i.title
    );
    expect(bobTitles).toContain("Matter event");
    expect(bobTitles).toContain("Bob personal");
    expect(bobTitles).not.toContain("Alice personal");
  });
});
