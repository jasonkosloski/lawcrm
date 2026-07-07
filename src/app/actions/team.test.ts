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
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  inviteFirmMember,
  resetFirmMemberPassword,
  updateFirmMember,
} from "@/app/actions/team";
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
      where: { userId: actor.userId, type: "filing" },
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
      where: { userId: actor.userId, type: "filing" },
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
      where: { userId: actor.userId, type: "filing" },
    });
    expect(log.matterId).toBeNull();
    expect(log.title).toBe("Reset password for Target Member");
    expect(log.title).not.toContain(res.resetPassword!);
    expect(log.detail ?? "").not.toContain(res.resetPassword!);
  });
});
