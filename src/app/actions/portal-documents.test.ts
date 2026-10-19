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
  seedDocument,
  seedDocumentFolder,
  seedFirm,
  seedLead,
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
  setDocumentsClientShare,
  previewFolderMoveVisibility,
  setFolderClientShared,
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

describe("share actions", () => {
  const SHARED_SUBJECT = "Your legal team shared documents with you";
  const share = (id: string) =>
    prisma.document.findUniqueOrThrow({ where: { id }, select: { clientShare: true } });

  test("denies without portal.share_documents", async () => {
    sessionUser = await userWith([]);
    const { documentId } = await seedDocument({ matterId });
    const { folderId } = await seedDocumentFolder({ matterId, name: "F" });
    expect(await setDocumentsClientShare([documentId], true)).toMatchObject({ ok: false });
    expect(await setFolderClientShared(folderId, true)).toMatchObject({ ok: false });
    expect((await share(documentId)).clientShare).toBeNull();
  });

  test("a walled user gets not-found", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith(["portal.share_documents"]);
    const { documentId } = await seedDocument({ matterId });
    const { folderId } = await seedDocumentFolder({ matterId, name: "F" });
    const notFound = { digest: expect.stringContaining("404") };
    await expect(setDocumentsClientShare([documentId], true)).rejects.toMatchObject(notFound);
    await expect(setFolderClientShared(folderId, true)).rejects.toMatchObject(notFound);
  });

  test("bulk share of 50 docs sends one email per identity and one activity row", async () => {
    await seedIdentity("a@example.com");
    await seedIdentity("b@example.com");
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await seedDocument({ matterId, name: `d${i}` })).documentId);
    const before = await activityCount();
    expect(await setDocumentsClientShare(ids, true)).toEqual({ ok: true });
    expect(await prisma.document.count({ where: { clientShare: "shared" } })).toBe(50);
    expect(cap.sent.map((m) => m.to).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(cap.sent[0].subject).toBe(SHARED_SUBJECT);
    expect((await activityCount()) - before).toBe(1);
  });

  test("sharing already-visible docs sends no email", async () => {
    await seedIdentity("a@example.com");
    const { documentId } = await seedDocument({ matterId });
    await setDocumentsClientShare([documentId], true);
    cap.sent.length = 0;
    expect(await setDocumentsClientShare([documentId], true)).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(0);
  });

  test("unshare inside a shared folder writes hidden", async () => {
    const { folderId } = await seedDocumentFolder({ matterId, name: "Shared" });
    await prisma.documentFolder.update({ where: { id: folderId }, data: { clientShared: true } });
    const { folderId: childId } = await seedDocumentFolder({ matterId, name: "Kid", parentId: folderId });
    const { documentId } = await seedDocument({ matterId, folderId: childId });
    await setDocumentsClientShare([documentId], true);
    expect(await setDocumentsClientShare([documentId], false)).toEqual({ ok: true });
    expect((await share(documentId)).clientShare).toBe("hidden");
    // Re-sharing writes "shared".
    await setDocumentsClientShare([documentId], true);
    expect((await share(documentId)).clientShare).toBe("shared");
  });

  test("unshare outside a shared folder writes null", async () => {
    const { documentId } = await seedDocument({ matterId });
    await setDocumentsClientShare([documentId], true);
    expect(await setDocumentsClientShare([documentId], false)).toEqual({ ok: true });
    expect((await share(documentId)).clientShare).toBeNull();
  });

  test("a hidden doc in a shared folder shared again becomes visible and emails", async () => {
    await seedIdentity("a@example.com");
    const { folderId } = await seedDocumentFolder({ matterId, name: "Shared" });
    await prisma.documentFolder.update({ where: { id: folderId }, data: { clientShared: true } });
    const { documentId } = await seedDocument({ matterId, folderId });
    await prisma.document.update({ where: { id: documentId }, data: { clientShare: "hidden" } });
    await setDocumentsClientShare([documentId], true);
    expect(cap.sent).toHaveLength(1);
  });

  test("refuses lead documents", async () => {
    const { leadId } = await seedLead();
    const doc = await prisma.document.create({
      data: { leadId, name: "L.pdf", category: "other", source: "upload" },
      select: { id: true },
    });
    expect(await setDocumentsClientShare([doc.id], true)).toEqual({
      ok: false,
      error: "Lead documents can't be shared with clients.",
    });
    expect((await share(doc.id)).clientShare).toBeNull();
  });

  test("refuses lead folders", async () => {
    const { leadId } = await seedLead();
    const f = await prisma.documentFolder.create({ data: { leadId, name: "LF" }, select: { id: true } });
    expect(await setFolderClientShared(f.id, true)).toEqual({
      ok: false,
      error: "Lead documents can't be shared with clients.",
    });
  });

  test("refuses a mixed-matter batch and an over-cap batch", async () => {
    const other = (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: admin, name: "Other" })).matterId;
    const a = (await seedDocument({ matterId })).documentId;
    const b = (await seedDocument({ matterId: other })).documentId;
    const mixed = await setDocumentsClientShare([a, b], true);
    expect(mixed).toMatchObject({ ok: false });
    expect((await share(a)).clientShare).toBeNull();
    expect(await setDocumentsClientShare([], true)).toMatchObject({ ok: false });
    const many = Array.from({ length: 201 }, (_, i) => `x${i}`);
    expect(await setDocumentsClientShare(many, true)).toMatchObject({ ok: false });
  });

  // ADR-039: a walled user must not be able to tell a walled record from
  // a missing one, so every case below is the same not-found.
  test("a walled user gets the same not-found for missing, walled, lead+walled and mixed ids", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith(["portal.share_documents"]);
    const mine = (
      await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: sessionUser, name: "Mine" })
    ).matterId;
    const visible = (await seedDocument({ matterId: mine })).documentId;
    const walled = (await seedDocument({ matterId })).documentId;
    const otherWalled = (
      await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: admin, name: "Other walled" })
    ).matterId;
    const walled2 = (await seedDocument({ matterId: otherWalled })).documentId;
    const { leadId } = await seedLead();
    const leadDoc = (
      await prisma.document.create({
        data: { leadId, name: "L.pdf", category: "other", source: "upload" },
        select: { id: true },
      })
    ).id;
    const notFound = { digest: expect.stringContaining("404") };
    for (const ids of [
      ["missing"],
      [walled],
      [leadDoc, walled],
      [visible, walled],
      [walled, walled2],
      [visible, "missing"],
    ]) {
      await expect(setDocumentsClientShare(ids, true)).rejects.toMatchObject(notFound);
    }
    expect((await share(walled)).clientShare).toBeNull();
    expect((await share(visible)).clientShare).toBeNull();
    // Lead documents are not walled (intake is not matter-ACL'd), so a
    // plain lead batch still gets its own refusal.
    expect(await setDocumentsClientShare([leadDoc], true)).toEqual({
      ok: false,
      error: "Lead documents can't be shared with clients.",
    });
  });

  test("folder share: missing and walled folders are the same not-found", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith(["portal.share_documents"]);
    const { folderId } = await seedDocumentFolder({ matterId, name: "Walled" });
    const notFound = { digest: expect.stringContaining("404") };
    await expect(setFolderClientShared("missing", true)).rejects.toMatchObject(notFound);
    await expect(setFolderClientShared(folderId, true)).rejects.toMatchObject(notFound);
  });

  test("folder share emails once; unshare does not", async () => {
    await seedIdentity("a@example.com");
    const { folderId } = await seedDocumentFolder({ matterId, name: "F" });
    await seedDocument({ matterId, folderId });
    await seedDocument({ matterId, folderId });
    const before = await activityCount();
    expect(await setFolderClientShared(folderId, true)).toEqual({ ok: true });
    expect((await prisma.documentFolder.findUniqueOrThrow({ where: { id: folderId } })).clientShared).toBe(true);
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0].subject).toBe(SHARED_SUBJECT);
    expect((await activityCount()) - before).toBe(1);
    cap.sent.length = 0;
    expect(await setFolderClientShared(folderId, false)).toEqual({ ok: true });
    expect((await prisma.documentFolder.findUniqueOrThrow({ where: { id: folderId } })).clientShared).toBe(false);
    expect(cap.sent).toHaveLength(0);
  });

  test("sharing only archived files sends no email", async () => {
    await seedIdentity("a@example.com");
    const { documentId } = await seedDocument({ matterId });
    await prisma.document.update({ where: { id: documentId }, data: { status: "archived" } });
    expect(await setDocumentsClientShare([documentId], true)).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(0);
    const { folderId } = await seedDocumentFolder({ matterId, name: "Old" });
    const inFolder = (await seedDocument({ matterId, folderId })).documentId;
    await prisma.document.update({ where: { id: inFolder }, data: { status: "archived" } });
    expect(await setFolderClientShared(folderId, true)).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(0);
  });

  test("sharing an empty folder sends no email", async () => {
    await seedIdentity("a@example.com");
    const { folderId } = await seedDocumentFolder({ matterId, name: "Empty" });
    await setFolderClientShared(folderId, true);
    expect(cap.sent).toHaveLength(0);
  });
});

