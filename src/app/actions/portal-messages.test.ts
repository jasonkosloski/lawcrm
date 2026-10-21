import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let sessionUser = "";
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => sessionUser),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-check";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { __setDriverForTests } from "@/lib/email/send";
import { captureEmails } from "@/test/email-capture";
import { portalMessageEmail } from "@/lib/portal/emails";
import { sendStaffPortalMessage, markStaffPortalThreadRead } from "./portal-messages";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;
let adminRoleId: string;
let admin: string;
let matterId: string;
let cap: ReturnType<typeof captureEmails>;

async function userWith(permissions: string[]) {
  const role = await prisma.role.create({
    data: { firmId, name: `r-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });
  for (const permission of permissions) {
    await prisma.rolePermission.create({ data: { roleId: role.id, permission } });
  }
  return (await seedUser({ firmId, name: "Staff", roleIds: [role.id] })).userId;
}

async function seedIdentity(
  email: string,
  opts: { revoked?: boolean; disabled?: boolean } = {}
) {
  const { contactId } = await seedContact({ name: `C ${email}` });
  const identity = await prisma.portalIdentity.create({
    data: { contactId, email, disabledAt: opts.disabled ? new Date() : null },
  });
  await prisma.portalMatterAccess.create({
    data: {
      identityId: identity.id,
      matterId,
      invitedById: admin,
      revokedAt: opts.revoked ? new Date() : null,
    },
  });
  return identity.id;
}

const SECRET = "Settlement offer is $50,000";

beforeEach(async () => {
  await resetDb();
  cap = captureEmails();
  vi.mocked(revalidatePath).mockClear();
  ({ firmId, adminRoleId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  admin = (await seedUser({ firmId, roleIds: [adminRoleId] })).userId;
  sessionUser = admin;
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: admin,
    name: "Alvarez secret matter",
  }));
});
afterEach(() => {
  vi.useRealTimers();
  cap.restore();
});

describe("permissions and walls", () => {
  test("send is denied without portal.send_messages", async () => {
    sessionUser = await userWith(["portal.view_messages"]);
    expect(await sendStaffPortalMessage(matterId, "hi")).toEqual({
      ok: false,
      error: PERMISSION_DENIED_MESSAGE,
    });
    expect(await prisma.portalMessage.count()).toBe(0);
  });

  test("a walled user gets not-found and nothing is written or sent", async () => {
    await seedIdentity("c@example.com");
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith(["portal.send_messages", "portal.view_messages"]);
    const notFound = { digest: expect.stringContaining("404") };
    await expect(sendStaffPortalMessage(matterId, "hi")).rejects.toMatchObject(notFound);
    await expect(markStaffPortalThreadRead(matterId)).rejects.toMatchObject(notFound);
    expect(await prisma.portalMessage.count()).toBe(0);
    expect(await prisma.portalThread.count()).toBe(0);
    expect(cap.sent).toHaveLength(0);
  });
});

describe("sendStaffPortalMessage", () => {
  test("rejects an empty body", async () => {
    const res = await sendStaffPortalMessage(matterId, "   ");
    expect(res.ok).toBe(false);
    expect(await prisma.portalMessage.count()).toBe(0);
  });

  test("stores the message, logs activity, advances the sender's read state, revalidates", async () => {
    const res = await sendStaffPortalMessage(matterId, SECRET);
    expect(res).toEqual({ ok: true });
    const msg = await prisma.portalMessage.findFirstOrThrow();
    expect(msg).toMatchObject({ body: SECRET, authorKind: "staff", authorUserId: admin });
    expect(
      await prisma.activityLog.count({
        where: { matterId, userId: admin, type: "note", title: "Sent a client portal message" },
      })
    ).toBe(1);
    const rs = await prisma.portalReadState.findFirstOrThrow({ where: { userId: admin } });
    expect(rs.lastReadAt.getTime()).toBe(msg.createdAt.getTime());
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}/communication`);
    expect(revalidatePath).toHaveBeenCalledWith("/communication");
  });

  test("emails live clients only; the email names no matter and no message text", async () => {
    await seedIdentity("live@example.com");
    await seedIdentity("revoked@example.com", { revoked: true });
    await seedIdentity("disabled@example.com", { disabled: true });
    await sendStaffPortalMessage(matterId, SECRET);
    expect(cap.sent.map((m) => m.to)).toEqual(["live@example.com"]);
    const m = cap.sent[0];
    expect(m.subject).toBe("You have a new message from your legal team");
    const all = `${m.subject}${m.text}${m.html}`;
    expect(all).not.toContain("Alvarez");
    expect(all).not.toContain("50,000");
  });

  test("sends no email with the portal off, but still saves", async () => {
    await seedIdentity("live@example.com");
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect(await sendStaffPortalMessage(matterId, "hi")).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(0);
    expect(await prisma.portalMessage.count()).toBe(1);
  });

  test("throttles to one email per 15 minutes per client", async () => {
    const identityId = await seedIdentity("live@example.com");
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-20T12:00:00Z");
    vi.setSystemTime(t0);
    await sendStaffPortalMessage(matterId, "one");
    vi.setSystemTime(new Date(t0.getTime() + 60_000));
    await sendStaffPortalMessage(matterId, "two");
    vi.setSystemTime(new Date(t0.getTime() + 14 * 60_000));
    await sendStaffPortalMessage(matterId, "three");
    expect(cap.sent).toHaveLength(1);

    vi.setSystemTime(new Date(t0.getTime() + 15 * 60_000 + 1000));
    await sendStaffPortalMessage(matterId, "four");
    expect(cap.sent).toHaveLength(2);

    const rs = await prisma.portalReadState.findFirstOrThrow({ where: { identityId } });
    expect(rs.lastEmailedAt?.getTime()).toBe(t0.getTime() + 15 * 60_000 + 1000);
    expect(rs.lastReadAt.getTime()).toBe(0);
  });

  test("delivery failure keeps the message, warns, and does not stamp lastEmailedAt", async () => {
    const identityId = await seedIdentity("live@example.com");
    __setDriverForTests(async () => ({ ok: false, error: "boom" }));
    const res = await sendStaffPortalMessage(matterId, "hi");
    expect(res).toEqual({
      ok: true,
      warning: "Message sent, but the client email didn't go out.",
    });
    expect(await prisma.portalMessage.count()).toBe(1);
    const rs = await prisma.portalReadState.findFirst({ where: { identityId } });
    expect(rs?.lastEmailedAt ?? null).toBeNull();
  });
});

