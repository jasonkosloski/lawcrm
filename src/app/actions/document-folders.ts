/**
 * Document-folder server actions — the write path for the per-matter
 * document file system (folder tree on the matter Documents tab).
 *
 * Invariants enforced here (the schema deliberately doesn't):
 *
 *   - Sibling-name uniqueness is CASE-INSENSITIVE and app-enforced —
 *     Postgres treats NULL parentIds as distinct, so a DB unique on
 *     (matterId, parentId, name) wouldn't cover root folders.
 *   - Nesting is capped at MAX_FOLDER_DEPTH (8) levels; moves check
 *     destination depth + moving-subtree height, not just the folder.
 *   - Deleting a folder NEVER deletes files. Its child folders and
 *     documents re-parent to the deleted folder's parent (matter root
 *     when the folder was top-level) in the same transaction as the
 *     delete — this must run before the row delete because the
 *     self-relation cascades. A re-parented child folder whose name
 *     collides with a destination sibling is renamed with a
 *     " (2)"-style suffix ("Exhibits" → "Exhibits (2)", then "(3)"…);
 *     documents are never renamed (no uniqueness constraint on them).
 *   - Moves (documents and folders) stay inside ONE matter — a target
 *     folder from another matter is refused, and a folder can't move
 *     under itself or its own descendant.
 *
 * Permissions: folder.create / folder.edit / folder.delete gate the
 * tree structure; `documents.organize` gates re-filing (moveDocuments
 * + moveFolder) — organizing is often delegated to staff who
 * shouldn't be able to remove records.
 *
 * Activity log: exactly ONE summary row per operation (a 200-file
 * re-file must not flood the feed).
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import {
  MAX_FOLDER_DEPTH,
  MOVE_DOCUMENTS_BATCH_CAP,
  collectDescendantIds,
  folderDepth,
  nextAvailableFolderName,
  subtreeHeight,
  type FolderRecord,
} from "@/lib/folder-tree";

export type FolderActionResult =
  | { ok: true; folderId?: string }
  | { ok: false; error: string };

const MAX_FOLDER_NAME_LENGTH = 120;

/** Trimmed 1..120-char name, or an error string. */
function validateName(raw: string): { name: string } | { error: string } {
  const name = raw.trim();
  if (name.length === 0) return { error: "Folder name can't be empty." };
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    return {
      error: `Folder name is too long (max ${MAX_FOLDER_NAME_LENGTH} characters).`,
    };
  }
  return { name };
}

/** All folders of a matter in one query — the depth / cycle /
 *  uniqueness math happens in JS over this list. */
function fetchMatterFolders(matterId: string): Promise<FolderRecord[]> {
  return prisma.documentFolder.findMany({
    where: { matterId },
    select: { id: true, parentId: true, name: true, order: true },
  });
}

const siblingsOf = (
  folders: FolderRecord[],
  parentId: string | null
): FolderRecord[] => folders.filter((f) => f.parentId === parentId);

const hasNameCollision = (
  siblings: FolderRecord[],
  name: string,
  excludeId?: string
): boolean =>
  siblings.some(
    (s) => s.id !== excludeId && s.name.toLowerCase() === name.toLowerCase()
  );

const nextOrder = (siblings: FolderRecord[]): number =>
  siblings.reduce((max, s) => Math.max(max, s.order + 1), 0);

// ── createFolder ─────────────────────────────────────────────────────────

export async function createFolder(
  matterId: string,
  parentId: string | null,
  name: string
): Promise<FolderActionResult> {
  const userId = await requirePermission("documents.folder.create");

  const valid = validateName(name);
  if ("error" in valid) return { ok: false, error: valid.error };

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) return { ok: false, error: "Matter not found." };

  const folders = await fetchMatterFolders(matterId);

  if (parentId) {
    // Scoped membership check — a parent from another matter must not
    // graft this matter's tree onto it.
    if (!folders.some((f) => f.id === parentId)) {
      return { ok: false, error: "Parent folder not found in this matter." };
    }
    if (folderDepth(folders, parentId) >= MAX_FOLDER_DEPTH) {
      return {
        ok: false,
        error: `Folders can only nest ${MAX_FOLDER_DEPTH} levels deep.`,
      };
    }
  }

  const siblings = siblingsOf(folders, parentId);
  if (hasNameCollision(siblings, valid.name)) {
    return {
      ok: false,
      error: `A folder named "${valid.name}" already exists here.`,
    };
  }

  const created = await prisma.documentFolder.create({
    data: {
      matterId,
      parentId,
      name: valid.name,
      order: nextOrder(siblings),
      createdById: userId,
    },
    select: { id: true },
  });

  await logActivity({
    matterId,
    userId,
    type: "document",
    title: "Folder created",
    detail: valid.name,
  });

  revalidatePath(`/matters/${matterId}/documents`);
  return { ok: true, folderId: created.id };
}

