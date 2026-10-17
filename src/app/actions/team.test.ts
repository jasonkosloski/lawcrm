/**
 * Integration tests for the team / firm-roster actions.
 *
 * Focus areas (the branches with real product impact):
 *
 *   - "At least one Admin" invariant on updateFirmMember. The count
 *     is re-checked INSIDE a Serializable transaction — the old
 *     outside-the-tx pre-check was a check-then-act race where two
 *     concurrent demotions could leave the firm with zero active
 *     admins. We pin the single-request rejection + rollback and a
 *     concurrent double-demotion that must never end at zero.
 *
 *   - Audit trail. Invite / member update / password reset are
 *     governance actions (credential minting, role grants, password
 *     replacement) and must each write an activity-log entry — and
 *     must NOT leak the temp password into it.
 *
 * Auth + permission gates are stubbed; the gate itself is covered by
 * permission-check.integration.test.ts.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
// The escalation guard asks "is the caller an Admin?" against the real
// DB by default. Spy-wrapped so the invariant tests below can pretend
// the caller passed that gate and exercise the in-transaction checks.
vi.mock("@/lib/firm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/firm")>();
  return { ...actual, isCurrentUserAdmin: vi.fn(actual.isCurrentUserAdmin) };
});
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  requirePermissionResult: vi
    .fn()
    .mockResolvedValue({ ok: true, userId: "test-user" }),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { isCurrentUserAdmin } from "@/lib/firm";
import { prisma } from "@/lib/prisma";
import {
  inviteFirmMember,
  resetFirmMemberPassword,
  unlockFirmMemberSignIn,
  updateFirmMember,
} from "@/app/actions/team";
import { isLockedOut } from "@/lib/credentials-authorize";
import { teamInitialState } from "@/lib/team-form";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let adminRoleId: string;
let defaultRoleId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("@/lib/firm")>("@/lib/firm");
  vi.mocked(isCurrentUserAdmin).mockImplementation(actual.isCurrentUserAdmin);
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  adminRoleId = f.adminRoleId;
  defaultRoleId = f.defaultRoleId;
});

/** Update form. Pass `active: false` to omit the isActive checkbox
 *  (unchecked checkboxes don't post), and `roleIds` for the repeated
 *  multi-select entries. */
function updateForm(opts: {
  name?: string;
  roleIds?: string[];
  active?: boolean;
}): FormData {
  const fd = new FormData();
  fd.set("name", opts.name ?? "Edited Name");
  fd.set("initials", "EN");
  fd.set("jobTitle", "Attorney");
  fd.set("phone", "");
  fd.set("barNumber", "");
  if (opts.active !== false) fd.set("isActive", "on");
  for (const id of opts.roleIds ?? []) fd.append("roleId", id);
  return fd;
}

/** Add repeated roleId entries to a form. */
function withRoles(fd: FormData, roleIds: string[]): FormData {
  for (const id of roleIds) fd.append("roleId", id);
  return fd;
}

function inviteForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: "New Hire",
    email: "new.hire@example.com",
    initials: "NH",
    jobTitle: "Paralegal",
    phone: "",
    barNumber: "",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

async function activeAdminCount(): Promise<number> {
  return prisma.user.count({
    where: {
      firmId,
      isActive: true,
      userRoles: { some: { role: { name: "Admin" } } },
    },
  });
}

