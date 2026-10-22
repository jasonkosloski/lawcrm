/**
 * Integration tests (real DB) for the "Needs me now" triage query:
 * matter-wall scoping, the viewer's-day boundary, per-group caps with
 * exact "+N more" counts, and permission-omitted groups.
 *
 * Clock frozen at 2026-06-16T02:00Z = June 15, 8pm in Denver, so the
 * viewer's "today" is June 15 in Denver and June 16 in UTC.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getTriage, TRIAGE_GROUP_LIMIT } from "@/lib/queries/dashboard-triage";
import {
  resetDb,
  seedFirm,
  seedDocument,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const NOW = new Date("2026-06-16T02:00:00Z");
const DENVER = "America/Denver";

let firmId: string;
let adminRoleId: string;
let areaId: string;
let stageId: string;
let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId, adminRoleId } = await seedFirm());
  ({ userId } = await seedUser({ firmId }));
  ({ areaId, stageId } = await seedPracticeArea());
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
    name: "Visible Matter",
  }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const day = (key: string) => new Date(`${key}T00:00:00Z`);

async function grant(uid: string, ...permissions: string[]): Promise<void> {
  const role = await prisma.role.create({
    data: { firmId, name: `r-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({ roleId: role.id, permission })),
  });
  await prisma.userRole.create({ data: { userId: uid, roleId: role.id } });
}

async function makeAdmin(uid: string): Promise<void> {
  await prisma.userRole.create({ data: { userId: uid, roleId: adminRoleId } });
}

/** TEAM mode: matters are visible to their team only. */
async function wallFirm(): Promise<void> {
  await prisma.firm.update({
    where: { id: firmId },
    data: { matterVisibility: "TEAM" },
  });
}

async function outsider(): Promise<string> {
  const { userId: id } = await seedUser({ firmId, name: "Outsider" });
  return id;
}

async function deadline(
  mId: string,
  title: string,
  due: string,
  status = "open",
  ownerId: string | null = userId,
) {
  return prisma.deadline.create({
    data: { matterId: mId, title, dueDate: day(due), status, ownerId },
  });
}

async function task(
  ownerId: string,
  title: string,
  due: string | null,
  opts: { matterId?: string | null; status?: string } = {},
) {
  return prisma.task.create({
    data: {
      title,
      ownerId,
      dueDate: due ? day(due) : null,
      matterId: opts.matterId === undefined ? matterId : opts.matterId,
      status: opts.status ?? "open",
    },
  });
}

async function thread(
  ownerId: string,
  subject: string,
  opts: { matterId?: string | null; isRead?: boolean; isArchived?: boolean } = {},
) {
  const account = await prisma.emailAccount.create({
    data: {
      userId: ownerId,
      emailAddress: `${Math.random().toString(36).slice(2, 8)}@firm.test`,
    },
    select: { id: true },
  });
  return prisma.emailThread.create({
    data: {
      accountId: account.id,
      subject,
      matterId: opts.matterId === undefined ? matterId : opts.matterId,
      isRead: opts.isRead ?? false,
      isArchived: opts.isArchived ?? false,
      lastMessageAt: NOW,
    },
  });
}

async function docRequest(mId: string, title: string, status = "submitted") {
  return prisma.documentRequest.create({
    data: { matterId: mId, title, status, createdById: userId },
  });
}

const groupOf = async (key: string, tz = DENVER) =>
  (await getTriage(tz)).groups.find((g) => g.key === key);

describe("deadlines", () => {
  test("overdue and due today are in; tomorrow, done and archived-matter are out", async () => {
    await deadline(matterId, "overdue", "2026-06-10");
    await deadline(matterId, "today", "2026-06-15");
    await deadline(matterId, "tomorrow", "2026-06-16");
    await deadline(matterId, "done", "2026-06-10", "completed");
    const { matterId: archived } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matter.update({ where: { id: archived }, data: { isArchived: true } });
    await deadline(archived, "on archived", "2026-06-10");

    const g = await groupOf("deadlines");
    expect(g?.rows.map((r) => r.title)).toEqual(["overdue", "today"]);
    expect(g?.rows.map((r) => r.days)).toEqual([-5, 0]);
    expect(g?.rows[0].href).toBe(`/matters/${matterId}/deadlines`);
  });

  test("the day boundary is the viewer's day, not UTC's", async () => {
    // 8pm June 15 in Denver is already June 16 in UTC.
    await deadline(matterId, "due the 16th", "2026-06-16");
    expect(await groupOf("deadlines", DENVER)).toBeUndefined();
    const utc = await groupOf("deadlines", "UTC");
    expect(utc?.rows.map((r) => r.title)).toEqual(["due the 16th"]);
    expect(utc?.rows[0].days).toBe(0);
  });

  test("a walled-off matter's deadlines never appear", async () => {
    await wallFirm();
    const other = await outsider();
    await deadline(matterId, "secret", "2026-06-10", "open", other);
    vi.mocked(getCurrentUserId).mockResolvedValue(other);
    expect(await groupOf("deadlines")).toBeUndefined();
  });

  test("a restricted matter is hidden from non-team members even in firm mode", async () => {
    await prisma.matter.update({ where: { id: matterId }, data: { restricted: true } });
    const other = await outsider();
    await deadline(matterId, "secret", "2026-06-10", "open", other);
    vi.mocked(getCurrentUserId).mockResolvedValue(other);
    expect(await groupOf("deadlines")).toBeUndefined();
  });

  test("only mine, or unowned on a matter I'm on the team of", async () => {
    const other = await outsider();
    await deadline(matterId, "mine", "2026-06-10");
    await deadline(matterId, "someone else's", "2026-06-10", "open", other);
    await deadline(matterId, "unowned, my team", "2026-06-11", "open", null);
    // The seeded matter has the viewer as lead; `other` is not on it.
    expect((await groupOf("deadlines"))?.rows.map((r) => r.title)).toEqual([
      "mine",
      "unowned, my team",
    ]);
    vi.mocked(getCurrentUserId).mockResolvedValue(other);
    expect((await groupOf("deadlines"))?.rows.map((r) => r.title)).toEqual(["someone else's"]);
  });

  test("legacy stored 'overdue' status still shows", async () => {
    await deadline(matterId, "legacy", "2026-06-10", "overdue");
    expect((await groupOf("deadlines"))?.rows.map((r) => r.title)).toEqual(["legacy"]);
  });
});

