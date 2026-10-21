import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedCalendarEvent,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { getPortalMatterStatus, latestStageLabels } from "./status";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

const EMPTY = { updates: [], upcoming: [], past: [] };

let firmId: string;
let identityId: string;
let matterA: string;
let matterB: string;
let userId: string;

async function mkUpdate(matterId: string, stageLabel: string, postedAt: Date, extra: { editedAt?: Date } = {}) {
  return prisma.portalStatusUpdate.create({
    data: { matterId, stageLabel, body: `body ${stageLabel}`, postedById: userId, postedAt, ...extra },
  });
}

async function share(eventId: string, matterId: string, clientTitle = "Client title", clientNote: string | null = null) {
  return prisma.portalSharedEvent.create({
    data: { eventId, matterId, clientTitle, clientNote, sharedById: userId },
  });
}

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  const { contactId } = await seedContact({ email: "jane@example.com" });
  identityId = (await prisma.portalIdentity.create({ data: { contactId, email: "jane@example.com" } })).id;
  const mk = (name: string) => seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name });
  matterA = (await mk("A")).matterId;
  matterB = (await mk("B")).matterId;
  await prisma.portalMatterAccess.create({ data: { identityId, matterId: matterA, invitedById: userId } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getPortalMatterStatus", () => {
  test("returns updates newest first with edited flag", async () => {
    await mkUpdate(matterA, "Intake", new Date("2026-01-01T00:00:00Z"));
    await mkUpdate(matterA, "Discovery", new Date("2026-02-01T00:00:00Z"), { editedAt: new Date("2026-02-02T00:00:00Z") });
    const r = await getPortalMatterStatus(identityId, matterA);
    expect(r.updates.map((u) => u.stageLabel)).toEqual(["Discovery", "Intake"]);
    expect(r.updates.map((u) => u.edited)).toEqual([true, false]);
  });

  test("returns nothing when access revoked", async () => {
    await mkUpdate(matterA, "Intake", new Date());
    await prisma.portalMatterAccess.updateMany({ where: { identityId }, data: { revokedAt: new Date() } });
    expect(await getPortalMatterStatus(identityId, matterA)).toEqual(EMPTY);
  });

  test("returns nothing when portal off", async () => {
    await mkUpdate(matterA, "Intake", new Date());
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect(await getPortalMatterStatus(identityId, matterA)).toEqual(EMPTY);
  });

  test("returns nothing when identity disabled", async () => {
    await mkUpdate(matterA, "Intake", new Date());
    await prisma.portalIdentity.update({ where: { id: identityId }, data: { disabledAt: new Date() } });
    expect(await getPortalMatterStatus(identityId, matterA)).toEqual(EMPTY);
  });

  test("hides a shared event re-filed to another matter on both matters", async () => {
    await prisma.portalMatterAccess.create({ data: { identityId, matterId: matterB, invitedById: userId } });
    const { eventId } = await seedCalendarEvent({ matterId: matterA, startTime: new Date("2999-01-01T15:00:00Z") });
    await share(eventId, matterA);
    expect((await getPortalMatterStatus(identityId, matterA)).upcoming).toHaveLength(1);
    await prisma.calendarEvent.update({ where: { id: eventId }, data: { matterId: matterB } });
    expect((await getPortalMatterStatus(identityId, matterA)).upcoming).toEqual([]);
    expect((await getPortalMatterStatus(identityId, matterB)).upcoming).toEqual([]);
  });

  test("never exposes the internal event title or description", async () => {
    const { eventId } = await seedCalendarEvent({ matterId: matterA, title: "INTERNAL-TITLE-XYZ", startTime: new Date("2999-01-01T15:00:00Z") });
    await prisma.calendarEvent.update({ where: { id: eventId }, data: { description: "INTERNAL-DESC-XYZ", location: "Courtroom 4" } });
    await share(eventId, matterA, "Hearing", "Bring ID");
    const r = await getPortalMatterStatus(identityId, matterA);
    expect(r.upcoming[0]).toMatchObject({ title: "Hearing", note: "Bring ID", location: "Courtroom 4" });
    const json = JSON.stringify(r);
    expect(json).not.toContain("INTERNAL-TITLE-XYZ");
    expect(json).not.toContain("INTERNAL-DESC-XYZ");
  });

  test("splits upcoming ascending and past descending", async () => {
    const mk = async (iso: string) => {
      const { eventId } = await seedCalendarEvent({ matterId: matterA, startTime: new Date(iso) });
      await share(eventId, matterA, iso);
    };
    await mk("2999-03-01T15:00:00Z");
    await mk("2999-01-01T15:00:00Z");
    await mk("2000-01-01T15:00:00Z");
    await mk("2001-01-01T15:00:00Z");
    const r = await getPortalMatterStatus(identityId, matterA);
    expect(r.upcoming.map((e) => e.title)).toEqual(["2999-01-01T15:00:00Z", "2999-03-01T15:00:00Z"]);
    expect(r.past.map((e) => e.title)).toEqual(["2001-01-01T15:00:00Z", "2000-01-01T15:00:00Z"]);
  });

  test("all-day event today in Denver is upcoming", async () => {
    // 23:30 Denver on 2026-10-20 (MDT) is already 2026-10-21 in UTC.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-21T05:30:00Z") });
    const day = new Date("2026-10-20T00:00:00Z");
    const allDay = await seedCalendarEvent({ matterId: matterA, isAllDay: true, startTime: day, endTime: day });
    await share(allDay.eventId, matterA, "all-day");
    const yesterday = new Date("2026-10-19T00:00:00Z");
    const old = await seedCalendarEvent({ matterId: matterA, isAllDay: true, startTime: yesterday, endTime: yesterday });
    await share(old.eventId, matterA, "yesterday");
    const timed = await seedCalendarEvent({
      matterId: matterA,
      startTime: new Date("2026-10-21T04:00:00Z"),
      endTime: new Date("2026-10-21T04:30:00Z"),
    });
    await share(timed.eventId, matterA, "timed tonight");
    const r = await getPortalMatterStatus(identityId, matterA);
    expect(r.upcoming.map((e) => e.title).sort()).toEqual(["all-day", "timed tonight"]);
    expect(r.past.map((e) => e.title)).toEqual(["yesterday"]);
  });

  test("archived matter stays readable", async () => {
    await mkUpdate(matterA, "Closed out", new Date());
    await prisma.matter.update({ where: { id: matterA }, data: { isArchived: true } });
    expect((await getPortalMatterStatus(identityId, matterA)).updates).toHaveLength(1);
  });
});

describe("latestStageLabels", () => {
  test("returns only matters with live access", async () => {
    await mkUpdate(matterA, "Old", new Date("2026-01-01T00:00:00Z"));
    await mkUpdate(matterA, "Newest", new Date("2026-03-01T00:00:00Z"));
    await mkUpdate(matterB, "Hidden", new Date());
    const m = await latestStageLabels(identityId, [matterA, matterB]);
    expect(m.get(matterA)).toBe("Newest");
    expect(m.has(matterB)).toBe(false);
  });
});
