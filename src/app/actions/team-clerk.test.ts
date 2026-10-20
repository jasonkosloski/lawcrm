/**
 * Integration tests for the Clerk-backed Team actions: invite,
 * deactivate / reactivate, sign out everywhere, reset sign-in link,
 * resend invite. `@/lib/clerk-admin` is mocked (no Clerk keys); the
 * database, the escalation guard and the staff resolver are real.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  requirePermissionResult: vi
    .fn()
    .mockResolvedValue({ ok: true, userId: "test-user" }),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/clerk-admin", () => ({
  inviteStaff: vi.fn(),
  revokeStaffInvitation: vi.fn(),
  banStaff: vi.fn(),
  unbanStaff: vi.fn(),
  revokeAllStaffSessions: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermissionResult } from "@/lib/permission-check";
import {
  banStaff,
  revokeStaffInvitation,
  inviteStaff,
  revokeAllStaffSessions,
  unbanStaff,
} from "@/lib/clerk-admin";
import { resolveStaffUser } from "@/lib/staff-auth";
import { prisma } from "@/lib/prisma";
import {
  inviteFirmMember,
  resendFirmMemberInvite,
  resetFirmMemberSignInLink,
  signOutFirmMemberEverywhere,
  updateFirmMember,
} from "@/app/actions/team";
import { teamInitialState } from "@/lib/team-form";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedGate = vi.mocked(requirePermissionResult);
const mInvite = vi.mocked(inviteStaff);
const mBan = vi.mocked(banStaff);
const mRevokeInvite = vi.mocked(revokeStaffInvitation);
const mUnban = vi.mocked(unbanStaff);
const mRevokeAll = vi.mocked(revokeAllStaffSessions);

const OK = { ok: true as const };
const FAIL = { ok: false as const, error: "Couldn't reach the sign-in service." };

let firmId: string;
let adminRoleId: string;
let defaultRoleId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.resetAllMocks();
  mockedGate.mockResolvedValue({ ok: true, userId: "test-user" });
  mInvite.mockResolvedValue(OK);
  mBan.mockResolvedValue(OK);
  mRevokeInvite.mockResolvedValue(OK);
  mUnban.mockResolvedValue(OK);
  mRevokeAll.mockResolvedValue(OK);
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  adminRoleId = f.adminRoleId;
  defaultRoleId = f.defaultRoleId;
});

function inviteForm(): FormData {
  const fd = new FormData();
  fd.set("name", "New Hire");
  fd.set("email", "new.hire@example.com");
  fd.set("initials", "NH");
  fd.set("jobTitle", "Paralegal");
  fd.set("phone", "");
  fd.set("barNumber", "");
  return fd;
}

function updateForm(active: boolean): FormData {
  const fd = new FormData();
  fd.set("name", "Member");
  fd.set("initials", "ME");
  fd.set("jobTitle", "Attorney");
  fd.set("phone", "");
  fd.set("barNumber", "");
  if (active) fd.set("isActive", "on");
  fd.append("roleId", defaultRoleId);
  return fd;
}

async function linkedMember(opts: { isActive?: boolean; roleIds?: string[] } = {}) {
  const m = await seedUser({
    firmId,
    name: "Member",
    isActive: opts.isActive ?? true,
    roleIds: opts.roleIds ?? [defaultRoleId],
  });
  await prisma.user.update({
    where: { id: m.userId },
    data: { clerkUserId: "user_clerk_1" },
  });
  return m.userId;
}

async function actingAdmin() {
  const a = await seedUser({ firmId, roleIds: [adminRoleId, defaultRoleId] });
  mockedGetUser.mockResolvedValue(a.userId);
  return a.userId;
}

describe("inviteFirmMember", () => {
  test("creates the user without a password and sends the Clerk invite", async () => {
    await actingAdmin();
    const res = await inviteFirmMember(teamInitialState, inviteForm());
    expect(res.status).toBe("ok");
    expect(res.warning).toBeUndefined();
    expect(mInvite).toHaveBeenCalledWith("new.hire@example.com");
    const u = await prisma.user.findUniqueOrThrow({
      where: { email: "new.hire@example.com" },
    });
    expect(u.passwordHash).toBeNull();
    expect(u.clerkUserId).toBeNull();
  });

  test("a failed invitation still creates the user and returns the warning", async () => {
    await actingAdmin();
    mInvite.mockResolvedValue(FAIL);
    const res = await inviteFirmMember(teamInitialState, inviteForm());
    expect(res.status).toBe("ok");
    expect(res.warning).toBe(
      "Member added, but the invitation email didn't send. Use Resend invite."
    );
    expect(
      await prisma.user.count({ where: { email: "new.hire@example.com" } })
    ).toBe(1);
  });
});

describe("deactivate / reactivate", () => {
  test("deactivating a linked member bans them in Clerk and logs it", async () => {
    await actingAdmin();
    const id = await linkedMember();
    const res = await updateFirmMember(id, teamInitialState, updateForm(false));
    expect(res.status).toBe("ok");
    expect(res.warning).toBeUndefined();
    expect(mBan).toHaveBeenCalledWith("user_clerk_1");
    const titles = (
      await prisma.activityLog.findMany({ where: { type: "auth" } })
    ).map((l) => l.title);
    expect(titles).toContain("Sign-in blocked (deactivated)");
  });

  test("a ban failure warns, and the DB alone already denies access", async () => {
    await actingAdmin();
    const id = await linkedMember();
    mBan.mockResolvedValue(FAIL);
    const res = await updateFirmMember(id, teamInitialState, updateForm(false));
    expect(res.status).toBe("ok");
    expect(res.warning).toBe(
      "Deactivated. They can't use the CRM, but the sign-in service didn't confirm signing them out. Use Sign out everywhere to retry."
    );
    const auth = await resolveStaffUser("user_clerk_1", "s");
    expect(auth.status).toBe("no_access");
  });

  test("reactivating a linked member unbans them", async () => {
    await actingAdmin();
    const id = await linkedMember({ isActive: false });
    const res = await updateFirmMember(id, teamInitialState, updateForm(true));
    expect(res.status).toBe("ok");
    expect(mUnban).toHaveBeenCalledWith("user_clerk_1");
    expect(mBan).not.toHaveBeenCalled();
    const titles = (
      await prisma.activityLog.findMany({ where: { type: "auth" } })
    ).map((l) => l.title);
    expect(titles).toContain("Sign-in unblocked (reactivated)");
  });

  test("an unban failure warns and the member is active in the DB", async () => {
    await actingAdmin();
    const id = await linkedMember({ isActive: false });
    mUnban.mockResolvedValue(FAIL);
    const res = await updateFirmMember(id, teamInitialState, updateForm(true));
    expect(res.status).toBe("ok");
    expect(res.warning).toBe(
      "Reactivated, but the sign-in service still blocks their sign-in. Deactivate and reactivate them to retry."
    );
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id } })).isActive
    ).toBe(true);
  });

  test("deactivating a never-signed-in member revokes their pending invitation", async () => {
    await actingAdmin();
    const m = await seedUser({ firmId, roleIds: [defaultRoleId] });
    const email = (
      await prisma.user.findUniqueOrThrow({ where: { id: m.userId } })
    ).email;
    const res = await updateFirmMember(m.userId, teamInitialState, updateForm(false));
    expect(res.status).toBe("ok");
    expect(res.warning).toBeUndefined();
    expect(mBan).not.toHaveBeenCalled();
    expect(mRevokeInvite).toHaveBeenCalledWith(email);
  });

  test("an invitation revoke failure warns; the DB already denies access", async () => {
    await actingAdmin();
    const m = await seedUser({ firmId, roleIds: [defaultRoleId] });
    mRevokeInvite.mockResolvedValue(FAIL);
    const res = await updateFirmMember(m.userId, teamInitialState, updateForm(false));
    expect(res.status).toBe("ok");
    expect(res.warning).toContain("Deactivated");
  });

  test("a linked member's deactivation does not touch invitations", async () => {
    await actingAdmin();
    const id = await linkedMember();
    await updateFirmMember(id, teamInitialState, updateForm(false));
    expect(mRevokeInvite).not.toHaveBeenCalled();
  });

  test("reactivating an unlinked member makes no Clerk call", async () => {
    await actingAdmin();
    const m = await seedUser({ firmId, roleIds: [defaultRoleId], isActive: false });
    const res = await updateFirmMember(m.userId, teamInitialState, updateForm(true));
    expect(res.status).toBe("ok");
    expect(mRevokeInvite).not.toHaveBeenCalled();
    expect(mUnban).not.toHaveBeenCalled();
  });
});

describe("signOutFirmMemberEverywhere", () => {
  test("revokes all sessions and logs", async () => {
    await actingAdmin();
    const id = await linkedMember();
    const res = await signOutFirmMemberEverywhere(id);
    expect(res.status).toBe("ok");
    expect(mRevokeAll).toHaveBeenCalledWith("user_clerk_1");
    const titles = (
      await prisma.activityLog.findMany({ where: { type: "auth" } })
    ).map((l) => l.title);
    expect(titles).toContain("Signed out everywhere by an administrator");
  });

  test("reports a Clerk failure as an error", async () => {
    await actingAdmin();
    const id = await linkedMember();
    mRevokeAll.mockResolvedValue(FAIL);
    const res = await signOutFirmMemberEverywhere(id);
    expect(res.status).toBe("error");
  });

  test("a member without Clerk identity has nothing to sign out", async () => {
    await actingAdmin();
    const m = await seedUser({ firmId, roleIds: [defaultRoleId] });
    const res = await signOutFirmMemberEverywhere(m.userId);
    expect(res.status).toBe("error");
    expect(mRevokeAll).not.toHaveBeenCalled();
  });
});

describe("resetFirmMemberSignInLink", () => {
  test("revokes the old identity's sessions, then clears clerkUserId", async () => {
    await actingAdmin();
    const id = await linkedMember();
    const res = await resetFirmMemberSignInLink(id);
    expect(res.status).toBe("ok");
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u.clerkUserId).toBeNull();
    expect(mRevokeAll).toHaveBeenCalledWith("user_clerk_1");
    const titles = (
      await prisma.activityLog.findMany({ where: { type: "auth" } })
    ).map((l) => l.title);
    expect(titles).toContain("Sign-in link reset by an administrator");
  });

  test("a revoke failure changes nothing and reports an error", async () => {
    await actingAdmin();
    const id = await linkedMember();
    mRevokeAll.mockResolvedValue(FAIL);
    const res = await resetFirmMemberSignInLink(id);
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toBe(
      "Couldn't sign them out of the sign-in service, so the link was not reset. Try again."
    );
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id } })).clerkUserId
    ).toBe("user_clerk_1");
    const titles = (
      await prisma.activityLog.findMany({ where: { type: "auth" } })
    ).map((l) => l.title);
    expect(titles).not.toContain("Sign-in link reset by an administrator");
  });

  test("cannot target yourself", async () => {
    const me = await actingAdmin();
    await prisma.user.update({
      where: { id: me },
      data: { clerkUserId: "user_me" },
    });
    const res = await resetFirmMemberSignInLink(me);
    expect(res.status).toBe("error");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: me } })).clerkUserId
    ).toBe("user_me");
  });
});

describe("resendFirmMemberInvite", () => {
  test("re-sends to a never-signed-in member", async () => {
    await actingAdmin();
    const m = await seedUser({
      firmId,
      email: "pending@example.com",
      roleIds: [defaultRoleId],
    });
    const res = await resendFirmMemberInvite(m.userId);
    expect(res.status).toBe("ok");
    expect(mInvite).toHaveBeenCalledWith("pending@example.com");
  });

  test("refuses a member who has already signed in", async () => {
    await actingAdmin();
    const id = await linkedMember();
    const res = await resendFirmMemberInvite(id);
    expect(res.status).toBe("error");
    expect(mInvite).not.toHaveBeenCalled();
  });

  test("a Clerk failure is reported as an error", async () => {
    await actingAdmin();
    const m = await seedUser({ firmId, roleIds: [defaultRoleId] });
    mInvite.mockResolvedValue(FAIL);
    const res = await resendFirmMemberInvite(m.userId);
    expect(res.status).toBe("error");
  });
});

describe("escalation guard", () => {
  test("a non-Admin cannot sign out or reset the link of an Admin", async () => {
    const delegate = await seedUser({ firmId, name: "Delegate" });
    mockedGetUser.mockResolvedValue(delegate.userId);
    const admin = await seedUser({
      firmId,
      name: "The Admin",
      roleIds: [adminRoleId, defaultRoleId],
    });
    await prisma.user.update({
      where: { id: admin.userId },
      data: { clerkUserId: "user_admin" },
    });

    const out = await signOutFirmMemberEverywhere(admin.userId);
    const reset = await resetFirmMemberSignInLink(admin.userId);
    const resend = await resendFirmMemberInvite(admin.userId);
    for (const r of [out, reset, resend]) {
      expect(r.status).toBe("error");
      expect(r.errors?._form?.[0]).toMatch(/Only an Admin/);
    }
    expect(mRevokeAll).not.toHaveBeenCalled();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } }))
        .clerkUserId
    ).toBe("user_admin");
  });

  test("a denied permission gate writes and calls nothing", async () => {
    await actingAdmin();
    const id = await linkedMember();
    mockedGate.mockResolvedValue({
      ok: false,
      error: "You do not have permission to do that.",
    });
    const out = await signOutFirmMemberEverywhere(id);
    const reset = await resetFirmMemberSignInLink(id);
    for (const r of [out, reset]) {
      expect(r.status).toBe("error");
      expect(r.errors?._form?.[0]).toMatch(/permission/);
    }
    expect(mRevokeAll).not.toHaveBeenCalled();
  });

  test("a user in another firm is not found", async () => {
    await actingAdmin();
    const other = await seedFirm();
    const stranger = await seedUser({
      firmId: other.firmId,
      roleIds: [other.defaultRoleId],
    });
    const res = await signOutFirmMemberEverywhere(stranger.userId);
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/not found/i);
  });
});