describe("previewFolderMoveVisibility", () => {
  const ZERO = { becomesVisible: 0, becomesHidden: 0 };
  const mk = async (name: string, parentId: string | null = null, shared = false) => {
    const { folderId } = await seedDocumentFolder({ matterId, name, parentId });
    if (shared) await prisma.documentFolder.update({ where: { id: folderId }, data: { clientShared: true } });
    return folderId;
  };

  test("moving into a shared folder makes its files visible, including nested ones", async () => {
    const shared = await mk("Shared", null, true);
    const moving = await mk("Moving");
    const inner = await mk("Inner", moving);
    await seedDocument({ matterId, folderId: moving });
    await seedDocument({ matterId, folderId: inner });
    expect(await previewFolderMoveVisibility(moving, shared)).toEqual({ becomesVisible: 2, becomesHidden: 0 });
  });

  test("moving out of a shared folder hides its files", async () => {
    const shared = await mk("Shared", null, true);
    const moving = await mk("Moving", shared);
    await seedDocument({ matterId, folderId: moving });
    expect(await previewFolderMoveVisibility(moving, null)).toEqual({ becomesVisible: 0, becomesHidden: 1 });
  });

  test("a folder that is itself shared stays visible wherever it goes", async () => {
    const other = await mk("Other", null, true);
    const moving = await mk("Moving", null, true);
    await seedDocument({ matterId, folderId: moving });
    expect(await previewFolderMoveVisibility(moving, other)).toEqual(ZERO);
    expect(await previewFolderMoveVisibility(moving, null)).toEqual(ZERO);
  });

  test("a hidden file inside stays hidden and a shared file stays shared", async () => {
    const shared = await mk("Shared", null, true);
    const moving = await mk("Moving");
    const hidden = (await seedDocument({ matterId, folderId: moving })).documentId;
    const pinned = (await seedDocument({ matterId, folderId: moving })).documentId;
    await prisma.document.update({ where: { id: hidden }, data: { clientShare: "hidden" } });
    await prisma.document.update({ where: { id: pinned }, data: { clientShare: "shared" } });
    expect(await previewFolderMoveVisibility(moving, shared)).toEqual(ZERO);
  });

  test("archived files inside are not counted", async () => {
    const shared = await mk("Shared", null, true);
    const moving = await mk("Moving");
    const archived = (await seedDocument({ matterId, folderId: moving })).documentId;
    await prisma.document.update({ where: { id: archived }, data: { status: "archived" } });
    await seedDocument({ matterId, folderId: moving });
    expect(await previewFolderMoveVisibility(moving, shared)).toEqual({ becomesVisible: 1, becomesHidden: 0 });
  });

  test("zeros without portal.share_documents", async () => {
    const shared = await mk("Shared", null, true);
    const moving = await mk("Moving");
    await seedDocument({ matterId, folderId: moving });
    sessionUser = await userWith([]);
    expect(await previewFolderMoveVisibility(moving, shared)).toEqual(ZERO);
  });

  test("a walled user gets not-found", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    const moving = await mk("Moving");
    sessionUser = await userWith(["portal.share_documents"]);
    await expect(previewFolderMoveVisibility(moving, null)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  test("a missing folder is the same not-found as a walled one", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: "TEAM" } });
    sessionUser = await userWith(["portal.share_documents"]);
    await expect(previewFolderMoveVisibility("missing", null)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  test("a move into its own subtree is zeros", async () => {
    const moving = await mk("Moving");
    const inner = await mk("Inner", moving);
    expect(await previewFolderMoveVisibility(moving, inner)).toEqual(ZERO);
  });
});
