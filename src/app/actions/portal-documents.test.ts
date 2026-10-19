import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let sessionUser = "";
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => sessionUser),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
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
import {
  acceptDocumentRequest,
  cancelDocumentRequest,
  createDocumentRequest,
  deleteDocumentRequest,
  sendBackDocumentRequest,
  updateDocumentRequest,
} from "./portal-documents";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

const CONFLICT = "This request changed, refresh to see it.";

let firmId: string;
let adminRoleId: string;
let admin: string;
let matterId: string;
let areaId: string;
let stageId: string;
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

async function seedIdentity(email: string, opts: { revoked?: boolean; disabled?: boolean } = {}) {
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
}

async function seedRequest(status: string) {
  return (
    await prisma.documentRequest.create({
      data: { matterId, title: "Bank statements", status, createdById: admin },
      select: { id: true },
    })
  ).id;
}

const activityCount = () => prisma.activityLog.count({ where: { matterId, type: "document" } });

beforeEach(async () => {
  await resetDb();
  cap = captureEmails();
  vi.mocked(revalidatePath).mockClear();
  ({ firmId, adminRoleId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  admin = (await seedUser({ firmId, roleIds: [adminRoleId] })).userId;
  sessionUser = admin;
  ({ areaId, stageId } = await seedPracticeArea());
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: admin,
    name: "Alvarez secret matter",
  }));
});
afterEach(() => cap.restore());

describe("permissions and walls", () => {
  test("each action denies without its permission", async () => {
    sessionUser = await userWith([]);
    const id = await seedRequest("submitted");
    const denied = { ok: false, error: expect.any(String) };
    expect(await createDocumentRequest(matterId, { title: "x" })).toMatchObject(denied);
    expect(await updateDocumentRequest(id, { title: "x" })).toMatchObject(denied);
    expect(await acceptDocumentRequest(id)).toMatchObject(denied);
    expect(await sendBackDocumentRequest(id, "n")).toMatchObject(denied);
    expect(await cancelDocumentRequest(id)).toMatchObject(denied);
    expect(await deleteDocumentRequest(id)).toMatchObject(denied);
    expect((await prisma.documentRequest.findUniqueOrThrow({ where: { id } })).status).toBe("submitted");
    expect(await prisma.documentRequest.count()).toBe(1);
  });

  test("a walled user is refused with not-found", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith([
      "portal.add_requests",
      "portal.edit_requests",
      "portal.delete_requests",
    ]);
    const id = await seedRequest("submitted");
    const notFound = { digest: expect.stringContaining("404") };
    await expect(createDocumentRequest(matterId, { title: "x" })).rejects.toMatchObject(notFound);
    await expect(updateDocumentRequest(id, { title: "x" })).rejects.toMatchObject(notFound);
    await expect(acceptDocumentRequest(id)).rejects.toMatchObject(notFound);
    await expect(sendBackDocumentRequest(id, "n")).rejects.toMatchObject(notFound);
    await expect(cancelDocumentRequest(id)).rejects.toMatchObject(notFound);
    await expect(deleteDocumentRequest(id)).rejects.toMatchObject(notFound);
    expect(await prisma.documentRequest.count()).toBe(1);
  });
});

