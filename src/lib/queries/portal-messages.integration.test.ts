import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { getPortalConversation, listPortalThreadsForViewer } from "./portal-messages";

const as = (id: string) => vi.mocked(getCurrentUserId).mockResolvedValue(id);

let firmId: string;
let areaId: string;
let stageId: string;
let leadId: string;
let viewerA: string;
let viewerB: string;
let noKeyUser: string;
let identityId: string;
let roleId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const f = await seedFirm();
  firmId = f.firmId;
  const role = await prisma.role.create({
    data: { firmId, name: "Portal reader", isSystem: false },
    select: { id: true },
  });
  roleId = role.id;
  await prisma.rolePermission.create({
    data: { roleId, permission: "portal.view_messages" },
  });
  leadId = (await seedUser({ firmId, roleIds: [roleId], name: "Lead" })).userId;
  viewerA = (await seedUser({ firmId, roleIds: [roleId], name: "A" })).userId;
  viewerB = (await seedUser({ firmId, roleIds: [roleId], name: "B" })).userId;
  noKeyUser = (await seedUser({ firmId, name: "NoKey" })).userId;
  ({ areaId, stageId } = await seedPracticeArea());
  const { contactId } = await seedContact({ name: "Jane Client", email: "j@x.com" });
  identityId = (await prisma.portalIdentity.create({ data: { contactId, email: "j@x.com" } })).id;
});

const mkMatter = async (name: string, restricted = false) => {
  const { matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: leadId,
    name,
  });
  if (restricted) {
    await prisma.matter.update({ where: { id: matterId }, data: { restricted: true } });
  }
  return matterId;
};

/** Seeds a thread and messages; `msgs` oldest first, spaced a minute apart. */
async function seedThread(
  matterId: string,
  msgs: { from: "client" | "staff"; body: string }[],
  base = new Date("2026-10-01T12:00:00Z"),
) {
  const t = await prisma.portalThread.create({
    data: {
      matterId,
      lastMessageAt: base,
      lastFromClient: msgs.length ? msgs[msgs.length - 1].from === "client" : false,
    },
  });
  let i = 0;
  for (const m of msgs) {
    await prisma.portalMessage.create({
      data: {
        threadId: t.id,
        body: m.body,
        authorKind: m.from,
        authorIdentityId: m.from === "client" ? identityId : null,
        authorUserId: m.from === "staff" ? leadId : null,
        createdAt: new Date(base.getTime() + i++ * 60_000),
      },
    });
  }
  if (msgs.length) {
    await prisma.portalThread.update({
      where: { id: t.id },
      data: { lastMessageAt: new Date(base.getTime() + (i - 1) * 60_000) },
    });
  }
  return t.id;
}

describe("getPortalConversation", () => {
  test("null without portal.view_messages", async () => {
    const m = await mkMatter("M");
    await prisma.matterTeamMember.create({
      data: { matterId: m, userId: noKeyUser, role: "member" },
    });
    as(noKeyUser);
    expect(await getPortalConversation(m)).toBeNull();
  });

  test("walled matter throws not-found", async () => {
    const m = await mkMatter("Walled", true);
    as(viewerA);
    await expect(getPortalConversation(m)).rejects.toThrow("NOT_FOUND");
  });

  test("empty thread and no thread both yield an empty conversation", async () => {
    const m = await mkMatter("M");
    const m2 = await mkMatter("M2");
    await seedThread(m2, []);
    as(leadId);
    for (const id of [m, m2]) {
      expect(await getPortalConversation(id)).toEqual({
        messages: [],
        hasLiveAccess: false,
        unread: 0,
      });
    }
  });

  test("oldest first with author names; staff never unread; per-viewer read state", async () => {
    const m = await mkMatter("M");
    const tid = await seedThread(m, [
      { from: "client", body: "c1" },
      { from: "staff", body: "s1" },
      { from: "client", body: "c2" },
      { from: "staff", body: "s2" },
    ]);
    await prisma.portalReadState.create({
      data: { threadId: tid, userId: viewerA, lastReadAt: new Date("2026-10-01T12:05:00Z") },
    });
    as(viewerA);
    const a = await getPortalConversation(m);
    expect(a!.messages.map((x) => [x.body, x.fromClient, x.authorName])).toEqual([
      ["c1", true, "Jane Client"],
      ["s1", false, "Lead"],
      ["c2", true, "Jane Client"],
      ["s2", false, "Lead"],
    ]);
    expect(a!.unread).toBe(0);
    as(viewerB);
    expect((await getPortalConversation(m))!.unread).toBe(2);
  });

  test("hasLiveAccess is true when a client has live access to the matter", async () => {
    const m = await mkMatter("M");
    await seedThread(m, [{ from: "client", body: "hi" }]);
    await prisma.portalMatterAccess.create({
      data: { identityId, matterId: m, invitedById: leadId },
    });
    as(viewerA);
    expect((await getPortalConversation(m))!.hasLiveAccess).toBe(true);
  });

  test("a revoked client keeps their name on past messages", async () => {
    const m = await mkMatter("M");
    await seedThread(m, [{ from: "client", body: "hi" }]);
    await prisma.portalMatterAccess.create({
      data: { identityId, matterId: m, invitedById: leadId, revokedAt: new Date() },
    });
    as(viewerA);
    const r = await getPortalConversation(m);
    expect(r!.messages[0].authorName).toBe("Jane Client");
    expect(r!.hasLiveAccess).toBe(false);
  });
});

