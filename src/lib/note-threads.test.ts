import { describe, expect, test } from "vitest";
import {
  buildTrees,
  countNodes,
  rollupDescendants,
  subtreeHasUnread,
  subtreeMatches,
  summarizeRollup,
  type ThreadableNote,
} from "./note-threads";

const note = (id: string, over: Partial<ThreadableNote> = {}): ThreadableNote => ({
  id,
  parentNoteId: null,
  isPinned: false,
  isRead: true,
  attachedTasks: [],
  attachedDeadlines: [],
  attachedTimeEntries: [],
  ...over,
});

describe("buildTrees", () => {
  test("roots are pinned first, then newest first (input is oldest-first)", () => {
    const trees = buildTrees([
      note("old"),
      note("pinned-old", { isPinned: true }),
      note("new"),
      note("pinned-new", { isPinned: true }),
    ]);
    // Pinned keep input order; the rest are reversed to newest-first.
    expect(trees.map((t) => t.note.id)).toEqual(["pinned-old", "pinned-new", "new", "old"]);
  });

  test("replies nest to any depth and keep oldest-first order", () => {
    const [root] = buildTrees([
      note("root"),
      note("r1", { parentNoteId: "root" }),
      note("r2", { parentNoteId: "root" }),
      note("r1a", { parentNoteId: "r1" }),
    ]);
    expect(root.children.map((c) => c.note.id)).toEqual(["r1", "r2"]);
    expect(root.children[0].children.map((c) => c.note.id)).toEqual(["r1a"]);
    expect(countNodes(root)).toBe(4);
  });

  test("an orphan reply (parent not in the list) is promoted to a root", () => {
    const trees = buildTrees([note("lost", { parentNoteId: "gone" })]);
    expect(trees).toHaveLength(1);
    expect(trees[0].note.id).toBe("lost");
  });

  test("a parent cycle terminates instead of recursing forever", () => {
    // Neither note is a root, so both are dropped - the point is that
    // this returns at all.
    expect(
      buildTrees([note("a", { parentNoteId: "b" }), note("b", { parentNoteId: "a" })]),
    ).toEqual([]);
  });
});

describe("thread predicates", () => {
  const tree = () =>
    buildTrees([note("root"), note("reply", { parentNoteId: "root", isRead: false })])[0];

  test("subtreeMatches finds a match in a descendant", () => {
    expect(subtreeMatches(tree(), (n) => n.id === "reply")).toBe(true);
    expect(subtreeMatches(tree(), (n) => n.id === "nope")).toBe(false);
  });

  test("subtreeHasUnread sees an unread reply under a read root", () => {
    expect(subtreeHasUnread(tree())).toBe(true);
    expect(subtreeHasUnread(buildTrees([note("solo")])[0])).toBe(false);
  });
});

describe("rollupDescendants", () => {
  test("counts descendants' attachments only, not the root's own", () => {
    const [root] = buildTrees([
      note("root", { attachedTasks: [{}, {}] }),
      note("r1", {
        parentNoteId: "root",
        attachedTasks: [{}],
        attachedTimeEntries: [{ hours: 1.5 }, { hours: 0.5 }],
      }),
      note("r2", { parentNoteId: "r1", attachedDeadlines: [{}] }),
      note("r3", { parentNoteId: "root" }),
    ]);
    const r = rollupDescendants(root);
    expect(r).toEqual({
      tasks: 1,
      deadlines: 1,
      timeEntries: 2,
      totalHours: 2,
      notesWithAttachments: 2,
    });
    expect(summarizeRollup(r)).toBe("1 task · 1 deadline · 2 time entries (2.0h) across 2 replies");
  });
});
