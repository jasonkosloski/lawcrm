/**
 * Unit tests for the pure folder-tree helpers.
 *
 * The action + query layers lean on these for depth caps, cycle
 * checks, breadcrumbs, and collision renames — so the edge cases
 * (orphans, bad-data cycles, case-insensitive collisions) are pinned
 * here rather than re-derived per integration test.
 */

import { describe, expect, test } from "vitest";
import {
  buildFolderTree,
  collectDescendantIds,
  flattenFolderTree,
  folderDepth,
  folderPath,
  nextAvailableFolderName,
  subtreeHeight,
  type FolderRecord,
} from "./folder-tree";

const row = (
  id: string,
  parentId: string | null,
  name = id,
  order = 0
): FolderRecord => ({ id, parentId, name, order });

/**
 * root-a
 * ├── child-1
 * │   └── grand-1
 * └── child-2
 * root-b
 */
const FIXTURE: FolderRecord[] = [
  row("grand-1", "child-1"),
  row("root-b", null, "Beta"),
  row("child-2", "root-a", "Zulu", 0),
  row("child-1", "root-a", "Alpha", 1),
  row("root-a", null, "Alpha"),
];

describe("buildFolderTree", () => {
  test("nests children under parents and returns roots", () => {
    const tree = buildFolderTree(FIXTURE);
    expect(tree.map((n) => n.id)).toEqual(["root-a", "root-b"]);
    const rootA = tree[0]!;
    expect(rootA.children.map((n) => n.id)).toEqual(["child-2", "child-1"]);
    expect(rootA.children[1]!.children.map((n) => n.id)).toEqual(["grand-1"]);
  });

  test("siblings sort by order, then name", () => {
    const tree = buildFolderTree([
      row("b", null, "Bravo", 0),
      row("a", null, "Alpha", 0),
      row("c", null, "AAA-but-later", 5),
    ]);
    expect(tree.map((n) => n.name)).toEqual([
      "Alpha",
      "Bravo",
      "AAA-but-later",
    ]);
  });

  test("orphaned parentId is treated as a root, not dropped", () => {
    const tree = buildFolderTree([row("orphan", "missing-parent")]);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
  });

  test("empty input → empty tree", () => {
    expect(buildFolderTree([])).toEqual([]);
  });
});

describe("flattenFolderTree", () => {
  test("depth-first with 1-based depth", () => {
    const flat = flattenFolderTree(buildFolderTree(FIXTURE));
    expect(flat.map((f) => [f.id, f.depth])).toEqual([
      ["root-a", 1],
      ["child-2", 2],
      ["child-1", 2],
      ["grand-1", 3],
      ["root-b", 1],
    ]);
  });
});

describe("folderDepth / subtreeHeight", () => {
  test("root-level folder has depth 1; nesting increments", () => {
    expect(folderDepth(FIXTURE, "root-a")).toBe(1);
    expect(folderDepth(FIXTURE, "child-1")).toBe(2);
    expect(folderDepth(FIXTURE, "grand-1")).toBe(3);
  });

  test("unknown id → depth 0", () => {
    expect(folderDepth(FIXTURE, "nope")).toBe(0);
  });

  test("height is 1 for a leaf, grows with descendants", () => {
    expect(subtreeHeight(FIXTURE, "grand-1")).toBe(1);
    expect(subtreeHeight(FIXTURE, "child-1")).toBe(2);
    expect(subtreeHeight(FIXTURE, "root-a")).toBe(3);
    expect(subtreeHeight(FIXTURE, "nope")).toBe(0);
  });

  test("bad-data cycle terminates instead of hanging", () => {
    const cyclic = [row("x", "y"), row("y", "x")];
    expect(folderDepth(cyclic, "x")).toBe(2);
    expect(subtreeHeight(cyclic, "x")).toBeGreaterThan(0);
  });
});

describe("collectDescendantIds", () => {
  test("collects the full subtree, excluding the folder itself", () => {
    const ids = collectDescendantIds(FIXTURE, "root-a");
    expect([...ids].sort()).toEqual(["child-1", "child-2", "grand-1"]);
    expect(ids.has("root-a")).toBe(false);
  });

  test("leaf has no descendants", () => {
    expect(collectDescendantIds(FIXTURE, "grand-1").size).toBe(0);
  });
});

describe("folderPath", () => {
  test("returns root → target inclusive", () => {
    expect(folderPath(FIXTURE, "grand-1").map((p) => p.id)).toEqual([
      "root-a",
      "child-1",
      "grand-1",
    ]);
  });

  test("unknown id → empty path", () => {
    expect(folderPath(FIXTURE, "nope")).toEqual([]);
  });
});

describe("nextAvailableFolderName", () => {
  test("no collision → name unchanged", () => {
    expect(nextAvailableFolderName("Exhibits", new Set())).toBe("Exhibits");
  });

  test("collision suffixes with (2), then (3)…", () => {
    expect(nextAvailableFolderName("Exhibits", new Set(["exhibits"]))).toBe(
      "Exhibits (2)"
    );
    expect(
      nextAvailableFolderName(
        "Exhibits",
        new Set(["exhibits", "exhibits (2)"])
      )
    ).toBe("Exhibits (3)");
  });

  test("collision check is case-insensitive", () => {
    expect(nextAvailableFolderName("EXHIBITS", new Set(["exhibits"]))).toBe(
      "EXHIBITS (2)"
    );
  });
});