describe("tasks", () => {
  test("only the viewer's own open tasks due today or earlier", async () => {
    const other = await outsider();
    await task(userId, "overdue", "2026-06-01");
    await task(userId, "today", "2026-06-15");
    await task(userId, "tomorrow", "2026-06-16");
    await task(userId, "no date", null);
    await task(userId, "closed", "2026-06-01", { status: "done" });
    await task(other, "someone else's", "2026-06-01");
    await task(userId, "firm-wide", "2026-06-02", { matterId: null });

    const g = await groupOf("tasks");
    expect(g?.rows.map((r) => r.title)).toEqual(["overdue", "firm-wide", "today"]);
    expect(g?.rows.find((r) => r.title === "firm-wide")?.href).toBeNull();
    expect(g?.total).toBe(3);
  });

  test("a task on an archived matter is left off", async () => {
    await prisma.matter.update({ where: { id: matterId }, data: { isArchived: true } });
    await task(userId, "on archived", "2026-06-01");
    expect(await groupOf("tasks")).toBeUndefined();
  });

  test("my task on a matter I cannot access is left off", async () => {
    await wallFirm();
    const other = await outsider();
    await task(other, "walled task", "2026-06-01");
    vi.mocked(getCurrentUserId).mockResolvedValue(other);
    expect(await groupOf("tasks")).toBeUndefined();
  });
});

describe("email", () => {
  test("own mailbox, unread, unarchived, filed to a matter", async () => {
    const other = await outsider();
    await thread(userId, "mine");
    await thread(userId, "already read", { isRead: true });
    await thread(userId, "archived", { isArchived: true });
    await thread(userId, "unfiled", { matterId: null });
    await thread(other, "someone else's mailbox");

    const g = await groupOf("email");
    expect(g?.rows.map((r) => r.title)).toEqual(["mine"]);
    expect(g?.rows[0].context).toBe("Visible Matter");
    expect(g?.rows[0].href).toMatch(/^\/communication\?view=email&thread=/);
  });

  test("a thread filed to a walled-off matter is omitted", async () => {
    await wallFirm();
    const other = await outsider();
    await thread(other, "filed to a matter I cannot see");
    vi.mocked(getCurrentUserId).mockResolvedValue(other);
    expect(await groupOf("email")).toBeUndefined();
  });
});

describe("client uploads (portal.view)", () => {
  test("omitted without portal.view, even when submissions exist", async () => {
    await docRequest(matterId, "W-2s");
    expect(await groupOf("uploads")).toBeUndefined();
  });

  test("listed with portal.view: only submitted requests", async () => {
    await grant(userId, "portal.view");
    await docRequest(matterId, "W-2s");
    await docRequest(matterId, "still open", "open");
    await docRequest(matterId, "done", "complete");
    const g = await groupOf("uploads");
    expect(g?.rows.map((r) => r.title)).toEqual(["W-2s"]);
    expect(g?.rows[0].href).toBe(`/matters/${matterId}`);
  });

  test("portal.view does not lift the matter wall", async () => {
    await wallFirm();
    await docRequest(matterId, "walled");
    const other = await outsider();
    await grant(other, "portal.view");
    vi.mocked(getCurrentUserId).mockResolvedValue(other);
    expect(await groupOf("uploads")).toBeUndefined();
  });
});

describe("matters missing a signed agreement (admin, switch on)", () => {
  async function requireSwitch(on: boolean) {
    await prisma.firm.update({
      where: { id: firmId },
      data: { requireOriginatingDoc: on },
    });
  }

  test("admins see open matters with no signed agreement", async () => {
    await makeAdmin(userId);
    await requireSwitch(true);
    const { matterId: signedId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Signed Matter",
    });
    const { documentId } = await seedDocument({ matterId: signedId });
    await prisma.matterAgreement.create({
      data: { matterId: signedId, status: "signed", documentId },
    });

    const g = await groupOf("agreements");
    expect(g?.rows.map((r) => r.title)).toEqual(["Visible Matter"]);
  });

  test("omitted for a non-admin, and when the firm switch is off", async () => {
    await requireSwitch(true);
    expect(await groupOf("agreements")).toBeUndefined();
    await makeAdmin(userId);
    await requireSwitch(false);
    expect(await groupOf("agreements")).toBeUndefined();
  });
});

describe("caps and +N more", () => {
  test("each group shows at most the cap, with an exact remainder", async () => {
    const n = TRIAGE_GROUP_LIMIT + 3;
    for (let i = 0; i < n; i++) {
      await deadline(matterId, `d${i}`, "2026-06-01");
      await task(userId, `t${i}`, "2026-06-01");
      await thread(userId, `e${i}`);
    }
    for (const key of ["deadlines", "tasks", "email"]) {
      const g = await groupOf(key);
      expect(g?.rows).toHaveLength(TRIAGE_GROUP_LIMIT);
      expect(g?.total).toBe(n);
      expect(g?.hidden).toBe(3);
    }
  });

  test("nothing to triage returns no groups", async () => {
    expect((await getTriage(DENVER)).groups).toEqual([]);
  });
});
