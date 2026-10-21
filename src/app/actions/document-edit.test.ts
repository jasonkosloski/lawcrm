/**
 * Integration tests for `updateDocumentMetadata` and the
 * `documents_edit_permission` grant migration.
 *
 * Real Postgres, real permission-check and matter wall; only auth and
 * Next plumbing are stubbed. Pins: the `documents.edit` gate, the
 * ethical-wall 404 (permission alone is not enough), validation,
 * no-op on unchanged input, the activity row, and the success write.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { updateDocumentMetadata } from "@/app/actions/documents";
import {
  resetDb,
  seedDocument,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedUser = vi.mocked(getCurrentUserId);

let firmId: string;
let editor: string;
let noKey: string;
let outsider: string;
let matterId: string;
let documentId: string;
let editRoleId: string;

beforeEach(async () => {
  await resetDb();
  vi.mocked(revalidatePath).mockClear();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({
    where: { id: firmId },
    data: { matterVisibility: "TEAM" },
  });
  const editRole = await prisma.role.create({
    data: { firmId, name: "Editor", isSystem: false },
    select: { id: true },
  });
  editRoleId = editRole.id;
  await prisma.rolePermission.create({
    data: { roleId: editRole.id, permission: "documents.edit" },
  });
  const plainRole = await prisma.role.create({
    data: { firmId, name: "Plain", isSystem: false },
    select: { id: true },
  });
  ({ userId: editor } = await seedUser({ firmId, roleIds: [editRole.id] }));
  ({ userId: outsider } = await seedUser({ firmId, roleIds: [editRole.id] }));
  ({ userId: noKey } = await seedUser({ firmId, roleIds: [plainRole.id] }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: editor,
  }));
  ({ documentId } = await seedDocument({
    matterId,
    name: "Complaint.pdf",
    uploadedBy: editor,
  }));
  // The editor is on the team (lead attorney); noKey is too, so that
  // test isolates the permission gate rather than the wall.
  await prisma.matterTeamMember.upsert({
    where: { matterId_userId: { matterId, userId: noKey } },
    create: { matterId, userId: noKey, role: "co_counsel" },
    update: {},
  });
  mockedUser.mockResolvedValue(editor);
});

const docRow = () =>
  prisma.document.findUniqueOrThrow({ where: { id: documentId } });
const logs = () => prisma.activityLog.findMany({ where: { type: "document" } });

describe("updateDocumentMetadata", () => {
  test("without documents.edit it redirects and changes nothing", async () => {
    mockedUser.mockResolvedValue(noKey);
    await expect(
      updateDocumentMetadata(documentId, { name: "New.pdf", category: "filing" })
    ).rejects.toThrow("NEXT_REDIRECT");
    expect((await docRow()).name).toBe("Complaint.pdf");
    expect(await logs()).toHaveLength(0);
  });

  test("a user outside the matter team is walled off (404) despite the key", async () => {
    mockedUser.mockResolvedValue(outsider);
    await expect(
      updateDocumentMetadata(documentId, { name: "New.pdf", category: "filing" })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await docRow()).name).toBe("Complaint.pdf");
    expect(await logs()).toHaveLength(0);
  });

  test("a restricted intake lead is walled off too", async () => {
    const { leadId } = await seedLead({ restricted: true, teamUserIds: [editor] });
    const leadDoc = await prisma.document.create({
      data: { leadId, name: "Intake.pdf", category: "intake" },
      select: { id: true },
    });
    mockedUser.mockResolvedValue(outsider);
    await expect(
      updateDocumentMetadata(leadDoc.id, { name: "X.pdf", category: "other" })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: leadDoc.id } })).name
    ).toBe("Intake.pdf");
  });

  test("rejects an empty or over-long name", async () => {
    expect(
      await updateDocumentMetadata(documentId, { name: "   ", category: "filing" })
    ).toEqual({ ok: false, error: "Name can't be empty." });
    const long = await updateDocumentMetadata(documentId, {
      name: "a".repeat(256),
      category: "filing",
    });
    expect(long.ok).toBe(false);
    expect(long.error).toMatch(/255/);
    expect((await docRow()).name).toBe("Complaint.pdf");
  });

  test("rejects an unknown category", async () => {
    const res = await updateDocumentMetadata(documentId, {
      name: "Complaint.pdf",
      category: "bogus",
    });
    expect(res).toEqual({ ok: false, error: "Pick a valid category." });
    expect((await docRow()).category).toBe("other");
  });

  test("unchanged input is a no-op: no write, no activity, no revalidation", async () => {
    const before = await docRow();
    const res = await updateDocumentMetadata(documentId, {
      name: "  Complaint.pdf  ",
      category: "other",
    });
    expect(res).toEqual({ ok: true, changed: false });
    expect(await logs()).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await docRow()).updatedAt).toEqual(before.updatedAt);
  });

  test("rename logs 'Renamed document' and trims the name", async () => {
    const res = await updateDocumentMetadata(documentId, {
      name: "  Amended Complaint.pdf ",
      category: "other",
    });
    expect(res).toEqual({ ok: true, changed: true });
    expect((await docRow()).name).toBe("Amended Complaint.pdf");
    const [log] = await logs();
    expect(log.title).toBe("Renamed document");
    expect(log.detail).toBe("Complaint.pdf → Amended Complaint.pdf");
    expect(log.matterId).toBe(matterId);
    expect(log.userId).toBe(editor);
    expect(revalidatePath).toHaveBeenCalled();
  });

  test("category change logs 'Changed document category'", async () => {
    const res = await updateDocumentMetadata(documentId, {
      name: "Complaint.pdf",
      category: "pleading",
    });
    expect(res.ok).toBe(true);
    expect((await docRow()).category).toBe("pleading");
    const [log] = await logs();
    expect(log.title).toBe("Changed document category");
    expect(log.detail).toBe("Complaint.pdf: Other → Pleading");
  });

  test("both at once logs one 'Edited document details' entry", async () => {
    await updateDocumentMetadata(documentId, {
      name: "Complaint v2.pdf",
      category: "filing",
    });
    const entries = await logs();
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Edited document details");
    const d = await docRow();
    expect([d.name, d.category]).toEqual(["Complaint v2.pdf", "filing"]);
  });

  test("an unknown document id is 'not found'", async () => {
    const res = await updateDocumentMetadata("nope", {
      name: "X",
      category: "other",
    });
    expect(res).toEqual({ ok: false, error: "Document not found." });
  });
});

describe("documents_edit_permission migration", () => {
  test("grants documents.edit to roles holding documents.upload, idempotently", async () => {
    const uploader = await prisma.role.create({
      data: { firmId, name: "Uploader", isSystem: false },
      select: { id: true },
    });
    const other = await prisma.role.create({
      data: { firmId, name: "Other", isSystem: false },
      select: { id: true },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: uploader.id, permission: "documents.upload" },
        { roleId: other.id, permission: "tasks.create" },
      ],
    });
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20261021120000_documents_edit_permission/migration.sql"
      ),
      "utf8"
    );
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql); // second run: no duplicate, no error
    const granted = async (roleId: string) =>
      prisma.rolePermission.count({
        where: { roleId, permission: "documents.edit" },
      });
    expect(await granted(uploader.id)).toBe(1);
    expect(await granted(other.id)).toBe(0);
    expect(await granted(editRoleId)).toBe(1); // untouched pre-existing grant
  });
});
