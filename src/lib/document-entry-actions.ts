/**
 * Which actions the Documents tab offers for a set of rows. One list
 * feeds the row kebab, the right-click menu, the selection bar and the
 * keyboard shortcuts, so they can't drift apart. Pure: the client maps
 * each id to a handler. Permission flags only hide items; every server
 * action re-checks.
 */

import { plural } from "@/lib/utils";

export type DocTarget = {
  kind: "doc";
  id: string;
  name: string;
  href: string;
  folderId: string | null;
  /** An email's extracted attachment: lives under the email. */
  isAttachment: boolean;
  hasFile: boolean;
  /** Uploader or documents.delete_any. */
  canDelete: boolean;
  category: string;
  status: string;
  clientShare: string | null;
  /** Effectively visible to the client right now. */
  isShared: boolean;
  /** For an email: attachments with no copy elsewhere / with one. */
  unsavedAttachments: string[];
  savedAttachments: string[];
  attachmentShares: { clientShare: string | null; folderId: string | null; status: string }[];
};

export type FolderTarget = {
  kind: "folder";
  id: string;
  name: string;
  href: string;
  parentId: string | null;
  /** Made by a records request: no rename, move, share or delete. */
  isProtected: boolean;
  /** Holds a protected folder below it: can't be deleted. */
  hasProtectedDescendant: boolean;
  clientShared: boolean;
  /** At MAX_FOLDER_DEPTH: can't take subfolders. */
  atDepthCap: boolean;
};

export type ActionTarget = DocTarget | FolderTarget;

export type WorkspacePerms = {
  organize: boolean;
  edit: boolean;
  folderCreate: boolean;
  folderEdit: boolean;
  folderDelete: boolean;
  upload: boolean;
  share: boolean;
  /** False on a converted lead: no new folders or uploads. */
  writable: boolean;
};

export type EntryActionId =
  | "open"
  | "open-new-tab"
  | "download"
  | "new-folder"
  | "upload"
  | "edit"
  | "rename"
  | "move"
  | "copy"
  | "share"
  | "unshare"
  | "select-all"
  | "delete";

export type EntryAction = {
  id: EntryActionId;
  label: string;
  /** Items in different groups get a separator between them. */
  group: number;
  destructive?: boolean;
  /** Display hint, e.g. "F2". */
  shortcut?: string;
};


export const canDeleteFolder = (f: FolderTarget, perms: WorkspacePerms) =>
  perms.folderDelete && !f.isProtected && !f.hasProtectedDescendant;

/** Actions for a right-click on empty space (the current folder). */
export function backgroundActions(
  perms: WorkspacePerms,
  opts: { atDepthCap: boolean; hasEntries: boolean }
): EntryAction[] {
  const out: EntryAction[] = [];
  if (perms.writable && perms.folderCreate && !opts.atDepthCap) {
    out.push({ id: "new-folder", label: "New folder", group: 0 });
  }
  if (perms.writable && perms.upload) out.push({ id: "upload", label: "Upload files", group: 0 });
  if (opts.hasEntries) out.push({ id: "select-all", label: "Select all", group: 1, shortcut: "⌘A" });
  return out;
}

export function entryActions(targets: ActionTarget[], perms: WorkspacePerms): EntryAction[] {
  if (targets.length === 0) return [];
  if (targets.length === 1) {
    const t = targets[0]!;
    return t.kind === "doc" ? docActions(t, perms) : folderActions(t, perms);
  }
  return multiActions(targets, perms);
}

function docActions(d: DocTarget, perms: WorkspacePerms): EntryAction[] {
  const out: EntryAction[] = [
    { id: "open", label: "Open", group: 0, shortcut: "↵" },
    { id: "open-new-tab", label: "Open in new tab", group: 0 },
  ];
  if (d.hasFile) out.push({ id: "download", label: "Download", group: 0 });
  if (perms.edit) out.push({ id: "edit", label: "Edit details…", group: 1, shortcut: "F2" });
  if (perms.organize && !d.isAttachment) out.push({ id: "move", label: "Move to…", group: 1 });
  if (perms.organize) out.push({ id: "copy", label: "Copy to…", group: 1 });
  if (perms.share) {
    out.push(
      d.isShared
        ? { id: "unshare", label: "Stop sharing", group: 2 }
        : { id: "share", label: "Share with client", group: 2 }
    );
  }
  if (d.canDelete) out.push({ id: "delete", label: "Delete", group: 3, destructive: true, shortcut: "⌫" });
  return out;
}

function folderActions(f: FolderTarget, perms: WorkspacePerms): EntryAction[] {
  const out: EntryAction[] = [
    { id: "open", label: "Open", group: 0, shortcut: "↵" },
    { id: "open-new-tab", label: "Open in new tab", group: 0 },
  ];
  if (perms.writable && perms.folderCreate && !f.atDepthCap) {
    out.push({ id: "new-folder", label: "New folder inside", group: 1 });
  }
  if (perms.writable && perms.upload) out.push({ id: "upload", label: "Upload files here", group: 1 });
  if (perms.folderEdit && !f.isProtected) out.push({ id: "rename", label: "Rename", group: 2, shortcut: "F2" });
  if (perms.organize && !f.isProtected) out.push({ id: "move", label: "Move to…", group: 2 });
  if (perms.share && !f.isProtected) {
    out.push(
      f.clientShared
        ? { id: "unshare", label: "Stop sharing folder", group: 3 }
        : { id: "share", label: "Share folder with client", group: 3 }
    );
  }
  if (canDeleteFolder(f, perms)) {
    out.push({ id: "delete", label: "Delete", group: 4, destructive: true, shortcut: "⌫" });
  }
  return out;
}

function multiActions(targets: ActionTarget[], perms: WorkspacePerms): EntryAction[] {
  const docs = targets.filter((t): t is DocTarget => t.kind === "doc");
  const folders = targets.filter((t): t is FolderTarget => t.kind === "folder");
  const n = targets.length;
  const out: EntryAction[] = [];

  const downloadable = docs.filter((d) => d.hasFile).length;
  if (downloadable > 0) {
    out.push({ id: "download", label: `Download ${plural(downloadable, "file")}`, group: 0 });
  }
  const movable = !docs.some((d) => d.isAttachment) && !folders.some((f) => f.isProtected);
  if (perms.organize && movable) out.push({ id: "move", label: `Move ${plural(n, "item")} to…`, group: 1 });
  if (perms.organize && folders.length === 0) {
    out.push({ id: "copy", label: `Copy ${plural(n, "file")} to…`, group: 1 });
  }
  if (perms.share && !folders.some((f) => f.isProtected)) {
    const allShared = docs.every((d) => d.isShared) && folders.every((f) => f.clientShared);
    out.push(
      allShared
        ? { id: "unshare", label: "Stop sharing", group: 2 }
        : { id: "share", label: "Share with client", group: 2 }
    );
  }
  const deletable = docs.every((d) => d.canDelete) && folders.every((f) => canDeleteFolder(f, perms));
  if (deletable) {
    out.push({ id: "delete", label: `Delete ${plural(n, "item")}`, group: 3, destructive: true, shortcut: "⌫" });
  }
  return out;
}
