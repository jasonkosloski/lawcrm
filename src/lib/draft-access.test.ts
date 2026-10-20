/** Integration: who may open / touch a matter draft. */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  assertDraftAccess,
  canAccessDraft,
  draftAccessWhere,
} from "@/lib/draft-access";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/;
let creator: string,
  lead: string,
  seat: string,
  admin: string,
  outsider: string,
  seatNoPerm: string;
let draftId: string;

beforeEach(async () => {
  await resetDb();
  const { firmId, adminRoleId } = await seedFirm();
  const role = await prisma.role.create({
    data: { firmId, name: "intake", description: "x" },
    select: { id: true },
  });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permission: "matters.create" },
  });
  const noPerm = await prisma.role.create({
    data: { firmId, name: "plain", description: "x" },
    select: { id: true },
  });
  const mk = async (roleIds: string[]) =>
    (await seedUser({ firmId, roleIds })).userId;
  creator = await mk([role.id]);
  lead = await mk([role.id]);
  seat = await mk([role.id]);
  seatNoPerm = await mk([noPerm.id]);
  admin = await mk([adminRoleId]);
  outsider = await mk([role.id]);
  const d = await prisma.matterDraft.create({
    data: {
      createdById: creator,
      values: {},
      leadUserId: lead,
      teamUserIds: [seat, seatNoPerm],
    },
  });
  draftId = d.id;
});

describe("canAccessDraft", () => {
  test("creator, lead, team seat and Admin pass; outsider fails", async () => {
    expect(await canAccessDraft(creator, draftId)).toBe(true);
    expect(await canAccessDraft(lead, draftId)).toBe(true);
    expect(await canAccessDraft(seat, draftId)).toBe(true);
    expect(await canAccessDraft(admin, draftId)).toBe(true);
    expect(await canAccessDraft(outsider, draftId)).toBe(false);
  });
  test("a named seat without matters.create is denied", async () => {
    expect(await canAccessDraft(seatNoPerm, draftId)).toBe(false);
  });
  test("missing draft is false even for Admin", async () => {
    expect(await canAccessDraft(admin, "nope")).toBe(false);
  });
});

describe("assertDraftAccess", () => {
  test("returns the draft or notFounds", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(seat);
    expect((await assertDraftAccess(draftId)).id).toBe(draftId);
    vi.mocked(getCurrentUserId).mockResolvedValue(outsider);
    await expect(assertDraftAccess(draftId)).rejects.toThrow(NOT_FOUND);
    vi.mocked(getCurrentUserId).mockResolvedValue(admin);
    await expect(assertDraftAccess("nope")).rejects.toThrow(NOT_FOUND);
  });
});

describe("draftAccessWhere", () => {
  test("filters a list by creator / lead / team; Admin sees all", async () => {
    const ids = async (u: string, a: boolean) =>
      (await prisma.matterDraft.findMany({ where: draftAccessWhere(u, a) })).map(
        (d) => d.id
      );
    expect(await ids(seat, false)).toEqual([draftId]);
    expect(await ids(outsider, false)).toEqual([]);
    expect(await ids(admin, true)).toEqual([draftId]);
  });
});
