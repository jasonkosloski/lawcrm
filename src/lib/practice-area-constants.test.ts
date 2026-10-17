import { describe, expect, test } from "vitest";
import { areaArchiveBlockedMessage, planReorder } from "./practice-area-constants";

describe("planReorder", () => {
  const items = [
    { id: "a", order: 0 },
    { id: "b", order: 3 },
    { id: "c", order: 7 },
  ];

  test("trades the two order values and leaves everything else alone", () => {
    expect(planReorder(items, 1, 2)).toEqual([
      { id: "b", order: 7 },
      { id: "c", order: 3 },
    ]);
    expect(planReorder(items, 1, 0)).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 3 },
    ]);
  });

  test("equal order values renumber densely in the new position", () => {
    const dup = [
      { id: "a", order: 5 },
      { id: "b", order: 5 },
      { id: "c", order: 5 },
    ];
    expect(planReorder(dup, 2, 1)).toEqual([
      { id: "a", order: 0 },
      { id: "c", order: 1 },
      { id: "b", order: 2 },
    ]);
  });

  test("duplicates elsewhere in the list also renumber densely", () => {
    // Plain swap of A and B would give A=2, B=1 and leave A tied with C.
    const dup = [
      { id: "a", order: 1 },
      { id: "b", order: 2 },
      { id: "c", order: 2 },
      { id: "d", order: 3 },
    ];
    const plan = planReorder(dup, 0, 1);
    expect(plan).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
      { id: "c", order: 2 },
      { id: "d", order: 3 },
    ]);
  });
});

describe("areaArchiveBlockedMessage", () => {
  test("never advises archiving matters (no such control) and pluralizes", () => {
    const one = areaArchiveBlockedMessage(1);
    const many = areaArchiveBlockedMessage(4);
    expect(one).toMatch(/^Cannot archive/);
    expect(one).toContain("1 matter (");
    expect(many).toContain("4 matters (");
    expect(many).toMatch(/Move them to another practice area first/);
    expect(many).not.toMatch(/archive the matters/);
  });
});