describe("markStaffPortalThreadRead", () => {
  test("advances only the caller's read state", async () => {
    const other = (await seedUser({ firmId, roleIds: [adminRoleId] })).userId;
    await sendStaffPortalMessage(matterId, "hi");
    const thread = await prisma.portalThread.findFirstOrThrow();
    await prisma.portalReadState.create({
      data: { threadId: thread.id, userId: other, lastReadAt: new Date(0) },
    });
    await prisma.portalReadState.updateMany({
      where: { userId: admin },
      data: { lastReadAt: new Date(0) },
    });
    await markStaffPortalThreadRead(matterId);
    const mine = await prisma.portalReadState.findFirstOrThrow({ where: { userId: admin } });
    const theirs = await prisma.portalReadState.findFirstOrThrow({ where: { userId: other } });
    expect(mine.lastReadAt.getTime()).toBeGreaterThan(0);
    expect(theirs.lastReadAt.getTime()).toBe(0);
  });

  test("advances to lastMessageAt and revalidates; a second call is a no-op", async () => {
    await sendStaffPortalMessage(matterId, "hi");
    const thread = await prisma.portalThread.findFirstOrThrow();
    await prisma.portalReadState.updateMany({ data: { lastReadAt: new Date(0) } });
    vi.mocked(revalidatePath).mockClear();
    await markStaffPortalThreadRead(matterId);
    const rs = await prisma.portalReadState.findFirstOrThrow({ where: { userId: admin } });
    expect(rs.lastReadAt.getTime()).toBe(thread.lastMessageAt.getTime());
    expect(revalidatePath).toHaveBeenCalled();
    vi.mocked(revalidatePath).mockClear();
    await markStaffPortalThreadRead(matterId);
    const again = await prisma.portalReadState.findFirstOrThrow({ where: { userId: admin } });
    expect(again.lastReadAt.getTime()).toBe(rs.lastReadAt.getTime());
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("is a silent no-op without portal.view_messages", async () => {
    await sendStaffPortalMessage(matterId, "hi");
    await prisma.portalReadState.updateMany({ data: { lastReadAt: new Date(0) } });
    sessionUser = await userWith([]);
    await expect(markStaffPortalThreadRead(matterId)).resolves.toBeUndefined();
    expect((await prisma.portalReadState.findFirstOrThrow()).lastReadAt.getTime()).toBe(0);
  });
});

test("portalMessageEmail carries the link only", () => {
  const e = portalMessageEmail("https://portal.example.com");
  expect(e.text).toContain("https://portal.example.com");
});