// ── renameFolder ─────────────────────────────────────────────────────────

export async function renameFolder(
  id: string,
  name: string
): Promise<FolderActionResult> {
  const userId = await requirePermission("documents.folder.edit");

  const valid = validateName(name);
  if ("error" in valid) return { ok: false, error: valid.error };

  const folder = await prisma.documentFolder.findUnique({
    where: { id },
    select: { id: true, matterId: true, parentId: true, name: true },
  });
  if (!folder) return { ok: false, error: "Folder not found." };
  if (folder.name === valid.name) return { ok: true, folderId: folder.id };

  const folders = await fetchMatterFolders(folder.matterId);
  // Excluding self allows a case-only rename ("exhibits" → "Exhibits").
  if (
    hasNameCollision(siblingsOf(folders, folder.parentId), valid.name, folder.id)
  ) {
    return {
      ok: false,
      error: `A folder named "${valid.name}" already exists here.`,
    };
  }

  await prisma.documentFolder.update({
    where: { id: folder.id },
    data: { name: valid.name },
  });

  await logActivity({
    matterId: folder.matterId,
    userId,
    type: "document",
    title: "Folder renamed",
    detail: `${folder.name} → ${valid.name}`,
  });

  revalidatePath(`/matters/${folder.matterId}/documents`);
  return { ok: true, folderId: folder.id };
}

// ── deleteFolder ─────────────────────────────────────────────────────────

/**
 * Delete a folder, RE-PARENTING its contents (child folders and
 * documents) to the folder's parent — matter root when the folder was
 * top-level. Files are never deleted with the folder. Child folders
 * whose names collide at the destination pick up a " (2)"-style
 * suffix. One transaction: re-parents must land before the row delete
 * (the FolderTree self-relation cascades) and a mid-op failure must
 * leave the tree untouched.
 */
export async function deleteFolder(id: string): Promise<FolderActionResult> {
  const userId = await requirePermission("documents.folder.delete");

  const folder = await prisma.documentFolder.findUnique({
    where: { id },
    select: { id: true, matterId: true, parentId: true, name: true },
  });
  if (!folder) return { ok: false, error: "Folder not found." };

  const folders = await fetchMatterFolders(folder.matterId);
  const children = siblingsOf(folders, folder.id);
  // Names occupied at the destination once this folder is gone — its
  // own name frees up, so exclude it alongside the moving children.
  const taken = new Set(
    siblingsOf(folders, folder.parentId)
      .filter((s) => s.id !== folder.id)
      .map((s) => s.name.toLowerCase())
  );

  const parentName = folder.parentId
    ? folders.find((f) => f.id === folder.parentId)?.name ?? null
    : null;

  let order = nextOrder(siblingsOf(folders, folder.parentId));
  const childUpdates = children.map((child) => {
    const newName = nextAvailableFolderName(child.name, taken);
    taken.add(newName.toLowerCase());
    return prisma.documentFolder.update({
      where: { id: child.id },
      data: { parentId: folder.parentId, name: newName, order: order++ },
    });
  });

  const results = await prisma.$transaction([
    ...childUpdates,
    prisma.document.updateMany({
      where: { folderId: folder.id },
      data: { folderId: folder.parentId },
    }),
    prisma.documentFolder.delete({ where: { id: folder.id } }),
  ]);
  // The updateMany BatchPayload sits right after the child updates.
  const docsMoved = (results[childUpdates.length] as { count: number }).count;

  await logActivity({
    matterId: folder.matterId,
    userId,
    type: "document",
    title: "Folder deleted",
    detail: `"${folder.name}" — ${children.length} subfolder(s) and ${docsMoved} document(s) moved to ${parentName ? `"${parentName}"` : "the matter root"}`,
  });

  revalidatePath(`/matters/${folder.matterId}/documents`);
  return { ok: true };
}

// ── moveDocuments ────────────────────────────────────────────────────────