describe("listPortalThreadsForViewer", () => {
  test("empty without portal.view_messages", async () => {
    const m = await mkMatter("M");
    await seedThread(m, [{ from: "client", body: "x" }]);
    as(noKeyUser);
    expect(await listPortalThreadsForViewer(1)).toEqual({ rows: [], total: 0 });
  });

  test("walled matter excluded; message-less threads excluded", async () => {
    const open = await mkMatter("Open");
    const walled = await mkMatter("Walled", true);
    const empty = await mkMatter("Empty");
    await seedThread(open, [{ from: "client", body: "x" }]);
    await seedThread(walled, [{ from: "client", body: "y" }]);
    await seedThread(empty, []);
    as(viewerA);
    const r = await listPortalThreadsForViewer(1);
    expect(r.rows.map((x) => x.matterName)).toEqual(["Open"]);
    expect(r.total).toBe(1);
  });

  test("awaiting-reply threads first, then newest", async () => {
    const a = await mkMatter("Answered");
    const b = await mkMatter("Awaiting old");
    const c = await mkMatter("Awaiting new");
    await seedThread(
      a,
      [
        { from: "client", body: "q" },
        { from: "staff", body: "a" },
      ],
      new Date("2026-10-05T00:00:00Z"),
    );
    await seedThread(b, [{ from: "client", body: "q" }], new Date("2026-10-02T00:00:00Z"));
    await seedThread(c, [{ from: "client", body: "q" }], new Date("2026-10-03T00:00:00Z"));
    as(viewerA);
    const r = await listPortalThreadsForViewer(1);
    expect(r.rows.map((x) => [x.matterName, x.awaitingReply])).toEqual([
      ["Awaiting new", true],
      ["Awaiting old", true],
      ["Answered", false],
    ]);
  });

  test("unread is per viewer; staff messages never count", async () => {
    const m = await mkMatter("M");
    const m2 = await mkMatter("M2");
    const tid = await seedThread(m, [
      { from: "client", body: "c1" },
      { from: "client", body: "c2" },
      { from: "staff", body: "s1" },
    ]);
    await seedThread(m2, [{ from: "staff", body: "only staff" }]);
    await prisma.portalReadState.create({
      data: { threadId: tid, userId: viewerA, lastReadAt: new Date("2026-10-01T13:00:00Z") },
    });
    as(viewerA);
    const a = await listPortalThreadsForViewer(1);
    expect(a.rows.find((r) => r.matterName === "M")!.unread).toBe(0);
    expect(a.rows.find((r) => r.matterName === "M2")!.unread).toBe(0);
    as(viewerB);
    const b = await listPortalThreadsForViewer(1);
    expect(b.rows.find((r) => r.matterName === "M")!.unread).toBe(2);
  });

  test("snippet is the last message truncated to 120 chars", async () => {
    const m = await mkMatter("M");
    await seedThread(m, [
      { from: "client", body: "first" },
      { from: "client", body: "z".repeat(300) },
    ]);
    as(viewerA);
    const r = await listPortalThreadsForViewer(1);
    expect(r.rows[0].snippet).toBe("z".repeat(120));
  });

  test("pages at 100 with the full total", async () => {
    const base = new Date("2026-10-01T00:00:00Z");
    for (let i = 0; i < 101; i++) {
      const m = await mkMatter(`M${i}`);
      await seedThread(m, [{ from: "staff", body: "x" }], new Date(base.getTime() + i * 1000));
    }
    as(viewerA);
    const p1 = await listPortalThreadsForViewer(1);
    const p2 = await listPortalThreadsForViewer(2);
    expect(p1.rows).toHaveLength(100);
    expect(p2.rows).toHaveLength(1);
    expect(p1.total).toBe(101);
    expect(p2.total).toBe(101);
  }, 60_000);
});
