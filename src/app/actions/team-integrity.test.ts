/**
 * Integration tests for the team actions' non-escalation behaviour
 * (the escalation guard and the last-admin invariant live in
 * team.test.ts):
 *
 *   - a denied permission gate comes back as a `_form` error — no
 *     silent redirect, nothing written;
 *   - role edits apply as a DIFF, so unchanged roles keep their
 *     original assignedById / assignedAt and the audit entry says
 *     what was granted and revoked;
 *   - input integrity: self-deactivation is ignored, cross-firm user
 *     ids are "not found", duplicate-email invites, foreign role ids
 *     dropped, the default role is always present;
 *   - the Serializable transaction's P2034 conflict is mapped to a
 *     retry-me form error and other errors still propagate.
 *
 * The permission gate is stubbed (it is covered by
 * permission-check.integration.test.ts); the admin-or-not check runs
 * against the real test DB.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/clerk-admin", () => ({
  inviteStaff: vi.fn().mockResolvedValue({ ok: true }),
  banStaff: vi.fn().mockResolvedValue({ ok: true }),
  unbanStaff: vi.fn().mockResolvedValue({ ok: true }),
  revokeAllStaffSessions: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  requirePermissionResult: vi
    .fn()
    .mockResolvedValue({ ok: true, userId: "test-user" }),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermissionResult } from "@/lib/permission-check";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  inviteFirmMember,
  updateFirmMember,
} from "@/app/actions/team";
import { teamInitialState } from "@/lib/team-form";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedGate = vi.mocked(requirePermissionResult);

let firmId: string;
let adminRoleId: string;
let defaultRoleId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  mockedGate.mockReset();
  mockedGate.mockResolvedValue({ ok: true, userId: "test-user" });
  const f = await seedFirm();
  firmId = f.firmId;
  adminRoleId = f.adminRoleId;
  defaultRoleId = f.defaultRoleId;
});

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

function inviteForm(
  overrides: Record<string, string> = {},
  roleIds: string[] = []
): FormData {
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
  for (const id of roleIds) fd.append("roleId", id);
  return fd;
}

describe("permission gate — denial is a form error, not a redirect", () => {
  const DENIED = {
    ok: false as const,
    error: "You do not have permission to do that.",
  };

  test("every team action returns _form and writes nothing when the gate denies", async () => {
    const admin = await seedUser({
      firmId,
      roleIds: [adminRoleId, defaultRoleId],
    });
    const member = await seedUser({
      firmId,
      name: "Member",
      roleIds: [defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(admin.userId);

    mockedGate.mockResolvedValueOnce(DENIED);
    const invited = await inviteFirmMember(teamInitialState, inviteForm());
    mockedGate.mockResolvedValueOnce(DENIED);
    const updated = await updateFirmMember(
      member.userId,
      teamInitialState,
      updateForm({ name: "Hacked" })
    );

    for (const res of [invited, updated]) {
      expect(res.status).toBe("error");
      expect(res.errors?._form?.[0]).toMatch(/permission/);
    }
    expect(
      await prisma.user.count({ where: { email: "new.hire@example.com" } })
    ).toBe(0);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: member.userId },
      select: { name: true },
    });
    expect(row.name).toBe("Member");
    expect(mockedGate).toHaveBeenCalledWith("firm.manage_team_directory");
  });
});

describe("updateFirmMember — role changes apply as a diff", () => {
  let adminUserId: string;
  let billingId: string;
  let litigationId: string;

  beforeEach(async () => {
    adminUserId = (
      await seedUser({ firmId, roleIds: [adminRoleId, defaultRoleId] })
    ).userId;
    billingId = (
      await prisma.role.create({
        data: { firmId, name: "Billing", isSystem: false },
        select: { id: true },
      })
    ).id;
    litigationId = (
      await prisma.role.create({
        data: { firmId, name: "Litigation", isSystem: false },
        select: { id: true },
      })
    ).id;
    mockedGetUser.mockResolvedValue(adminUserId);
  });

  test("a phone-only edit leaves the original grant provenance untouched", async () => {
    const member = await seedUser({
      firmId,
      name: "Member",
      roleIds: [defaultRoleId, billingId],
    });
    const before = await prisma.userRole.findMany({
      where: { userId: member.userId },
      orderBy: { roleId: "asc" },
    });
    // The seed leaves assignedById null; a delete-and-recreate would
    // stamp the editing admin onto every row.
    expect(before.every((r) => r.assignedById === null)).toBe(true);

    const fd = updateForm({
      name: "Member",
      roleIds: [defaultRoleId, billingId],
    });
    fd.set("phone", "555-0100");
    const res = await updateFirmMember(member.userId, teamInitialState, fd);
    expect(res.status).toBe("ok");

    const after = await prisma.userRole.findMany({
      where: { userId: member.userId },
      orderBy: { roleId: "asc" },
    });
    expect(after).toEqual(before);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: member.userId },
      select: { phone: true },
    });
    expect(row.phone).toBe("555-0100");
  });

  test("only the added role is stamped with the editor; the log names what was granted and revoked", async () => {
    const member = await seedUser({
      firmId,
      name: "Member",
      roleIds: [defaultRoleId, billingId],
    });
    const res = await updateFirmMember(
      member.userId,
      teamInitialState,
      updateForm({ name: "Member", roleIds: [defaultRoleId, litigationId] })
    );
    expect(res.status).toBe("ok");

    const rows = await prisma.userRole.findMany({
      where: { userId: member.userId },
    });
    expect(rows.map((r) => r.roleId).sort()).toEqual(
      [defaultRoleId, litigationId].sort()
    );
    const byRole = new Map(rows.map((r) => [r.roleId, r]));
    expect(byRole.get(litigationId)?.assignedById).toBe(adminUserId);
    expect(byRole.get(defaultRoleId)?.assignedById).toBeNull();

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { userId: adminUserId, title: { contains: "Updated team member" } },
    });
    expect(log.detail).toContain("granted: Litigation");
    expect(log.detail).toContain("revoked: Billing");
  });
});

describe("team actions — input integrity", () => {
  let adminUserId: string;

  beforeEach(async () => {
    adminUserId = (
      await seedUser({ firmId, roleIds: [adminRoleId, defaultRoleId] })
    ).userId;
    mockedGetUser.mockResolvedValue(adminUserId);
  });

  test("editing yourself ignores a posted deactivation (self-protection)", async () => {
    // A second admin exists, so the last-admin guard is not what
    // stops this — the self-deactivation rule is.
    await seedUser({ firmId, roleIds: [adminRoleId, defaultRoleId] });
    const res = await updateFirmMember(
      adminUserId,
      teamInitialState,
      updateForm({ name: "Me", roleIds: [adminRoleId], active: false })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: adminUserId },
      select: { isActive: true },
    });
    expect(row.isActive).toBe(true);
  });

  test("a userId from another firm is 'not found' and untouched", async () => {
    const other = await seedFirm({ name: "Other Firm" });
    const stranger = await seedUser({
      firmId: other.firmId,
      name: "Stranger",
      roleIds: [other.defaultRoleId],
    });
    const res = await updateFirmMember(
      stranger.userId,
      teamInitialState,
      updateForm({ name: "Renamed" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.name?.[0]).toMatch(/not found/i);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: stranger.userId },
      select: { name: true },
    });
    expect(row.name).toBe("Stranger");
  });

  test("inviting an existing email (any case) is a field error and creates nothing", async () => {
    await seedUser({ firmId, email: "taken@example.com" });
    const before = await prisma.user.count();
    const res = await inviteFirmMember(
      teamInitialState,
      inviteForm({ email: "Taken@Example.com" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.email?.[0]).toMatch(/already exists/);
    expect(await prisma.user.count()).toBe(before);
  });

  test("invite drops role ids from another firm and always adds the default role", async () => {
    const other = await seedFirm({ name: "Other Firm" });
    const foreignRole = await prisma.role.create({
      data: { firmId: other.firmId, name: "Foreign", isSystem: false },
      select: { id: true },
    });
    const res = await inviteFirmMember(
      teamInitialState,
      inviteForm({}, [foreignRole.id, other.adminRoleId])
    );
    expect(res.status).toBe("ok");
    const created = await prisma.user.findUniqueOrThrow({
      where: { email: "new.hire@example.com" },
      select: { userRoles: { select: { roleId: true } } },
    });
    expect(created.userRoles.map((r) => r.roleId)).toEqual([defaultRoleId]);
  });

  test("an edit that posts no roles still keeps the default role", async () => {
    const member = await seedUser({
      firmId,
      name: "Member",
      roleIds: [defaultRoleId],
    });
    const res = await updateFirmMember(
      member.userId,
      teamInitialState,
      updateForm({ name: "Member", roleIds: [] })
    );
    expect(res.status).toBe("ok");
    const rows = await prisma.userRole.findMany({
      where: { userId: member.userId },
    });
    expect(rows.map((r) => r.roleId)).toEqual([defaultRoleId]);
  });
});

describe("updateFirmMember — serialization failure", () => {
  async function adminAndMember() {
    const admin = await seedUser({
      firmId,
      roleIds: [adminRoleId, defaultRoleId],
    });
    const member = await seedUser({
      firmId,
      name: "Member",
      roleIds: [defaultRoleId],
    });
    mockedGetUser.mockResolvedValue(admin.userId);
    return member;
  }

  test("P2034 from the Serializable transaction becomes a retry-me form error", async () => {
    const member = await adminAndMember();
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("write conflict", {
        code: "P2034",
        clientVersion: "test",
      })
    );
    try {
      const res = await updateFirmMember(
        member.userId,
        teamInitialState,
        updateForm({ name: "Edited" })
      );
      expect(res.status).toBe("error");
      expect(res.errors?._form?.[0]).toMatch(/try again/i);
    } finally {
      spy.mockRestore();
    }
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: member.userId },
      select: { name: true },
    });
    expect(row.name).toBe("Member");
  });

  test("any other transaction error still propagates", async () => {
    const member = await adminAndMember();
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("connection reset"));
    try {
      await expect(
        updateFirmMember(member.userId, teamInitialState, updateForm({}))
      ).rejects.toThrow("connection reset");
    } finally {
      spy.mockRestore();
    }
  });
});
