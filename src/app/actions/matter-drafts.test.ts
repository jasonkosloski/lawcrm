/** Integration: matter-draft server actions. */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({ deleteFile: vi.fn(async () => {}) }));

import { getCurrentUserId } from "@/lib/current-user";
import { deleteFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import {
  deleteMatterDraft,
  removeDraftFile,
  saveMatterDraft,
  setDraftFileOriginating,
} from "@/app/actions/matter-drafts";
import { listMatterDrafts } from "@/lib/queries/matter-drafts";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let creator: string, other: string, admin: string, testFirmId: string;

function as(u: string) {
  vi.mocked(getCurrentUserId).mockResolvedValue(u);
}

beforeEach(async () => {
  await resetDb();
  vi.mocked(deleteFile).mockReset();
  vi.mocked(deleteFile).mockResolvedValue(undefined);
  const { firmId, adminRoleId } = await seedFirm();
  testFirmId = firmId;
  const role = await prisma.role.create({
    data: { firmId, name: "intake", description: "x" },
    select: { id: true },
  });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permission: "matters.create" },
  });
  creator = (await seedUser({ firmId, name: "Cara", roleIds: [role.id] })).userId;
  other = (await seedUser({ firmId, roleIds: [role.id] })).userId;
  admin = (await seedUser({ firmId, roleIds: [adminRoleId] })).userId;
  as(creator);
});

async function newDraft() {
  const r = await saveMatterDraft(null, null, { newClientName: "Secret Client" });
  if (!r.ok) throw new Error("save failed");
  return r;
}

describe("saveMatterDraft", () => {
  test("create then update then stale", async () => {
    const a = await newDraft();
    const b = await saveMatterDraft(a.draftId, a.updatedAt, {
      newClientName: "X",
      leadUserId: other,
      extraTeam: JSON.stringify([{ userId: admin, role: "paralegal" }]),
    });
    expect(b.ok).toBe(true);
    const row = await prisma.matterDraft.findUniqueOrThrow({
      where: { id: a.draftId },
    });
    expect(row.leadUserId).toBe(other);
    expect(row.teamUserIds).toEqual([admin]);
    const stale = await saveMatterDraft(a.draftId, a.updatedAt, {});
    expect(stale).toEqual({ ok: false, code: "stale" });
  });

  test("a deleted id never recreates", async () => {
    const a = await newDraft();
    await prisma.matterDraft.delete({ where: { id: a.draftId } });
    const r = await saveMatterDraft(a.draftId, a.updatedAt, {});
    expect(r).toEqual({ ok: false, code: "notfound" });
    expect(await prisma.matterDraft.count()).toBe(0);
  });

  test("rejects oversize or non-string values without writing", async () => {
    const big = await saveMatterDraft(null, null, { notes: "x".repeat(200_001) });
    expect(big).toEqual({ ok: false, code: "invalid" });
    const bad = await saveMatterDraft(null, null, { a: { nested: 1 } } as never);
    expect(bad).toEqual({ ok: false, code: "invalid" });
    const badArr = await saveMatterDraft(null, null, { a: [1] } as never);
    expect(badArr).toEqual({ ok: false, code: "invalid" });
    expect(await prisma.matterDraft.count()).toBe(0);
    const a = await newDraft();
    const upd = await saveMatterDraft(a.draftId, a.updatedAt, {
      notes: "x".repeat(200_001),
    });
    expect(upd).toEqual({ ok: false, code: "invalid" });
  });

  test("only creation logs, and titles carry no client name", async () => {
    const a = await newDraft();
    await saveMatterDraft(a.draftId, a.updatedAt, { newClientName: "Y" });
    const logs = await prisma.activityLog.findMany();
    expect(logs.map((l) => l.title)).toEqual(["Matter draft started"]);
  });
});

describe("deleteMatterDraft", () => {
  test("non-creator refused; creator deletes rows then files", async () => {
    const a = await newDraft();
    await prisma.matterDraftFile.create({
      data: { draftId: a.draftId, name: "secret.pdf", fileUrl: "k1", uploadedBy: creator },
    });
    await prisma.matterDraft.update({
      where: { id: a.draftId },
      data: { leadUserId: other },
    });
    as(other);
    expect(await deleteMatterDraft(a.draftId)).toEqual({
      ok: false,
      error: "Only the person who started this draft can delete it.",
    });
    as(creator);
    let rowsAtFileDelete = -1;
    vi.mocked(deleteFile).mockImplementation(async () => {
      rowsAtFileDelete = await prisma.matterDraft.count();
    });
    expect(await deleteMatterDraft(a.draftId)).toEqual({ ok: true });
    expect(deleteFile).toHaveBeenCalledWith("k1");
    expect(rowsAtFileDelete).toBe(0);
    const titles = (await prisma.activityLog.findMany()).map((l) => l.title);
    expect(titles).toContain("Matter draft deleted");
    expect(titles.join()).not.toMatch(/secret/i);
  });

  test("Create claimed the draft first -> 'already used', no bytes deleted", async () => {
    const a = await newDraft();
    await prisma.matterDraftFile.create({
      data: { draftId: a.draftId, name: "a", fileUrl: "k-claimed", uploadedBy: creator },
    });
    // Simulate Create winning before the delete's transaction takes its lock.
    const real = prisma.$transaction.bind(prisma);
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(((fn: unknown, o: unknown) =>
        prisma.matterDraft
          .delete({ where: { id: a.draftId } })
          .then(() => (real as (x: unknown, y: unknown) => unknown)(fn, o))) as never);
    expect(await deleteMatterDraft(a.draftId)).toEqual({
      ok: false,
      error: "This draft was already used to open a matter.",
    });
    spy.mockRestore();
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await prisma.activityLog.findMany()).map((l) => l.title)).not.toContain(
      "Matter draft deleted",
    );
  });

  test("never deletes bytes a Document references", async () => {
    const a = await newDraft();
    await prisma.matterDraftFile.create({
      data: { draftId: a.draftId, name: "a", fileUrl: "k-shared", uploadedBy: creator },
    });
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: creator,
      name: "M",
    });
    await prisma.document.create({
      data: { matterId, name: "a", fileUrl: "k-shared", uploadedBy: creator },
    });
    expect(await deleteMatterDraft(a.draftId)).toEqual({ ok: true });
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test("Admin may delete", async () => {
    const a = await newDraft();
    as(admin);
    expect(await deleteMatterDraft(a.draftId)).toEqual({ ok: true });
  });
});

