import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/portal-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portal-access")>()),
  getPortalIdentity: vi.fn(),
}));
vi.mock("@/lib/matter-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/matter-access")>();
  return { ...actual, canAccessMatter: vi.fn(actual.canAccessMatter) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getPortalIdentity } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { canAccessMatter } from "@/lib/matter-access";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { markPortalMessagesRead, sendPortalMessage } from "./portal-messages-client";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;
let lead: string;
let matterId: string;
let identityId: string;
let contactId: string;
let areaId: string;
let stageId: string;

async function teamMember(opts: { keyed: boolean; active?: boolean }) {
  const role = await prisma.role.create({
    data: { firmId, name: `r-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });
  if (opts.keyed) {
    await prisma.rolePermission.create({ data: { roleId: role.id, permission: "portal.view_messages" } });
  }
  const { userId } = await seedUser({ firmId, roleIds: [role.id], isActive: opts.active ?? true });
  await prisma.matterTeamMember.create({ data: { matterId, userId, role: "paralegal" } });
  return userId;
}

const notifs = (userId: string) =>
  prisma.notification.findMany({ where: { userId, type: "portal_message" } });

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  ({ userId: lead } = await seedUser({ firmId }));
  ({ areaId, stageId } = await seedPracticeArea());
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: lead, name: "Smith v. Jones" }));
  ({ contactId } = await seedContact({ name: "Jane Client", email: "jane@example.com" }));
  identityId = (await prisma.portalIdentity.create({ data: { contactId, email: "jane@example.com" } })).id;
  await prisma.portalMatterAccess.create({ data: { identityId, matterId, invitedById: lead } });
  vi.mocked(canAccessMatter).mockClear();
  vi.mocked(getPortalIdentity).mockResolvedValue({ identityId, contactId, email: "jane@example.com" });
});

describe("sendPortalMessage gates and validation", () => {
  test("off the portal host (null identity) is refused", async () => {
    vi.mocked(getPortalIdentity).mockResolvedValue(null);
    expect(await sendPortalMessage(matterId, "hi")).toEqual({ ok: false, error: "Not signed in." });
    expect(await prisma.portalMessage.count()).toBe(0);
  });

  test("no access, closed matter, other matter are refused", async () => {
    const cant = { ok: false, error: "You can't send messages on this matter." };
    await prisma.matter.update({ where: { id: matterId }, data: { isArchived: true } });
    expect(await sendPortalMessage(matterId, "hi")).toEqual(cant);
    await prisma.matter.update({ where: { id: matterId }, data: { isArchived: false } });
    const other = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: lead })).matterId;
    expect(await sendPortalMessage(other, "hi")).toEqual(cant);
    await prisma.portalMatterAccess.updateMany({ where: { identityId }, data: { revokedAt: new Date() } });
    expect(await sendPortalMessage(matterId, "hi")).toEqual(cant);
    expect(await prisma.portalMessage.count()).toBe(0);
  });

  test("validates the body", async () => {
    expect((await sendPortalMessage(matterId, "   ")).ok).toBe(false);
    expect((await sendPortalMessage(matterId, "x".repeat(5001))).ok).toBe(false);
    expect(await prisma.portalMessage.count()).toBe(0);
  });
});

describe("sendPortalMessage rate limit", () => {
  test("30th in an hour is ok, 31st refused; older messages do not count", async () => {
    const thread = await prisma.portalThread.create({
      data: { matterId, lastMessageAt: new Date(), lastFromClient: true },
    });
    await prisma.portalMessage.create({
      data: {
        threadId: thread.id, body: "old", authorKind: "client", authorIdentityId: identityId,
        createdAt: new Date(Date.now() - 2 * 3600_000),
      },
    });
    await prisma.portalMessage.createMany({
      data: Array.from({ length: 28 }, (_, i) => ({
        threadId: thread.id, body: `m${i}`, authorKind: "client", authorIdentityId: identityId,
      })),
    });
    // None of these may count toward this identity's 30 on this matter.
    const { contactId: otherContact } = await seedContact({ name: "Co", email: "co@example.com" });
    const co = await prisma.portalIdentity.create({ data: { contactId: otherContact, email: "co@example.com" } });
    await prisma.portalMessage.createMany({
      data: [
        ...Array.from({ length: 5 }, (_, i) => ({ threadId: thread.id, body: `s${i}`, authorKind: "staff", authorUserId: lead })),
        ...Array.from({ length: 5 }, (_, i) => ({ threadId: thread.id, body: `c${i}`, authorKind: "client", authorIdentityId: co.id })),
      ],
    });
    const otherMatter = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: lead })).matterId;
    const otherThread = await prisma.portalThread.create({
      data: { matterId: otherMatter, lastMessageAt: new Date(), lastFromClient: true },
    });
    await prisma.portalMessage.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ threadId: otherThread.id, body: `o${i}`, authorKind: "client", authorIdentityId: identityId })),
    });
    expect(await sendPortalMessage(matterId, "29th")).toEqual({ ok: true });
    expect(await sendPortalMessage(matterId, "30th")).toEqual({ ok: true });
    expect(await sendPortalMessage(matterId, "31st")).toEqual({
      ok: false,
      error: "You're sending messages too quickly. Try again later.",
    });
  });
});

describe("sendPortalMessage effects", () => {
  test("stores, advances read state, writes the activity row", async () => {
    expect(await sendPortalMessage(matterId, "  hello  ")).toEqual({ ok: true });
    const msg = await prisma.portalMessage.findFirstOrThrow({});
    expect(msg).toMatchObject({ body: "hello", authorKind: "client", authorIdentityId: identityId });
    const rs = await prisma.portalReadState.findFirstOrThrow({ where: { identityId } });
    expect(rs.lastReadAt.getTime()).toBe(msg.createdAt.getTime());
    expect(await prisma.activityLog.count({ where: { matterId, title: "Sent a portal message" } })).toBe(1);
  });

  test("notifies only keyed, active, accessible team members", async () => {
    const keyed = await teamMember({ keyed: true });
    const unkeyed = await teamMember({ keyed: false });
    const inactive = await teamMember({ keyed: true, active: false });
    await sendPortalMessage(matterId, "hello");
    const n = await notifs(keyed);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      title: "Jane Client sent a message",
      body: "Smith v. Jones",
      matterId,
      link: `/matters/${matterId}/communication?channel=portal`,
    });
    expect(await notifs(unkeyed)).toHaveLength(0);
    expect(await notifs(inactive)).toHaveLength(0);
  });

  test("a non-team user holding the key who cannot access the matter gets nothing", async () => {
    // Walls bind users off the team: a keyed non-team user is never a recipient.
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    const role = await prisma.role.create({ data: { firmId, name: "outsider" }, select: { id: true } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permission: "portal.view_messages" } });
    const { userId: outsider } = await seedUser({ firmId, roleIds: [role.id] });
    await sendPortalMessage(matterId, "hello");
    expect(await notifs(outsider)).toHaveLength(0);
  });

  test("the access check is applied: a keyed team member failing canAccessMatter gets nothing", async () => {
    // By design (matter-access.ts matterAccessWhere) an active team member always
    // passes, so a walled member cannot be seeded; stub the check to pin the filter.
    const keyed = await teamMember({ keyed: true });
    const other = await teamMember({ keyed: true });
    vi.mocked(canAccessMatter).mockImplementation(async (uid) => uid !== keyed);
    await sendPortalMessage(matterId, "hello");
    expect(await notifs(keyed)).toHaveLength(0);
    expect(await notifs(other)).toHaveLength(1);
    vi.mocked(canAccessMatter).mockReset();
  });

  test("an admin team member is notified without an explicit key", async () => {
    const admin = await prisma.role.findFirstOrThrow({ where: { name: "Admin" } });
    const { userId } = await seedUser({ firmId, roleIds: [admin.id] });
    await prisma.matterTeamMember.create({ data: { matterId, userId, role: "co_counsel" } });
    await sendPortalMessage(matterId, "hello");
    expect(await notifs(userId)).toHaveLength(1);
  });

  test("once per burst: unread notification suppresses a new one until read", async () => {
    const keyed = await teamMember({ keyed: true });
    await sendPortalMessage(matterId, "one");
    await sendPortalMessage(matterId, "two");
    expect(await notifs(keyed)).toHaveLength(1);
    await prisma.notification.updateMany({ where: { userId: keyed }, data: { readAt: new Date() } });
    await sendPortalMessage(matterId, "three");
    expect(await notifs(keyed)).toHaveLength(2);
  });
});

describe("markPortalMessagesRead", () => {
  test("advances the marker; no-op without a thread or without the gate", async () => {
    await markPortalMessagesRead(matterId);
    expect(await prisma.portalReadState.count()).toBe(0);

    const thread = await prisma.portalThread.create({
      data: { matterId, lastMessageAt: new Date(), lastFromClient: false },
    });
    await markPortalMessagesRead(matterId);
    const rs = await prisma.portalReadState.findFirstOrThrow({ where: { threadId: thread.id, identityId } });
    expect(rs.lastReadAt.getTime()).toBe(thread.lastMessageAt.getTime());

    await prisma.portalReadState.deleteMany({});
    await prisma.portalMatterAccess.updateMany({ where: { identityId }, data: { revokedAt: new Date() } });
    await markPortalMessagesRead(matterId);
    expect(await prisma.portalReadState.count()).toBe(0);
  });

  test("stamps lastMessageAt; a second call is a no-op and does not revalidate", async () => {
    const last = new Date(Date.now() - 3_600_000);
    const thread = await prisma.portalThread.create({
      data: { matterId, lastMessageAt: last, lastFromClient: false },
    });
    vi.mocked(revalidatePath).mockClear();
    await markPortalMessagesRead(matterId);
    const first = await prisma.portalReadState.findFirstOrThrow({ where: { threadId: thread.id, identityId } });
    expect(first.lastReadAt.getTime()).toBe(last.getTime());
    expect(revalidatePath).toHaveBeenCalledWith("/portal");

    vi.mocked(revalidatePath).mockClear();
    await markPortalMessagesRead(matterId);
    const second = await prisma.portalReadState.findFirstOrThrow({ where: { threadId: thread.id, identityId } });
    expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime());
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("off the portal host does nothing", async () => {
    await prisma.portalThread.create({ data: { matterId, lastMessageAt: new Date(), lastFromClient: false } });
    vi.mocked(getPortalIdentity).mockResolvedValue(null);
    await markPortalMessagesRead(matterId);
    expect(await prisma.portalReadState.count()).toBe(0);
  });
});
