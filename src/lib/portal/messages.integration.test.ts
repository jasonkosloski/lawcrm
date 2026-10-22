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
import { recordPortalMessage } from "./message-store";
import { getPortalMessages, unreadPortalMessageMatters } from "./messages";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;
let userId: string;
let matterA: string;
let matterB: string;
let me: string;
let coClient: string;

async function mkIdentity(name: string, email: string, matterIds: string[], revoked = false) {
  const { contactId } = await seedContact({ name, email });
  const identity = await prisma.portalIdentity.create({ data: { contactId, email } });
  for (const matterId of matterIds) {
    await prisma.portalMatterAccess.create({
      data: {
        identityId: identity.id,
        matterId,
        invitedById: userId,
        revokedAt: revoked ? new Date() : null,
      },
    });
  }
  return identity.id;
}

const t = (m: number) => new Date(Date.UTC(2026, 9, 20, 12, m));

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  ({ userId } = await seedUser({ firmId, name: "Pat Staff" }));
  const { areaId, stageId } = await seedPracticeArea();
  matterA = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "A" }))
    .matterId;
  matterB = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "B" }))
    .matterId;
  me = await mkIdentity("Jane", "jane@example.com", [matterA]);
  coClient = await mkIdentity("Joe Co", "joe@example.com", [matterA]);
});

describe("getPortalMessages", () => {
  test("oldest first with self, co-client and staff labels", async () => {
    await recordPortalMessage(matterA, "two", { kind: "staff", userId }, t(2));
    await recordPortalMessage(matterA, "one", { kind: "client", identityId: me }, t(1));
    await recordPortalMessage(matterA, "three", { kind: "client", identityId: coClient }, t(3));
    const msgs = await getPortalMessages(me, matterA);
    expect(msgs.map((m) => [m.body, m.authorLabel, m.fromClient])).toEqual([
      ["one", "You", true],
      ["two", "Pat Staff (your legal team)", false],
      ["three", "Joe Co", true],
    ]);
    expect(Object.keys(msgs[0]).sort()).toEqual([
      "authorLabel",
      "body",
      "createdAt",
      "fromClient",
      "id",
    ]);
  });

  test("never returns another matter's messages", async () => {
    await recordPortalMessage(matterB, "secret", { kind: "staff", userId }, t(1));
    expect(await getPortalMessages(me, matterB)).toEqual([]);
    expect(await getPortalMessages(me, matterA)).toEqual([]);
  });

  test("empty when revoked, portal off, or identity disabled", async () => {
    await recordPortalMessage(matterA, "hi", { kind: "staff", userId }, t(1));
    expect(await getPortalMessages(me, matterA)).toHaveLength(1);

    await prisma.portalMatterAccess.updateMany({
      where: { identityId: me },
      data: { revokedAt: new Date() },
    });
    expect(await getPortalMessages(me, matterA)).toEqual([]);
    await prisma.portalMatterAccess.updateMany({
      where: { identityId: me },
      data: { revokedAt: null },
    });

    await prisma.portalIdentity.update({ where: { id: me }, data: { disabledAt: new Date() } });
    expect(await getPortalMessages(me, matterA)).toEqual([]);
    await prisma.portalIdentity.update({ where: { id: me }, data: { disabledAt: null } });

    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect(await getPortalMessages(me, matterA)).toEqual([]);
  });

  test("a revoked co-client's messages keep their name for a remaining client", async () => {
    await recordPortalMessage(matterA, "from joe", { kind: "client", identityId: coClient }, t(1));
    await prisma.portalMatterAccess.updateMany({
      where: { identityId: coClient },
      data: { revokedAt: new Date() },
    });
    const msgs = await getPortalMessages(me, matterA);
    expect(msgs.map((m) => m.authorLabel)).toEqual(["Joe Co"]);
  });
});

describe("unreadPortalMessageMatters", () => {
  test("flags matters with staff messages newer than the read marker", async () => {
    await recordPortalMessage(matterA, "hi", { kind: "staff", userId }, t(1));
    expect([...(await unreadPortalMessageMatters(me, [matterA, matterB]))]).toEqual([matterA]);
    const thread = await prisma.portalThread.findUniqueOrThrow({ where: { matterId: matterA } });
    await prisma.portalReadState.create({
      data: { threadId: thread.id, identityId: me, lastReadAt: t(2) },
    });
    expect((await unreadPortalMessageMatters(me, [matterA])).size).toBe(0);
  });

  test("own client messages are not unread; no gate means none", async () => {
    await recordPortalMessage(matterA, "mine", { kind: "client", identityId: coClient }, t(1));
    expect((await unreadPortalMessageMatters(me, [matterA])).size).toBe(0);
    await recordPortalMessage(matterA, "hi", { kind: "staff", userId }, t(2));
    await prisma.portalMatterAccess.updateMany({
      where: { identityId: me },
      data: { revokedAt: new Date() },
    });
    expect((await unreadPortalMessageMatters(me, [matterA])).size).toBe(0);
  });
});