describe("draft files", () => {
  test("originating toggle keeps exactly one; remove deletes row then bytes", async () => {
    const a = await newDraft();
    const f1 = await prisma.matterDraftFile.create({
      data: {
        draftId: a.draftId,
        name: "a",
        fileUrl: "k1",
        uploadedBy: creator,
        isOriginating: true,
      },
    });
    const f2 = await prisma.matterDraftFile.create({
      data: { draftId: a.draftId, name: "b", fileUrl: "k2", uploadedBy: creator },
    });
    expect(await setDraftFileOriginating(f2.id)).toEqual({ ok: true });
    const rows = await prisma.matterDraftFile.findMany({ where: { isOriginating: true } });
    expect(rows.map((r) => r.id)).toEqual([f2.id]);
    expect(await removeDraftFile(f1.id)).toEqual({ ok: true });
    expect(await prisma.matterDraftFile.count()).toBe(1);
    expect(deleteFile).toHaveBeenCalledWith("k1");
    const titles = (await prisma.activityLog.findMany()).map((l) => l.title);
    expect(titles).toContain("File removed from a matter draft");
  });
});

describe("setDraftFileOriginating when the file vanishes", () => {
  test("returns { ok: false } instead of throwing", async () => {
    const a = await newDraft();
    const f = await prisma.matterDraftFile.create({
      data: { draftId: a.draftId, name: "a", fileUrl: "k-gone", uploadedBy: creator },
    });
    const real = prisma.$transaction.bind(prisma);
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(((fn: unknown, o: unknown) =>
        prisma.matterDraftFile
          .delete({ where: { id: f.id } })
          .then(() => (real as (x: unknown, y: unknown) => unknown)(fn, o))) as never);
    await expect(setDraftFileOriginating(f.id)).resolves.toEqual({ ok: false });
    spy.mockRestore();
  });
});

describe("removeDraftFile vs Create claim", () => {
  test("file row gone (draft claimed) -> no stored bytes deleted", async () => {
    const a = await newDraft();
    const f = await prisma.matterDraftFile.create({
      data: { draftId: a.draftId, name: "a", fileUrl: "k-claimed", uploadedBy: creator },
    });
    // Simulate Create winning between the action's read and its lock.
    const real = prisma.$transaction.bind(prisma);
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(((fn: unknown, o: unknown) =>
        prisma.matterDraft
          .delete({ where: { id: a.draftId } })
          .then(() => (real as (x: unknown, y: unknown) => unknown)(fn, o))) as never);
    expect(await removeDraftFile(f.id)).toEqual({ ok: false });
    spy.mockRestore();
    expect(deleteFile).not.toHaveBeenCalled();
  });
});

describe("listMatterDrafts", () => {
  test("scopes to the user, labels, delete flag, retention countdown", async () => {
    const a = await newDraft();
    await prisma.matterDraft.update({
      where: { id: a.draftId },
      data: { updatedAt: new Date(Date.now() - 80 * 86_400_000) },
    });
    const mine = await listMatterDrafts();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      clientLabel: "Secret Client",
      createdByName: "Cara",
      canDelete: true,
      deletesInDays: 10,
    });
    as(other);
    expect(await listMatterDrafts()).toHaveLength(0);
    as(admin);
    const adm = await listMatterDrafts();
    expect(adm).toHaveLength(1);
    expect(adm[0].canDelete).toBe(true);
  });

  test("a user named on a draft but lacking matters.create sees nothing", async () => {
    const bare = await prisma.role.create({
      data: { firmId: testFirmId, name: "bare", description: "x" },
      select: { id: true },
    });
    const { userId: seat } = await seedUser({ firmId: testFirmId, roleIds: [bare.id] });
    const a = await newDraft();
    await prisma.matterDraft.update({
      where: { id: a.draftId },
      data: { leadUserId: seat, teamUserIds: [seat] },
    });
    as(seat);
    expect(await listMatterDrafts()).toEqual([]);
  });
});
