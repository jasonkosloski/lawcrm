import { MAX_FOLDER_DEPTH } from "@/lib/folder-tree";

/**
 * Pure portal document-visibility rules. No prisma / server-only imports so
 * client components (the staff share UI) can use them. The DB-backed half is
 * in document-visibility.server.ts.
 */

type FolderNode = {
  id: string;
  parentId: string | null;
  clientShared: boolean;
};

type NamedFolderNode = FolderNode & { name: string };

type DocShare = { clientShare: string | null; folderId: string | null };

/** Ids of folders that are shared: the folder or any ancestor is clientShared. */
export function sharedFolderIds(folders: FolderNode[]): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = new Set<string>();
  for (const f of folders) {
    const seen = new Set<string>();
    let cur: FolderNode | undefined = f;
    // Bounded walk (+1 for the root level) with a visited set against cycles.
    for (let i = 0; cur && i <= MAX_FOLDER_DEPTH && !seen.has(cur.id); i++) {
      if (cur.clientShared) {
        out.add(f.id);
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return out;
}

/** "hidden" always loses; "shared" always wins; null follows the folder. */
export function isEffectivelyShared(doc: DocShare, shared: Set<string>): boolean {
  if (doc.clientShare === "hidden") return false;
  if (doc.clientShare === "shared") return true;
  return doc.folderId !== null && shared.has(doc.folderId);
}

/** Why a document is visible to the client (staff tooltip), or null. */
export function shareReason(
  doc: DocShare,
  folders: NamedFolderNode[],
): { kind: "file" } | { kind: "folder"; folderName: string } | null {
  if (doc.clientShare === "hidden") return null;
  if (doc.clientShare === "shared") return { kind: "file" };
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let cur = doc.folderId ? byId.get(doc.folderId) : undefined;
  for (let i = 0; cur && i <= MAX_FOLDER_DEPTH && !seen.has(cur.id); i++) {
    if (cur.clientShared) return { kind: "folder", folderName: cur.name };
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}