describe("updateFirmMember — last-active-admin invariant", () => {
  test("rejects demoting the firm's last active admin and rolls back", async () => {
    const admin = await seedUser({
      firmId,
      name: "Only Admin",
      roleIds: [adminRoleId, defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(admin.userId);

    // Self-demotion (dropping the Admin role) is the simplest path
    // that trips the invariant — the self-protection guard only
    // covers isActive, not roles.
    const res = await updateFirmMember(
      admin.userId,
      teamInitialState,
      updateForm({ name: "Should Not Persist", roleIds: [defaultRoleId] })
    );

    expect(res.status).toBe("error");
    expect(res.errors?.roleId?.[0]).toMatch(/last active Admin/);

    // The rejection happens inside the transaction — nothing may
    // have been written, including the profile-field update.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: admin.userId },
      select: { name: true, userRoles: { select: { roleId: true } } },
    });
    expect(row.name).toBe("Only Admin");
    expect(row.userRoles.map((ur) => ur.roleId)).toContain(adminRoleId);
    expect(await activeAdminCount()).toBe(1);
  });

  test("rejects deactivating the last active admin", async () => {
    const admin = await seedUser({
      firmId,
      name: "Only Admin",
      roleIds: [adminRoleId, defaultRoleId],
    });
    // Actor is a different (non-admin) user so the self-deactivation
    // guard doesn't kick in first — permission gate is mocked open.
    const actor = await seedUser({ firmId, roleIds: [defaultRoleId] });
    mockedGetUser.mockResolvedValue(actor.userId);
    // Invariant under test sits behind the Admin-only escalation guard
    // (covered below); simulate a caller that passed it.
    vi.mocked(isCurrentUserAdmin).mockResolvedValue(true);

    const res = await updateFirmMember(
      admin.userId,
      teamInitialState,
      updateForm({ roleIds: [adminRoleId, defaultRoleId], active: false })
    );

    expect(res.status).toBe("error");
    expect(res.errors?.roleId?.[0]).toMatch(/last active Admin/);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: admin.userId },
      select: { isActive: true },
    });
    expect(row.isActive).toBe(true);
  });

  test("demoting one of two active admins succeeds", async () => {
    const adminA = await seedUser({
      firmId,
      name: "Admin A",
      roleIds: [adminRoleId, defaultRoleId],
    });
    const adminB = await seedUser({
      firmId,
      name: "Admin B",
      roleIds: [adminRoleId, defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(adminA.userId);

    const res = await updateFirmMember(
      adminB.userId,
      teamInitialState,
      updateForm({ name: "Admin B", roleIds: [defaultRoleId] })
    );

    expect(res.status).toBe("ok");
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: adminB.userId },
      select: { userRoles: { select: { roleId: true } } },
    });
    expect(row.userRoles.map((ur) => ur.roleId)).toEqual([defaultRoleId]);
    expect(await activeAdminCount()).toBe(1);
  });

  test("concurrent demotions of the two remaining admins can't reach zero", async () => {
    // The exact race the in-transaction recount exists for: both
    // requests observe "2 admins remaining" if the count runs before
    // the transactions. Post-fix, the recount happens inside a
    // Serializable tx, so whichever demotion lands second must see
    // "1 remaining" (or hit a serialization failure) and be rejected.
    const adminA = await seedUser({
      firmId,
      name: "Admin A",
      roleIds: [adminRoleId, defaultRoleId],
    });
    const adminB = await seedUser({
      firmId,
      name: "Admin B",
      roleIds: [adminRoleId, defaultRoleId],
    });
    const actor = await seedUser({ firmId, roleIds: [defaultRoleId] });
    mockedGetUser.mockResolvedValue(actor.userId);
    vi.mocked(isCurrentUserAdmin).mockResolvedValue(true);

    const [resA, resB] = await Promise.all([
      updateFirmMember(
        adminA.userId,
        teamInitialState,
        updateForm({ name: "Admin A", roleIds: [defaultRoleId] })
      ),
      updateFirmMember(
        adminB.userId,
        teamInitialState,
        updateForm({ name: "Admin B", roleIds: [defaultRoleId] })
      ),
    ]);

    // At most one demotion may succeed, and the firm must keep at
    // least one active admin no matter how the two interleave.
    expect([resA.status, resB.status].filter((s) => s === "ok").length)
      .toBeLessThanOrEqual(1);
    expect(await activeAdminCount()).toBeGreaterThanOrEqual(1);
  });
});