describe("createDocumentRequest", () => {
  test("creates, parses dueDate as UTC midnight, emails live identities once, logs, revalidates", async () => {
    await seedIdentity("live@example.com");
    await seedIdentity("revoked@example.com", { revoked: true });
    await seedIdentity("disabled@example.com", { disabled: true });
    const res = await createDocumentRequest(matterId, {
      title: "Bank statements",
      instructions: "Last 3 months",
      dueDate: "2026-11-05",
    });
    expect(res).toEqual({ ok: true });
    const row = await prisma.documentRequest.findFirstOrThrow();
    expect(row.status).toBe("open");
    expect(row.createdById).toBe(admin);
    expect(row.dueDate?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(cap.sent.map((m) => m.to)).toEqual(["live@example.com"]);
    const m = cap.sent[0];
    expect(m.subject).toBe("Your legal team has requested documents");
    for (const s of [m.text, m.html ?? "", m.subject]) {
      expect(s).not.toContain("Alvarez");
      expect(s).not.toContain("Bank statements");
    }
    expect(await activityCount()).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}`);
  });

  test("sends nothing when the portal is off, and rejects bad input", async () => {
    await seedIdentity("live@example.com");
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect(await createDocumentRequest(matterId, { title: "x" })).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(0);
    expect((await createDocumentRequest(matterId, { title: "  " })).ok).toBe(false);
    expect((await createDocumentRequest(matterId, { title: "x", dueDate: "2026-02-31" })).ok).toBe(false);
    expect(await prisma.documentRequest.count()).toBe(1);
  });

  test("an email failure never fails the action and is noted on the activity", async () => {
    await seedIdentity("live@example.com");
    cap.restore();
    const { __setDriverForTests } = await import("@/lib/email/send");
    __setDriverForTests(async () => ({ ok: false, error: "boom" }));
    expect(await createDocumentRequest(matterId, { title: "x" })).toEqual({ ok: true });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId, type: "document" } });
    expect(log.detail).toContain("— email failed");
    __setDriverForTests(null);
  });
});

describe("transitions", () => {
  test("update only while open", async () => {
    const open = await seedRequest("open");
    expect(await updateDocumentRequest(open, { title: "New", dueDate: "2026-12-01" })).toEqual({ ok: true });
    expect((await prisma.documentRequest.findUniqueOrThrow({ where: { id: open } })).title).toBe("New");
    const sub = await seedRequest("submitted");
    expect(await updateDocumentRequest(sub, { title: "New" })).toEqual({ ok: false, error: CONFLICT });
  });

  test("accept: submitted -> complete with completedAt; wrong status conflicts", async () => {
    const id = await seedRequest("submitted");
    expect(await acceptDocumentRequest(id)).toEqual({ ok: true });
    const row = await prisma.documentRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("complete");
    expect(row.completedAt).not.toBeNull();
    expect(await acceptDocumentRequest(id)).toEqual({ ok: false, error: CONFLICT });
    expect(await acceptDocumentRequest(await seedRequest("open"))).toEqual({ ok: false, error: CONFLICT });
  });

  test("send back: submitted -> open with returnNote; wrong status conflicts", async () => {
    const id = await seedRequest("submitted");
    expect(await sendBackDocumentRequest(id, "Need page 2")).toEqual({ ok: true });
    const row = await prisma.documentRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("open");
    expect(row.returnNote).toBe("Need page 2");
    expect(await sendBackDocumentRequest(id, "again")).toEqual({ ok: false, error: CONFLICT });
  });

  test("cancel: open|submitted -> cancelled; complete/cancelled conflict", async () => {
    for (const s of ["open", "submitted"]) {
      const id = await seedRequest(s);
      expect(await cancelDocumentRequest(id)).toEqual({ ok: true });
      expect((await prisma.documentRequest.findUniqueOrThrow({ where: { id } })).status).toBe("cancelled");
    }
    for (const s of ["complete", "cancelled"]) {
      expect(await cancelDocumentRequest(await seedRequest(s))).toEqual({ ok: false, error: CONFLICT });
    }
  });

  test("race: accept vs cancel yields exactly one ok", async () => {
    const id = await seedRequest("submitted");
    const results = await Promise.all([acceptDocumentRequest(id), cancelDocumentRequest(id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: CONFLICT });
  });

  test("every success writes one activity row and revalidates the matter", async () => {
    const id = await seedRequest("submitted");
    await acceptDocumentRequest(id);
    expect(await activityCount()).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}`);
    await acceptDocumentRequest(id); // conflict: no extra row
    expect(await activityCount()).toBe(1);
  });
});

describe("deleteDocumentRequest", () => {
  test("deletes an empty request and logs", async () => {
    const id = await seedRequest("open");
    expect(await deleteDocumentRequest(id)).toEqual({ ok: true });
    expect(await prisma.documentRequest.count()).toBe(0);
    expect(await activityCount()).toBe(1);
  });

  test("refused when a document is linked", async () => {
    const id = await seedRequest("open");
    await prisma.document.create({
      data: {
        matterId,
        name: "a.pdf",
        documentRequestId: id,
      } as never,
    });
    expect(await deleteDocumentRequest(id)).toEqual({
      ok: false,
      error: "This request has files attached. Cancel it instead.",
    });
    expect(await prisma.documentRequest.count()).toBe(1);
  });
});
