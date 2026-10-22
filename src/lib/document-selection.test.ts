import { describe, expect, test } from "vitest";
import {
  EMPTY_SELECTION,
  applyClick,
  docKey,
  folderKey,
  moveBlockReason,
  parseEntryKey,
  pruneSelection,
  type EntryKey,
} from "./document-selection";

const order: EntryKey[] = [folderKey("f1"), docKey("a"), docKey("b"), docKey("c"), docKey("d")];
const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };

describe("applyClick", () => {
  test("plain click selects only that row and sets the anchor", () => {
    const s1 = applyClick(EMPTY_SELECTION, docKey("a"), order, toggle);
    const s2 = applyClick(s1, docKey("c"), order, plain);
    expect([...s2.keys]).toEqual([docKey("c")]);
    expect(s2.anchor).toBe(docKey("c"));
  });

  test("toggle adds and removes", () => {
    let s = applyClick(EMPTY_SELECTION, docKey("a"), order, toggle);
    s = applyClick(s, docKey("c"), order, toggle);
    expect(s.keys).toEqual(new Set([docKey("a"), docKey("c")]));
    s = applyClick(s, docKey("a"), order, toggle);
    expect(s.keys).toEqual(new Set([docKey("c")]));
  });

  test("shift selects the span from the anchor, either direction", () => {
    const s = applyClick(
      applyClick(EMPTY_SELECTION, docKey("c"), order, plain),
      folderKey("f1"),
      order,
      range,
    );
    expect(s.keys).toEqual(new Set([folderKey("f1"), docKey("a"), docKey("b"), docKey("c")]));
    expect(s.anchor).toBe(docKey("c"));
  });

  test("shift+toggle extends the existing selection", () => {
    let s = applyClick(EMPTY_SELECTION, folderKey("f1"), order, plain);
    s = applyClick(s, docKey("c"), order, toggle);
    s = applyClick(s, docKey("d"), order, { toggle: true, range: true });
    expect(s.keys).toEqual(new Set([folderKey("f1"), docKey("c"), docKey("d")]));
  });

  test("shift without an anchor behaves like a plain click", () => {
    const s = applyClick(EMPTY_SELECTION, docKey("b"), order, range);
    expect([...s.keys]).toEqual([docKey("b")]);
  });
});

test("pruneSelection drops rows that are gone", () => {
  const s = { keys: new Set([docKey("a"), docKey("zz")]), anchor: docKey("zz") };
  const p = pruneSelection(s, order);
  expect(p.keys).toEqual(new Set([docKey("a")]));
  expect(p.anchor).toBeNull();
  const same = { keys: new Set([docKey("a")]), anchor: docKey("a") };
  expect(pruneSelection(same, order)).toBe(same);
});

test("parseEntryKey splits on the first colon", () => {
  expect(parseEntryKey(docKey("x:y"))).toEqual({ kind: "doc", id: "x:y" });
  expect(parseEntryKey(folderKey("f"))).toEqual({ kind: "folder", id: "f" });
});

describe("moveBlockReason", () => {
  const folders = [
    { id: "A", parentId: null, name: "A", order: 0 },
    { id: "B", parentId: "A", name: "B", order: 0 },
    { id: "C", parentId: "B", name: "C", order: 0 },
    { id: "D", parentId: null, name: "D", order: 1 },
  ];
  const doc = (folderId: string | null, isAttachment = false) => ({
    id: "d",
    folderId,
    isAttachment,
  });
  const folder = (id: string, parentId: string | null, isProtected = false) => ({
    id,
    parentId,
    isProtected,
  });

  test("documents move anywhere but where they are", () => {
    expect(moveBlockReason({ docs: [doc(null)], folders: [] }, "C", folders)).toBeNull();
    expect(moveBlockReason({ docs: [doc("C")], folders: [] }, null, folders)).toBeNull();
    expect(moveBlockReason({ docs: [doc("C")], folders: [] }, "C", folders)).toBe("Already here.");
  });

  test("a mixed batch is fine when only part of it is already there", () => {
    expect(moveBlockReason({ docs: [doc("D"), doc(null)], folders: [] }, "D", folders)).toBeNull();
  });

  test("attachments and generated folders never move", () => {
    expect(moveBlockReason({ docs: [doc(null, true)], folders: [] }, "D", folders)).toMatch(
      /attachments/,
    );
    expect(moveBlockReason({ docs: [], folders: [folder("D", null, true)] }, "A", folders)).toMatch(
      /records request/,
    );
  });

  test("a folder can't go into itself or its subtree", () => {
    expect(moveBlockReason({ docs: [], folders: [folder("A", null)] }, "A", folders)).toMatch(
      /into itself/,
    );
    expect(moveBlockReason({ docs: [], folders: [folder("A", null)] }, "C", folders)).toMatch(
      /into itself/,
    );
    expect(moveBlockReason({ docs: [], folders: [folder("B", "A")] }, "D", folders)).toBeNull();
    expect(moveBlockReason({ docs: [], folders: [folder("B", "A")] }, null, folders)).toBeNull();
  });

  test("the depth cap", () => {
    const chain = Array.from({ length: 8 }, (_, i) => ({
      id: `L${i + 1}`,
      parentId: i === 0 ? null : `L${i}`,
      name: `L${i + 1}`,
      order: 0,
    }));
    const all = [
      ...chain,
      { id: "X", parentId: null, name: "X", order: 1 },
      { id: "Y", parentId: "X", name: "Y", order: 0 },
    ];
    expect(moveBlockReason({ docs: [], folders: [folder("X", null)] }, "L7", all)).toMatch(
      /levels deep/,
    );
    expect(moveBlockReason({ docs: [], folders: [folder("Y", "X")] }, "L7", all)).toBeNull();
  });

  test("an empty payload", () => {
    expect(moveBlockReason({ docs: [], folders: [] }, null, folders)).toBe("Nothing selected.");
  });
});