describe("audit trail — team mutations write activity-log entries", () => {
  test("inviteFirmMember logs who invited whom (without the temp password)", async () => {
    const actor = await seedUser({
      firmId,
      roleIds: [adminRoleId, defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(actor.userId);

    const res = await inviteFirmMember(teamInitialState, inviteForm());
    expect(res.status).toBe("ok");
    expect(res.invitePassword).toBeTruthy();

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { userId: actor.userId, type: "auth" },
    });
    expect(log.matterId).toBeNull();
    expect(log.title).toContain("Invited New Hire");
    expect(log.detail).toContain("new.hire@example.com");
    // Credentials never land in the audit trail.
    expect(log.title).not.toContain(res.invitePassword!);
    expect(log.detail ?? "").not.toContain(res.invitePassword!);
  });

  test("updateFirmMember logs the role/status outcome", async () => {
    const actor = await seedUser({
      firmId,
      roleIds: [adminRoleId, defaultRoleId],
    });
    const member = await seedUser({
      firmId,
      name: "Member",
      roleIds: [defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(actor.userId);

    const res = await updateFirmMember(
      member.userId,
      teamInitialState,
      updateForm({ name: "Member", roleIds: [adminRoleId, defaultRoleId] })
    );
    expect(res.status).toBe("ok");

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { userId: actor.userId, type: "auth" },
    });
    expect(log.matterId).toBeNull();
    expect(log.title).toContain("Updated team member Member");
    expect(log.detail).toContain("Admin");
  });

  test("resetFirmMemberPassword logs actor + target (without the temp password)", async () => {
    const actor = await seedUser({
      firmId,
      roleIds: [adminRoleId, defaultRoleId],
    });
    const member = await seedUser({ firmId, name: "Target Member" });
    mockedGetUser.mockResolvedValue(actor.userId);

    const res = await resetFirmMemberPassword(member.userId);
    expect(res.status).toBe("ok");
    expect(res.resetPassword).toBeTruthy();

    // Password actually rotated.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: member.userId },
      select: { passwordHash: true },
    });
    expect(row.passwordHash).toBeTruthy();

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { userId: actor.userId, type: "auth" },
    });
    expect(log.matterId).toBeNull();
    expect(log.title).toBe("Reset password for Target Member");
    expect(log.title).not.toContain(res.resetPassword!);
    expect(log.detail ?? "").not.toContain(res.resetPassword!);
  });
});

// ── Escalation guard ────────────────────────────────────────────────────
// A non-Admin holding firm.manage_team_directory (the delegation the
// permission exists for) must not be able to mint or become an Admin,
// or take over an Admin's account. permission-check is stubbed open,
// so every refusal below comes from the team.ts guard itself, against
// real role rows.

