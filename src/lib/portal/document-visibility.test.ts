import { describe, expect, test } from "vitest";

import {
  isEffectivelyShared,
  shareReason,
  sharedFolderIds,
} from "./document-visibility";

const folders = [
  { id: "root", name: "Root", parentId: null, clientShared: false },
  { id: "gp", name: "Shared GP", parentId: "root", clientShared: true },
  { id: "p", name: "Parent", parentId: "gp", clientShared: false },
  { id: "c", name: "Child", parentId: "p", clientShared: false },
  { id: "other", name: "Other", parentId: "root", clientShared: false },
];

describe("document visibility", () => {
  test("direct share", () => {
    const shared = sharedFolderIds(folders);
    expect(isEffectivelyShared({ clientShare: "shared", folderId: "other" }, shared)).toBe(true);
    expect(isEffectivelyShared({ clientShare: "shared", folderId: null }, shared)).toBe(true);
  });

  test("share via grandparent folder", () => {
    const shared = sharedFolderIds(folders);
    expect(shared.has("c")).toBe(true);
    expect(isEffectivelyShared({ clientShare: null, folderId: "c" }, shared)).toBe(true);
  });

  test("hidden inside shared folder stays hidden", () => {
    const shared = sharedFolderIds(folders);
    expect(isEffectivelyShared({ clientShare: "hidden", folderId: "c" }, shared)).toBe(false);
  });

  test("null outside any shared folder is not shared", () => {
    const shared = sharedFolderIds(folders);
    expect(shared.has("other")).toBe(false);
    expect(isEffectivelyShared({ clientShare: null, folderId: "other" }, shared)).toBe(false);
    expect(isEffectivelyShared({ clientShare: null, folderId: null }, shared)).toBe(false);
  });

  test("shareReason names nearest shared ancestor", () => {
    const nested = [
      ...folders,
      { id: "deep", name: "Deep shared", parentId: "c", clientShared: true },
      { id: "leaf", name: "Leaf", parentId: "deep", clientShared: false },
    ];
    expect(shareReason({ clientShare: "shared", folderId: "c" }, nested)).toEqual({ kind: "file" });
    expect(shareReason({ clientShare: null, folderId: "leaf" }, nested)).toEqual({ kind: "folder", folderName: "Deep shared" });
    expect(shareReason({ clientShare: null, folderId: "c" }, nested)).toEqual({ kind: "folder", folderName: "Shared GP" });
    expect(shareReason({ clientShare: null, folderId: "other" }, nested)).toBeNull();
    expect(shareReason({ clientShare: "hidden", folderId: "c" }, nested)).toBeNull();
  });

  test("cycles do not hang", () => {
    const cyc = [
      { id: "a", name: "A", parentId: "b", clientShared: false },
      { id: "b", name: "B", parentId: "a", clientShared: false },
    ];
    expect(sharedFolderIds(cyc).size).toBe(0);
  });
});
