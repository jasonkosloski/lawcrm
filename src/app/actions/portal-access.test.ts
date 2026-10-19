import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let sessionUser = "";
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => sessionUser),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { captureEmails } from "@/test/email-capture";
import { __setDriverForTests } from "@/lib/email/send";
import { consumeToken } from "@/lib/portal/tokens";
import { createSession } from "@/lib/portal/sessions";
import {
  disablePortalIdentity,
  invitePortalUser,
  revokePortalAccess,
} from "./portal-access";
import { getPortalAccessForMatter } from "@/lib/queries/portal-access";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;
let adminRoleId: string;
let admin: string;
let areaId: string;
let stageId: string;
let matterId: string;
let contactId: string;
let cap: ReturnType<typeof captureEmails>;

async function userWith(permissions: string[], name = "Staff") {
  const role = await prisma.role.create({
    data: { firmId, name: `r-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });
  for (const permission of permissions) {
    await prisma.rolePermission.create({ data: { roleId: role.id, permission } });
  }
  return (await seedUser({ firmId, name, roleIds: [role.id] })).userId;
}

const tokenOf = (text: string) =>
  decodeURIComponent(/token=([^\s&]+)/.exec(text)![1]);

beforeEach(async () => {
  await resetDb();
  cap = captureEmails();
  ({ firmId, adminRoleId } = await seedFirm());
  await prisma.firm.update({
    where: { id: firmId },
    data: { portalEnabled: true, name: "Acme Law" },
  });
  admin = (await seedUser({ firmId, roleIds: [adminRoleId] })).userId;
  sessionUser = admin;
  ({ areaId, stageId } = await seedPracticeArea());
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: admin,
    name: "Alvarez matter",
  }));
  ({ contactId } = await seedContact({ name: "Jane Client" }));
});
afterEach(() => cap.restore());

describe("invitePortalUser", () => {
  test("invite needs portal.invite and matter access; a walled user gets the generic not-found error", async () => {
    const nobody = await userWith([]);
    sessionUser = nobody;
    const denied = await invitePortalUser(matterId, contactId, "jane@example.com");
    expect(denied.ok).toBe(false);

    // Has the permission but is walled off the matter (TEAM mode).
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    const walled = await userWith(["portal.invite"]);
    sessionUser = walled;
    await expect(
      invitePortalUser(matterId, contactId, "jane@example.com")
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(await prisma.portalIdentity.count()).toBe(0);
    expect(cap.sent).toHaveLength(0);

    // Team member with the permission succeeds.
    await prisma.matterTeamMember.create({
      data: { matterId, userId: walled, role: "attorney" },
    });
    expect(await invitePortalUser(matterId, contactId, "jane@example.com")).toEqual({ ok: true });
  });

  test("invite refuses when the portal is off", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect(await invitePortalUser(matterId, contactId, "jane@example.com")).toEqual({
      ok: false,
      error: "The client portal is not available right now.",
    });
    expect(cap.sent).toHaveLength(0);
    expect(await prisma.portalIdentity.count()).toBe(0);
  });

  test("invite refuses a missing or invalid email", async () => {
    for (const bad of ["", "   ", "nope", "a@b", "a b@c.com"]) {
      const res = await invitePortalUser(matterId, contactId, bad);
      expect(res.ok).toBe(false);
    }
    expect(await prisma.portalIdentity.count()).toBe(0);
    expect(cap.sent).toHaveLength(0);
  });

  test("invite refuses a missing or merged-away contact", async () => {
    const { contactId: survivor } = await seedContact({ name: "Survivor" });
    await prisma.contact.update({ where: { id: contactId }, data: { mergedIntoId: survivor } });
    expect((await invitePortalUser(matterId, contactId, "j@example.com")).ok).toBe(false);
    expect((await invitePortalUser(matterId, "missing", "j@example.com")).ok).toBe(false);
    expect(await prisma.portalIdentity.count()).toBe(0);
  });

  test("invite trims and case-folds the email", async () => {
    expect(await invitePortalUser(matterId, contactId, "  Jane@Example.COM ")).toEqual({ ok: true });
    const identity = await prisma.portalIdentity.findUniqueOrThrow({ where: { contactId } });
    expect(identity.email).toBe("jane@example.com");
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0].to).toBe("jane@example.com");
    expect(cap.sent[0].subject).toContain("Acme Law");
    expect(cap.sent[0].text).toContain("Alvarez matter");
  });

  test("re-invite after revoke reuses the access row, clears revokedAt, and old invite tokens die", async () => {
    await invitePortalUser(matterId, contactId, "jane@example.com");
    const firstToken = tokenOf(cap.sent[0].text);
    const row = await prisma.portalMatterAccess.findFirstOrThrow({ where: { matterId } });
    await revokePortalAccess(row.id);
    expect(
      (await prisma.portalMatterAccess.findUniqueOrThrow({ where: { id: row.id } })).revokedAt
    ).not.toBeNull();

    await invitePortalUser(matterId, contactId, "jane@example.com");
    const rows = await prisma.portalMatterAccess.findMany({ where: { matterId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(row.id);
    expect(rows[0].revokedAt).toBeNull();
    expect(rows[0].revokedById).toBeNull();

    expect(await consumeToken(firstToken)).toBeNull();
    expect(await consumeToken(tokenOf(cap.sent[1].text))).not.toBeNull();
  });

  test("re-invite re-enables a disabled identity", async () => {
    await invitePortalUser(matterId, contactId, "jane@example.com");
    const identity = await prisma.portalIdentity.findUniqueOrThrow({ where: { contactId } });
    await disablePortalIdentity(identity.id);
    await invitePortalUser(matterId, contactId, "jane@example.com");
    expect(
      (await prisma.portalIdentity.findUniqueOrThrow({ where: { contactId } })).disabledAt
    ).toBeNull();
  });

  test("email send failure keeps the access row and returns the retry copy", async () => {
    __setDriverForTests(async () => ({ ok: false, error: "boom" }));
    const res = await invitePortalUser(matterId, contactId, "jane@example.com");
    expect(res).toEqual({ ok: false, error: "Couldn't send the invite email; try again." });
    expect(await prisma.portalMatterAccess.count({ where: { matterId } })).toBe(1);
  });
});

describe("revoke and disable", () => {
  async function inviteTo(mid: string) {
    await invitePortalUser(mid, contactId, "jane@example.com");
    const identity = await prisma.portalIdentity.findUniqueOrThrow({ where: { contactId } });
    const access = await prisma.portalMatterAccess.findFirstOrThrow({
      where: { matterId: mid, identityId: identity.id },
    });
    return { identityId: identity.id, accessId: access.id };
  }

  test("revoking the last live matter deletes sessions; revoking one of two keeps them", async () => {
    const { matterId: second } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: admin,
      name: "Second matter",
    });
    const a = await inviteTo(matterId);
    const b = await inviteTo(second);
    await createSession(a.identityId);

    expect(await revokePortalAccess(a.accessId)).toEqual({ ok: true });
    expect(await prisma.portalSession.count({ where: { identityId: a.identityId } })).toBe(1);

    expect(await revokePortalAccess(b.accessId)).toEqual({ ok: true });
    expect(await prisma.portalSession.count({ where: { identityId: a.identityId } })).toBe(0);
  });

  test("revoke is gated on portal.revoke and matter access", async () => {
    const a = await inviteTo(matterId);
    sessionUser = await userWith(["portal.invite"]);
    expect((await revokePortalAccess(a.accessId)).ok).toBe(false);
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith(["portal.revoke"]);
    await expect(revokePortalAccess(a.accessId)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect(
      (await prisma.portalMatterAccess.findUniqueOrThrow({ where: { id: a.accessId } })).revokedAt
    ).toBeNull();
  });

  test("disable deletes sessions and needs portal.revoke", async () => {
    const a = await inviteTo(matterId);
    await createSession(a.identityId);

    sessionUser = await userWith(["portal.invite"]);
    expect((await disablePortalIdentity(a.identityId)).ok).toBe(false);
    expect(await prisma.portalSession.count()).toBe(1);

    sessionUser = await userWith(["portal.revoke"]);
    expect(await disablePortalIdentity(a.identityId)).toEqual({ ok: true });
    expect(await prisma.portalSession.count()).toBe(0);
    expect(
      (await prisma.portalIdentity.findUniqueOrThrow({ where: { id: a.identityId } })).disabledAt
    ).not.toBeNull();
  });

  test("each action writes one activity row on the matter (invite/revoke)", async () => {
    const a = await inviteTo(matterId);
    const count = () =>
      prisma.activityLog.count({ where: { matterId, userId: admin, type: "auth" } });
    expect(await count()).toBe(1);
    await revokePortalAccess(a.accessId);
    expect(await count()).toBe(2);
    await revokePortalAccess(a.accessId); // already revoked: no extra row
    expect(await count()).toBe(2);
  });
});

describe("getPortalAccessForMatter", () => {
  test("returns rows with lastSignInAt and is gated on portal.view", async () => {
    await invitePortalUser(matterId, contactId, "jane@example.com");
    const identity = await prisma.portalIdentity.findUniqueOrThrow({ where: { contactId } });
    let rows = await getPortalAccessForMatter(matterId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      identityId: identity.id,
      contactName: "Jane Client",
      email: "jane@example.com",
      lastSignInAt: null,
      revokedAt: null,
    });
    await createSession(identity.id);
    rows = await getPortalAccessForMatter(matterId);
    expect(rows[0].lastSignInAt).toBeInstanceOf(Date);

    sessionUser = await userWith([]);
    expect(await getPortalAccessForMatter(matterId)).toEqual([]);
  });
});