describe("escalation guard — non-Admin directory manager", () => {
  let delegateId: string;
  let adminUserId: string;
  let memberId: string;
  let privilegedRoleId: string;

  beforeEach(async () => {
    const delegate = await seedUser({
      firmId,
      name: "Office Manager",
      roleIds: [defaultRoleId],
    });
    delegateId = delegate.userId;
    const admin = await seedUser({
      firmId,
      name: "Managing Partner",
      roleIds: [adminRoleId, defaultRoleId],
    });
    adminUserId = admin.userId;
    const member = await seedUser({
      firmId,
      name: "Plain Member",
      roleIds: [defaultRoleId],
    });
    memberId = member.userId;
    const priv = await prisma.role.create({
      data: {
        firmId,
        name: "Access manager",
        isSystem: false,
        permissions: { create: { permission: "firm.manage_permissions" } },
      },
      select: { id: true },
    });
    privilegedRoleId = priv.id;
    mockedGetUser.mockResolvedValue(delegateId);
  });

  const rolesOf = async (userId: string) =>
    (
      await prisma.userRole.findMany({ where: { userId }, select: { roleId: true } })
    ).map((r) => r.roleId);

  test("cannot invite a user with the Admin role", async () => {
    const res = await inviteFirmMember(teamInitialState, withRoles(inviteForm(), [adminRoleId]));
    expect(res.status).toBe("error");
    expect(res.errors?.roleId?.[0]).toMatch(/Only an Admin/);
    expect(
      await prisma.user.findUnique({ where: { email: "new.hire@example.com" } })
    ).toBeNull();
  });

  test("cannot invite a user with a role that carries admin-only permissions", async () => {
    const res = await inviteFirmMember(
      teamInitialState,
      withRoles(inviteForm(), [privilegedRoleId])
    );
    expect(res.status).toBe("error");
    expect(
      await prisma.user.findUnique({ where: { email: "new.hire@example.com" } })
    ).toBeNull();
  });

  test("can still invite with ordinary roles", async () => {
    const ordinary = await prisma.role.create({
      data: { firmId, name: "Paralegal", isSystem: false },
      select: { id: true },
    });
    const res = await inviteFirmMember(
      teamInitialState,
      withRoles(inviteForm(), [ordinary.id])
    );
    expect(res.status).toBe("ok");
  });

  test("cannot self-promote to Admin", async () => {
    const res = await updateFirmMember(
      delegateId,
      teamInitialState,
      updateForm({ name: "Office Manager", roleIds: [defaultRoleId, adminRoleId] })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.roleId?.[0]).toMatch(/Only an Admin/);
    expect(await rolesOf(delegateId)).toEqual([defaultRoleId]);
  });

  test("cannot grant Admin or a privileged role to someone else", async () => {
    for (const roleId of [adminRoleId, privilegedRoleId]) {
      const res = await updateFirmMember(
        memberId,
        teamInitialState,
        updateForm({ name: "Plain Member", roleIds: [defaultRoleId, roleId] })
      );
      expect(res.status).toBe("error");
    }
    expect(await rolesOf(memberId)).toEqual([defaultRoleId]);
  });

  test("cannot strip the Admin role from an Admin", async () => {
    const res = await updateFirmMember(
      adminUserId,
      teamInitialState,
      updateForm({ name: "Managing Partner", roleIds: [defaultRoleId] })
    );
    expect(res.status).toBe("error");
    expect(await rolesOf(adminUserId)).toContain(adminRoleId);
  });

  test("cannot deactivate an Admin", async () => {
    const res = await updateFirmMember(
      adminUserId,
      teamInitialState,
      updateForm({
        name: "Managing Partner",
        roleIds: [adminRoleId, defaultRoleId],
        active: false,
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/Only an Admin/);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: adminUserId },
      select: { isActive: true },
    });
    expect(row.isActive).toBe(true);
  });

  test("cannot deactivate a privileged-role holder", async () => {
    const holder = await seedUser({
      firmId,
      name: "Access Holder",
      roleIds: [defaultRoleId, privilegedRoleId],
    });
    const res = await updateFirmMember(
      holder.userId,
      teamInitialState,
      updateForm({
        name: "Access Holder",
        roleIds: [defaultRoleId, privilegedRoleId],
        active: false,
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.isActive?.[0]).toMatch(/Only an Admin/);
  });

  test("cannot edit an Admin's profile fields, even with roles and status unchanged", async () => {
    const res = await updateFirmMember(
      adminUserId,
      teamInitialState,
      updateForm({
        name: "Renamed Partner",
        roleIds: [adminRoleId, defaultRoleId],
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/Only an Admin/);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: adminUserId },
      select: { name: true },
    });
    expect(row.name).toBe("Managing Partner");
  });

  test("can edit an ordinary member's roles (no privileged role involved)", async () => {
    const ordinary = await prisma.role.create({
      data: { firmId, name: "Paralegal", isSystem: false },
      select: { id: true },
    });
    const res = await updateFirmMember(
      memberId,
      teamInitialState,
      updateForm({ name: "Plain Member", roleIds: [defaultRoleId, ordinary.id] })
    );
    expect(res.status).toBe("ok");
    expect((await rolesOf(memberId)).sort()).toEqual([defaultRoleId, ordinary.id].sort());
  });

  test("cannot reset an Admin's password", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: adminUserId },
      select: { passwordHash: true },
    });
    const res = await resetFirmMemberPassword(adminUserId);
    expect(res.status).toBe("error");
    expect(res.resetPassword).toBeUndefined();
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: adminUserId },
      select: { passwordHash: true },
    });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  test("cannot reset the password of a privileged-role holder, but can reset an ordinary member's", async () => {
    const holder = await seedUser({
      firmId,
      name: "Access Holder",
      roleIds: [defaultRoleId, privilegedRoleId],
    });
    const denied = await resetFirmMemberPassword(holder.userId);
    expect(denied.status).toBe("error");

    const ok = await resetFirmMemberPassword(memberId);
    expect(ok.status).toBe("ok");
    expect(ok.resetPassword).toBeTruthy();
  });

  test("an Admin can do all of the above", async () => {
    mockedGetUser.mockResolvedValue(adminUserId);
    const promote = await updateFirmMember(
      memberId,
      teamInitialState,
      updateForm({ name: "Plain Member", roleIds: [defaultRoleId, adminRoleId] })
    );
    expect(promote.status).toBe("ok");
    const otherAdmin = await resetFirmMemberPassword(memberId);
    expect(otherAdmin.status).toBe("ok");
    const invited = await inviteFirmMember(
      teamInitialState,
      withRoles(inviteForm(), [adminRoleId])
    );
    expect(invited.status).toBe("ok");
  });
});