/**
 * Re-file documents into a folder (or the matter root when
 * `folderId` is null). Every document AND the target folder must
 * belong to one matter; the batch caps at MOVE_DOCUMENTS_BATCH_CAP.
 */
export async function moveDocuments(
  documentIds: string[],
  folderId: string | null
): Promise<FolderActionResult> {
  const userId = await requirePermission("documents.organize");

  const ids = [...new Set(documentIds)];
  if (ids.length === 0) {
    return { ok: false, error: "No documents selected." };
  }
  if (ids.length > MOVE_DOCUMENTS_BATCH_CAP) {
    return {
      ok: false,
      error: `Too many documents (max ${MOVE_DOCUMENTS_BATCH_CAP} per move).`,
    };
  }

  const docs = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: { id: true, matterId: true },
  });
  if (docs.length !== ids.length) {
    return { ok: false, error: "Some documents were not found." };
  }
  const matterIds = new Set(docs.map((d) => d.matterId));
  if (matterIds.size > 1) {
    return { ok: false, error: "Documents must all belong to one matter." };
  }
  const matterId = docs[0]!.matterId;

  let folderName: string | null = null;
  if (folderId) {
    // Scoped find — a folder from another matter must not receive
    // this matter's documents.
    const folder = await prisma.documentFolder.findFirst({
      where: { id: folderId, matterId },
      select: { id: true, name: true },
    });
    if (!folder) {
      return { ok: false, error: "Folder not found in this matter." };
    }
    folderName = folder.name;
  }

  await prisma.document.updateMany({
    where: { id: { in: ids } },
    data: { folderId },
  });

  await logActivity({
    matterId,
    userId,
    type: "document",
    title: ids.length === 1 ? "Document moved" : `${ids.length} documents moved`,
    detail: `→ ${folderName ? `"${folderName}"` : "the matter root"}`,
  });

  revalidatePath(`/matters/${matterId}/documents`);
  return { ok: true };
}

// ── moveFolder ───────────────────────────────────────────────────────────

/**
 * Move a folder (with its whole subtree) under a new parent — or to
 * the matter root when `newParentId` is null. Refuses cycles (a
 * folder can't move under itself or a descendant), cross-matter
 * targets, destination name collisions, and moves that would push the
 * subtree past MAX_FOLDER_DEPTH.
 */
export async function moveFolder(
  id: string,
  newParentId: string | null
): Promise<FolderActionResult> {
  const userId = await requirePermission("documents.organize");

  const folder = await prisma.documentFolder.findUnique({
    where: { id },
    select: { id: true, matterId: true, parentId: true, name: true },
  });
  if (!folder) return { ok: false, error: "Folder not found." };
  if (newParentId === folder.id) {
    return { ok: false, error: "A folder can't be moved into itself." };
  }
  if (newParentId === folder.parentId) return { ok: true, folderId: folder.id };

  const folders = await fetchMatterFolders(folder.matterId);

  let destName: string | null = null;
  if (newParentId) {
    const dest = folders.find((f) => f.id === newParentId);
    if (!dest) {
      return { ok: false, error: "Destination folder not found in this matter." };
    }
    destName = dest.name;
    if (collectDescendantIds(folders, folder.id).has(newParentId)) {
      return {
        ok: false,
        error: "A folder can't be moved into one of its own subfolders.",
      };
    }
  }

  const destDepth = newParentId ? folderDepth(folders, newParentId) : 0;
  if (destDepth + subtreeHeight(folders, folder.id) > MAX_FOLDER_DEPTH) {
    return {
      ok: false,
      error: `That move would nest folders more than ${MAX_FOLDER_DEPTH} levels deep.`,
    };
  }

  const siblings = siblingsOf(folders, newParentId);
  if (hasNameCollision(siblings, folder.name, folder.id)) {
    return {
      ok: false,
      error: `A folder named "${folder.name}" already exists there.`,
    };
  }

  await prisma.documentFolder.update({
    where: { id: folder.id },
    data: { parentId: newParentId, order: nextOrder(siblings) },
  });

  await logActivity({
    matterId: folder.matterId,
    userId,
    type: "document",
    title: "Folder moved",
    detail: `"${folder.name}" → ${destName ? `"${destName}"` : "the matter root"}`,
  });

  revalidatePath(`/matters/${folder.matterId}/documents`);
  return { ok: true, folderId: folder.id };
}
