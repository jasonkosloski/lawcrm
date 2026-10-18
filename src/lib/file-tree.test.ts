import { describe, expect, test } from "vitest";
import type { FolderNode } from "@/lib/folder-tree";
import { ROOT_KEY, ancestorChain, filesByFolder, filterTree, nameMatches } from "./file-tree";

const node = (id: string, name: string, parentId: string | null, children: FolderNode[] = []): FolderNode => ({
  id,
  name,
  parentId,
  children,
});

// Discovery
//   Bodycam
//     Officer Smith
// Medical
const TREE: FolderNode[] = [
  node("disc", "Discovery", null, [node("body", "Bodycam", "disc", [node("smith", "Officer Smith", "body")])]),
  node("med", "Medical", null),
];

const FILES = [
  { id: "f1", name: "Retainer.pdf", folderId: null },
  { id: "f2", name: "Police report.pdf", folderId: "disc" },
  { id: "f3", name: "cam-01.mp4", folderId: "smith" },
  { id: "f4", name: "ER records.pdf", folderId: "med" },
  { id: "f5", name: "Résumé — Dr. Lee.docx", folderId: "med" },
];

describe("filesByFolder", () => {
  test("groups by folder, root under ROOT_KEY", () => {
    const m = filesByFolder(FILES);
    expect(m.get(ROOT_KEY)?.map((f) => f.id)).toEqual(["f1"]);
    expect(m.get("med")?.map((f) => f.id)).toEqual(["f4", "f5"]);
    expect(m.has("body")).toBe(false);
  });
});

describe("ancestorChain", () => {
  test("the folder and everything above it, top down", () => {
    expect(ancestorChain(TREE, "smith")).toEqual(["disc", "body", "smith"]);
    expect(ancestorChain(TREE, "med")).toEqual(["med"]);
  });
  test("root or an unknown folder → nothing to expand", () => {
    expect(ancestorChain(TREE, null)).toEqual([]);
    expect(ancestorChain(TREE, "gone")).toEqual([]);
  });
});

describe("nameMatches", () => {
  test("case- and accent-insensitive contains", () => {
    expect(nameMatches("Résumé — Dr. Lee.docx", "resume")).toBe(true);
    expect(nameMatches("Police report.pdf", "REPORT")).toBe(true);
    expect(nameMatches("Police report.pdf", "  ")).toBe(true);
    expect(nameMatches("Police report.pdf", "bodycam")).toBe(false);
  });
});

describe("filterTree", () => {
  const byFolder = filesByFolder(FILES);

  test("empty query shows everything", () => {
    expect(filterTree(TREE, byFolder, " ")).toBeNull();
  });

  test("a matching file shows with every folder above it", () => {
    const r = filterTree(TREE, byFolder, "cam-01")!;
    expect([...r.files]).toEqual(["f3"]);
    expect([...r.folders].sort()).toEqual(["body", "disc", "smith"]);
  });

  test("a matching folder shows with everything inside it", () => {
    const r = filterTree(TREE, byFolder, "bodycam")!;
    expect([...r.files]).toEqual(["f3"]);
    expect(r.folders.has("smith")).toBe(true);
    expect(r.folders.has("med")).toBe(false);
  });

  test("root files filter too; no match → nothing shown", () => {
    expect([...filterTree(TREE, byFolder, "retainer")!.files]).toEqual(["f1"]);
    const none = filterTree(TREE, byFolder, "zzz")!;
    expect(none.files.size + none.folders.size).toBe(0);
  });
});