describe("sign-in lockout — admin unlock", () => {
  async function lock(userId: string) {
    for (let i = 0; i < 5; i++) {
      await prisma.activityLog.create({
        data: {
          matterId: null,
          userId,
          type: "auth",
          title: "Failed sign-in",
        },
      });
    }
  }

  test("a password reset clears an attacker-induced lockout", async () => {
    const actor = await seedUser({ firmId, roleIds: [adminRoleId, defaultRoleId] });
    const member = await seedUser({ firmId, name: "Locked Member" });
    mockedGetUser.mockResolvedValue(actor.userId);
    await lock(member.userId);
    expect(await isLockedOut(member.userId)).toBe(true);

    const res = await resetFirmMemberPassword(member.userId);
    expect(res.status).toBe("ok");
    expect(await isLockedOut(member.userId)).toBe(false);
  });

  test("unlockFirmMemberSignIn clears the lock and logs both sides", async () => {
    const actor = await seedUser({ firmId, roleIds: [adminRoleId, defaultRoleId] });
    const member = await seedUser({ firmId, name: "Locked Member" });
    mockedGetUser.mockResolvedValue(actor.userId);
    await lock(member.userId);

    const res = await unlockFirmMemberSignIn(member.userId);
    expect(res.status).toBe("ok");
    expect(await isLockedOut(member.userId)).toBe(false);
    const titles = (
      await prisma.activityLog.findMany({ where: { type: "auth" } })
    ).map((l) => l.title);
    expect(titles).toContain("Sign-in unlocked by an administrator");
    expect(titles).toContain("Unlocked sign-in for Locked Member");
  });

  test("a delegate cannot unlock an Admin (or an access-manager role holder)", async () => {
    const delegate = await seedUser({ firmId, name: "Delegate" });
    const admin = await seedUser({
      firmId,
      name: "Locked Admin",
      roleIds: [adminRoleId, defaultRoleId],
    });
    const priv = await prisma.role.create({
      data: {
        firmId,
        name: "Access manager",
        isSystem: false,
        permissions: { create: { permission: "firm.manage_team_directory" } },
      },
      select: { id: true },
    });
    const holder = await seedUser({
      firmId,
      name: "Locked Holder",
      roleIds: [defaultRoleId, priv.id],
    });
    mockedGetUser.mockResolvedValue(delegate.userId);
    await lock(admin.userId);
    await lock(holder.userId);

    for (const target of [admin.userId, holder.userId]) {
      const res = await unlockFirmMemberSignIn(target);
      expect(res.status).toBe("error");
      expect(res.errors?._form?.[0]).toMatch(/Only an Admin/);
      expect(await isLockedOut(target)).toBe(true);
    }
  });

  test("a delegate cannot clear an Admin's lock via a password reset either", async () => {
    const delegate = await seedUser({ firmId, name: "Delegate" });
    const admin = await seedUser({
      firmId,
      name: "Locked Admin",
      roleIds: [adminRoleId, defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(delegate.userId);
    await lock(admin.userId);
    const res = await resetFirmMemberPassword(admin.userId);
    expect(res.status).toBe("error");
    expect(await isLockedOut(admin.userId)).toBe(true);
  });

  test("a delegate CAN unlock an ordinary member", async () => {
    const delegate = await seedUser({ firmId, name: "Delegate" });
    const member = await seedUser({ firmId, name: "Locked Member" });
    mockedGetUser.mockResolvedValue(delegate.userId);
    await lock(member.userId);
    const res = await unlockFirmMemberSignIn(member.userId);
    expect(res.status).toBe("ok");
    expect(await isLockedOut(member.userId)).toBe(false);
  });

  test("a failed unlock write is reported as an error, not ok", async () => {
    const actor = await seedUser({ firmId, roleIds: [adminRoleId, defaultRoleId] });
    const member = await seedUser({ firmId, name: "Locked Member" });
    mockedGetUser.mockResolvedValue(actor.userId);
    await lock(member.userId);

    const spy = vi
      .spyOn(prisma.activityLog, "create")
      .mockRejectedValueOnce(new Error("db down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await unlockFirmMemberSignIn(member.userId);
    spy.mockRestore();
    quiet.mockRestore();
    expect(res.status).toBe("error");
    expect(await isLockedOut(member.userId)).toBe(true);
  });

  test("unlocking a user outside the firm is refused", async () => {
    const actor = await seedUser({ firmId, roleIds: [adminRoleId, defaultRoleId] });
    mockedGetUser.mockResolvedValue(actor.userId);
    const res = await unlockFirmMemberSignIn("no-such-user");
    expect(res.status).toBe("error");
  });
});
