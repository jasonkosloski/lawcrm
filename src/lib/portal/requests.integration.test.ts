import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { countOpenRequestsByMatter, listPortalRequests } from "./requests";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let identityId: string;
let matterA: string;
let matterB: string;
let userId: string;

async function mkReq(
  matterId: string,
  title: string,
  extra: Partial<{ status: string; dueDate: Date; returnNote: string }> = {}
) {
  return prisma.documentRequest.create({
    data: { matterId, title, createdById: userId, ...extra },
  });
}

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  const { contactId } = await seedContact({ email: "jane@example.com" });
  const ident = await prisma.portalIdentity.create({
    data: { contactId, email: "jane@example.com" },
  });
  identityId = ident.id;
  const mk = (name: string) =>
    seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name });
  matterA = (await mk("A")).matterId;
  matterB = (await mk("B")).matterId;
  await prisma.portalMatterAccess.create({
    data: { identityId, matterId: matterA, invitedById: userId },
  });
});

describe("listPortalRequests", () => {
  test("groups by status, excludes cancelled, flags overdue and carries the note", async () => {
    await mkReq(matterA, "Open one", { dueDate: new Date("2000-01-01T00:00:00Z") });
    await mkReq(matterA, "Sent back", { returnNote: "Need page 2" });
    await mkReq(matterA, "Future", { dueDate: new Date("2999-01-01T00:00:00Z") });
    await mkReq(matterA, "Submitted one", { status: "submitted" });
    await mkReq(matterA, "Complete one", { status: "complete" });
    await mkReq(matterA, "Cancelled one", { status: "cancelled" });
    const r = await listPortalRequests(identityId, matterA);
    expect(r.open.map((x) => x.title).sort()).toEqual(["Future", "Open one", "Sent back"]);
    expect(r.open.find((x) => x.title === "Open one")).toMatchObject({
      overdue: true,
      dueDate: "2000-01-01",
    });
    expect(r.open.find((x) => x.title === "Future")?.overdue).toBe(false);
    expect(r.open.find((x) => x.title === "Sent back")?.returnNote).toBe("Need page 2");
    expect(r.submitted.map((x) => x.title)).toEqual(["Submitted one"]);
    expect(r.done.map((x) => x.title)).toEqual(["Complete one"]);
  });

  test("returns nothing without live access", async () => {
    await mkReq(matterB, "Not mine");
    const r = await listPortalRequests(identityId, matterB);
    expect(r).toEqual({ open: [], submitted: [], done: [] });
  });
});

describe("countOpenRequestsByMatter", () => {
  test("counts only open requests on live-access matters", async () => {
    await mkReq(matterA, "1");
    await mkReq(matterA, "2");
    await mkReq(matterA, "3", { status: "submitted" });
    await mkReq(matterB, "other");
    const m = await countOpenRequestsByMatter(identityId);
    expect(m.get(matterA)).toBe(2);
    expect(m.has(matterB)).toBe(false);
  });
});
