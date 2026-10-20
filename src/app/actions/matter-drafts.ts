"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { deleteFile } from "@/lib/file-storage";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";
import {
  DRAFT_PERMISSION,
  assertDraftAccess,
  canAccessDraft,
} from "@/lib/draft-access";

export type DraftValues = Record<string, string | string[]>;

export type SaveDraftResult =
  | { ok: true; draftId: string; updatedAt: string }
  | { ok: false; code: "stale" | "notfound" | "invalid" };

const MAX_DRAFT_VALUES_CHARS = 200_000;

/** Server actions take arbitrary client JSON: only string / string[]
 *  values, capped in total size, are stored. */
function valuesAreValid(values: unknown): values is DraftValues {
  if (!values || typeof values !== "object" || Array.isArray(values)) return false;
  for (const v of Object.values(values)) {
    if (typeof v === "string") continue;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) continue;
    return false;
  }
  return JSON.stringify(values).length <= MAX_DRAFT_VALUES_CHARS;
}

/** Pull the user ids out of the posted `extraTeam` JSON (an array of
 *  `{ userId, role }`). Malformed input yields no seats: auto-save must
 *  never fail on half-typed data. */
function teamUserIdsOf(values: DraftValues): string[] {
  const raw = values.extraTeam;
  if (typeof raw !== "string" || !raw) return [];
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!Array.isArray(decoded)) return [];
    const ids = decoded
      .map((s) => (s && typeof s === "object" ? (s as { userId?: unknown }).userId : null))
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return [...new Set(ids)].slice(0, 20);
  } catch {
    return [];
  }
}

function leadUserIdOf(values: DraftValues): string | null {
  const v = values.leadUserId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Auto-saved from the /matters/new form. Cheap by design: one write,
 *  no logging after creation. With an id it never creates. */
export async function saveMatterDraft(
  draftId: string | null,
  expectedUpdatedAt: string | null,
  values: DraftValues
): Promise<SaveDraftResult> {
  const userId = await requirePermission(DRAFT_PERMISSION);
  if (!valuesAreValid(values)) return { ok: false, code: "invalid" };
  const leadUserId = leadUserIdOf(values);
  const teamUserIds = teamUserIdsOf(values);

  if (draftId === null) {
    const created = await prisma.matterDraft.create({
      data: { createdById: userId, values, leadUserId, teamUserIds },
      select: { id: true, updatedAt: true },
    });
    await logActivity({
      matterId: null,
      userId,
      type: "filing",
      title: "Matter draft started",
    });
    revalidatePath("/matters/new");
    return {
      ok: true,
      draftId: created.id,
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  if (!(await canAccessDraft(userId, draftId))) {
    return { ok: false, code: "notfound" };
  }
  const expected = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null;
  if (!expected || Number.isNaN(expected.getTime())) {
    return { ok: false, code: "stale" };
  }
  const now = new Date();
  const res = await prisma.matterDraft.updateMany({
    where: { id: draftId, updatedAt: expected },
    data: { values, leadUserId, teamUserIds, updatedAt: now },
  });
  if (res.count === 0) {
    const still = await prisma.matterDraft.count({ where: { id: draftId } });
    return { ok: false, code: still === 0 ? "notfound" : "stale" };
  }
  return { ok: true, draftId, updatedAt: now.toISOString() };
}

/** Best-effort byte removal once the rows are committed away. */
async function deleteStoredFiles(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await deleteFile(key);
    } catch (err) {
      console.error("[matter-drafts] storage cleanup failed", {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function deleteMatterDraft(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requirePermission(DRAFT_PERMISSION);
  const draft = await assertDraftAccess(id);
  if (draft.createdById !== userId) {
    const admin = await prisma.user.count({
      where: {
        id: userId,
        isActive: true,
        userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } },
      },
    });
    if (admin === 0) {
      return {
        ok: false,
        error: "Only the person who started this draft can delete it.",
      };
    }
  }
  const files = await prisma.$transaction(async (tx) => {
    const rows = await tx.matterDraftFile.findMany({
      where: { draftId: id },
      select: { fileUrl: true },
    });
    await tx.matterDraft.deleteMany({ where: { id } });
    return rows;
  });
  await deleteStoredFiles(files.map((f) => f.fileUrl));
  await logActivity({
    matterId: null,
    userId,
    type: "filing",
    title: "Matter draft deleted",
  });
  revalidatePath("/matters/new");
  return { ok: true };
}

export async function setDraftFileOriginating(
  fileId: string
): Promise<{ ok: boolean }> {
  await requirePermission(DRAFT_PERMISSION);
  const file = await prisma.matterDraftFile.findUnique({
    where: { id: fileId },
    select: { draftId: true },
  });
  if (!file) return { ok: false };
  await assertDraftAccess(file.draftId);
  await prisma.$transaction([
    prisma.matterDraftFile.updateMany({
      where: { draftId: file.draftId, id: { not: fileId } },
      data: { isOriginating: false },
    }),
    prisma.matterDraftFile.update({
      where: { id: fileId },
      data: { isOriginating: true },
    }),
  ]);
  revalidatePath("/matters/new");
  return { ok: true };
}

export async function removeDraftFile(
  fileId: string
): Promise<{ ok: boolean }> {
  const userId = await requirePermission(DRAFT_PERMISSION);
  const file = await prisma.matterDraftFile.findUnique({
    where: { id: fileId },
    select: { draftId: true, fileUrl: true },
  });
  if (!file) return { ok: false };
  await assertDraftAccess(file.draftId);
  // Lock the parent draft (as createMatter does) so a Create that is
  // re-homing this blob can't have it deleted underneath the new
  // Document: if Create won, the row is gone and no bytes are touched.
  const removed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "matter_drafts" WHERE id = ${file.draftId} FOR UPDATE`;
    const res = await tx.matterDraftFile.deleteMany({
      where: { id: fileId, draftId: file.draftId },
    });
    return res.count > 0;
  });
  if (!removed) return { ok: false };
  await deleteStoredFiles([file.fileUrl]);
  await logActivity({
    matterId: null,
    userId,
    type: "filing",
    title: "File removed from a matter draft",
  });
  revalidatePath("/matters/new");
  return { ok: true };
}
