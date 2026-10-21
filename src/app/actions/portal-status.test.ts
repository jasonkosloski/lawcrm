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
import { deleteStatusUpdate, editStatusUpdate, postStatusUpdate } from "./portal-status";

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

async function seedIdentity(email: string) {
  const { contactId } = await seedContact({ name: `C ${email}` });
  const identity = await prisma.portalIdentity.create({ data: { contactId, email } });
  await prisma.portalMatterAccess.create({
    data: { identityId: identity.id, matterId, invitedById: admin },
  });
}

async function seedUpdate() {
  return prisma.portalStatusUpdate.create({
    data: { matterId, stageLabel: "Discovery", body: "Old body", postedById: admin },
  });
}

const input = { stageLabel: "Discovery", body: "We filed the motion.", emailClient: false };
const activity = (title: string) =>
  prisma.activityLog.count({ where: { matterId, title: { startsWith: title } } });

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
afterEach(() => cap.restore());

describe("permissions and walls", () => {
  test("each action is denied without its own key", async () => {
    const existing = await seedUpdate();
    sessionUser = await userWith([]);
    const denied = { ok: false, error: PERMISSION_DENIED_MESSAGE };
    expect(await postStatusUpdate(matterId, input)).toEqual(denied);
    expect(await editStatusUpdate(existing.id, input)).toEqual(denied);
    expect(await deleteStatusUpdate(existing.id)).toEqual(denied);
    const row = await prisma.portalStatusUpdate.findUniqueOrThrow({ where: { id: existing.id } });
    expect(row.body).toBe("Old body");
    expect(await prisma.portalStatusUpdate.count()).toBe(1);
  });

  test("a key for another action does not grant this one", async () => {
    sessionUser = await userWith(["portal.edit_updates", "portal.delete_updates"]);
    expect(await postStatusUpdate(matterId, input)).toEqual({
      ok: false,
      error: PERMISSION_DENIED_MESSAGE,
    });
    expect(await prisma.portalStatusUpdate.count()).toBe(0);
  });

  test("a walled user gets not-found and nothing changes", async () => {
    const existing = await seedUpdate();
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith(["portal.add_updates", "portal.edit_updates", "portal.delete_updates"]);
    const notFound = { digest: expect.stringContaining("404") };
    await expect(postStatusUpdate(matterId, input)).rejects.toMatchObject(notFound);
    await expect(editStatusUpdate(existing.id, input)).rejects.toMatchObject(notFound);
    await expect(deleteStatusUpdate(existing.id)).rejects.toMatchObject(notFound);
    expect(await prisma.portalStatusUpdate.count()).toBe(1);
    expect((await prisma.portalStatusUpdate.findUniqueOrThrow({ where: { id: existing.id } })).body).toBe(
      "Old body"
    );
  });
});

describe("validation", () => {
  test("rejects an empty or too-long stage label and a too-long body", async () => {
    expect((await postStatusUpdate(matterId, { ...input, stageLabel: "  " })).ok).toBe(false);
    expect((await postStatusUpdate(matterId, { ...input, stageLabel: "x".repeat(61) })).ok).toBe(false);
    expect((await postStatusUpdate(matterId, { ...input, body: "x".repeat(4001) })).ok).toBe(false);
    expect((await postStatusUpdate(matterId, { ...input, body: " " })).ok).toBe(false);
    expect(await prisma.portalStatusUpdate.count()).toBe(0);
  });

  test("accepts the limits and trims", async () => {
    const res = await postStatusUpdate(matterId, {
      stageLabel: ` ${"x".repeat(60)} `,
      body: ` ${"y".repeat(4000)} `,
      emailClient: false,
    });
    expect(res).toEqual({ ok: true });
    const row = await prisma.portalStatusUpdate.findFirstOrThrow();
    expect(row.stageLabel).toHaveLength(60);
    expect(row.body).toHaveLength(4000);
  });
});

describe("postStatusUpdate", () => {
  test("emails live portal users and sets emailedAt", async () => {
    await seedIdentity("live@example.com");
    const res = await postStatusUpdate(matterId, { ...input, emailClient: true });
    expect(res).toEqual({ ok: true });
    const row = await prisma.portalStatusUpdate.findFirstOrThrow();
    expect(row.postedById).toBe(admin);
    expect(row.emailedAt).toBeInstanceOf(Date);
    expect(cap.sent.map((m) => m.to)).toEqual(["live@example.com"]);
    const m = cap.sent[0];
    expect(m.subject).toBe("Your legal team posted an update");
    for (const s of [m.text, m.html ?? "", m.subject]) {
      expect(s).not.toContain("Alvarez");
      expect(s).not.toContain("Discovery");
      expect(s).not.toContain("motion");
    }
    expect(await activity("Posted client status update: Discovery")).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}`);
  });

  test("skips email when unticked", async () => {
    await seedIdentity("live@example.com");
    expect(await postStatusUpdate(matterId, input)).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(0);
    expect((await prisma.portalStatusUpdate.findFirstOrThrow()).emailedAt).toBeNull();
  });

  test("skips email when portal is off", async () => {
    await seedIdentity("live@example.com");
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect(await postStatusUpdate(matterId, { ...input, emailClient: true })).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(0);
    expect((await prisma.portalStatusUpdate.findFirstOrThrow()).emailedAt).toBeNull();
  });

  test("a failed send warns, keeps the row, and leaves emailedAt null", async () => {
    await seedIdentity("live@example.com");
    __setDriverForTests(async () => ({ ok: false, error: "boom" }));
    const res = await postStatusUpdate(matterId, { ...input, emailClient: true });
    expect(res).toEqual({ ok: true, warning: "Update posted, but the email didn't send." });
    expect((await prisma.portalStatusUpdate.findFirstOrThrow()).emailedAt).toBeNull();
  });
});

describe("editStatusUpdate and deleteStatusUpdate", () => {
  test("edit sets editedAt and never re-sends", async () => {
    await seedIdentity("live@example.com");
    await postStatusUpdate(matterId, { ...input, emailClient: true });
    const before = await prisma.portalStatusUpdate.findFirstOrThrow();
    expect(cap.sent).toHaveLength(1);

    const res = await editStatusUpdate(before.id, { stageLabel: "Trial prep", body: "New text" });
    expect(res).toEqual({ ok: true });
    const after = await prisma.portalStatusUpdate.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.stageLabel).toBe("Trial prep");
    expect(after.body).toBe("New text");
    expect(after.editedAt).toBeInstanceOf(Date);
    expect(after.emailedAt).toEqual(before.emailedAt);
    expect(cap.sent).toHaveLength(1);
    expect(await activity("Edited client status update")).toBe(1);
  });

  test("edit validates and reports a missing row", async () => {
    const row = await seedUpdate();
    expect((await editStatusUpdate(row.id, { stageLabel: "", body: "x" })).ok).toBe(false);
    expect(await editStatusUpdate("nope", { stageLabel: "a", body: "b" })).toEqual({
      ok: false,
      error: "Update not found.",
    });
  });

  test("delete removes the row and logs", async () => {
    const row = await seedUpdate();
    expect(await deleteStatusUpdate(row.id)).toEqual({ ok: true });
    expect(await prisma.portalStatusUpdate.count()).toBe(0);
    expect(await activity("Deleted client status update")).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}`);
  });
});
