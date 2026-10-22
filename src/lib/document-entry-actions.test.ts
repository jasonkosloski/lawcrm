import { describe, expect, test } from "vitest";
import {
  backgroundActions,
  entryActions,
  type DocTarget,
  type FolderTarget,
  type WorkspacePerms,
} from "./document-entry-actions";

const ALL: WorkspacePerms = {
  organize: true,
  edit: true,
  folderCreate: true,
  folderEdit: true,
  folderDelete: true,
  upload: true,
  share: true,
  writable: true,
};
const NONE: WorkspacePerms = Object.fromEntries(
  Object.keys(ALL).map((k) => [k, false]),
) as WorkspacePerms;

const doc = (over: Partial<DocTarget> = {}): DocTarget => ({
  kind: "doc",
  id: "d1",
  name: "scan.pdf",
  href: "/matters/m1/documents/d1",
  folderId: null,
  isAttachment: false,
  hasFile: true,
  canDelete: true,
  category: "other",
  status: "final",
  clientShare: null,
  isShared: false,
  unsavedAttachments: [],
  savedAttachments: [],
  attachmentShares: [],
  ...over,
});

const folder = (over: Partial<FolderTarget> = {}): FolderTarget => ({
  kind: "folder",
  id: "f1",
  name: "Medical",
  href: "/matters/m1/documents?folder=f1",
  parentId: null,
  isProtected: false,
  hasProtectedDescendant: false,
  clientShared: false,
  atDepthCap: false,
  ...over,
});

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("one document", () => {
  test("every action with every permission", () => {
    expect(ids(entryActions([doc()], ALL))).toEqual([
      "open",
      "open-new-tab",
      "download",
      "edit",
      "move",
      "copy",
      "share",
      "delete",
    ]);
  });

  test("view-only: open and download", () => {
    expect(ids(entryActions([doc({ canDelete: false })], NONE))).toEqual([
      "open",
      "open-new-tab",
      "download",
    ]);
  });

  test("no download without a stored file", () => {
    expect(ids(entryActions([doc({ hasFile: false })], NONE))).not.toContain("download");
  });

  test("a shared file offers Stop sharing", () => {
    const a = entryActions([doc({ isShared: true })], ALL);
    expect(ids(a)).toContain("unshare");
    expect(ids(a)).not.toContain("share");
  });

  test("an attachment can be copied but not moved", () => {
    const a = ids(entryActions([doc({ isAttachment: true })], ALL));
    expect(a).toContain("copy");
    expect(a).not.toContain("move");
  });
});

describe("one folder", () => {
  test("every action with every permission", () => {
    expect(ids(entryActions([folder()], ALL))).toEqual([
      "open",
      "open-new-tab",
      "new-folder",
      "upload",
      "rename",
      "move",
      "share",
      "delete",
    ]);
  });

  test("a protected folder has no rename, move, share or delete", () => {
    expect(ids(entryActions([folder({ isProtected: true })], ALL))).toEqual([
      "open",
      "open-new-tab",
      "new-folder",
      "upload",
    ]);
  });

  test("an ancestor of a protected folder can be renamed but not deleted", () => {
    const a = ids(entryActions([folder({ hasProtectedDescendant: true })], ALL));
    expect(a).toContain("rename");
    expect(a).not.toContain("delete");
  });

  test("no subfolders at the depth cap; nothing new on a read-only record", () => {
    expect(ids(entryActions([folder({ atDepthCap: true })], ALL))).not.toContain("new-folder");
    const ro = ids(entryActions([folder()], { ...ALL, writable: false }));
    expect(ro).not.toContain("new-folder");
    expect(ro).not.toContain("upload");
  });

  test("a shared folder offers Stop sharing folder", () => {
    expect(
      entryActions([folder({ clientShared: true })], ALL).find((a) => a.id === "unshare")?.label,
    ).toBe("Stop sharing folder");
  });
});

describe("several rows", () => {
  test("labels count the selection", () => {
    const a = entryActions([doc(), doc({ id: "d2" }), folder()], ALL);
    expect(a.map((x) => x.label)).toEqual([
      "Download 2 files",
      "Move 3 items to…",
      "Share with client",
      "Delete 3 items",
    ]);
  });

  test("copy is files-only", () => {
    expect(ids(entryActions([doc(), doc({ id: "d2" })], ALL))).toContain("copy");
    expect(ids(entryActions([doc(), folder()], ALL))).not.toContain("copy");
  });

  test("an attachment or protected folder in the selection blocks move", () => {
    expect(ids(entryActions([doc(), doc({ id: "a", isAttachment: true })], ALL))).not.toContain(
      "move",
    );
    expect(ids(entryActions([doc(), folder({ isProtected: true })], ALL))).not.toContain("move");
  });

  test("delete needs every row deletable", () => {
    expect(ids(entryActions([doc(), doc({ id: "d2", canDelete: false })], ALL))).not.toContain(
      "delete",
    );
    expect(ids(entryActions([doc(), folder()], { ...ALL, folderDelete: false }))).not.toContain(
      "delete",
    );
  });

  test("all shared → Stop sharing", () => {
    expect(
      ids(entryActions([doc({ isShared: true }), folder({ clientShared: true })], ALL)),
    ).toContain("unshare");
  });
});

describe("background", () => {
  test("new folder, upload, select all", () => {
    expect(ids(backgroundActions(ALL, { atDepthCap: false, hasEntries: true }))).toEqual([
      "new-folder",
      "upload",
      "select-all",
    ]);
  });

  test("gated and capped", () => {
    expect(ids(backgroundActions(ALL, { atDepthCap: true, hasEntries: false }))).toEqual([
      "upload",
    ]);
    expect(
      backgroundActions({ ...ALL, writable: false }, { atDepthCap: false, hasEntries: false }),
    ).toEqual([]);
  });
});
