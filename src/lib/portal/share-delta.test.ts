import { describe, expect, test } from "vitest";
import { visibilityChangeForMove } from "./share-delta";

const folders = [
  { id: "shared", parentId: null, clientShared: true },
  { id: "sub", parentId: "shared", clientShared: false },
  { id: "plain", parentId: null, clientShared: false },
];

describe("visibilityChangeForMove", () => {
  test("moving into a shared folder makes inherited files visible", () => {
    const docs = [
      { clientShare: null, folderId: "plain" },
      { clientShare: null, folderId: null },
    ];
    expect(visibilityChangeForMove(docs, "sub", folders)).toEqual({
      becomesVisible: 2,
      becomesHidden: 0,
    });
  });

  test("moving out of a shared folder hides inherited files", () => {
    const docs = [
      { clientShare: null, folderId: "shared" },
      { clientShare: null, folderId: "sub" },
    ];
    expect(visibilityChangeForMove(docs, "plain", folders)).toEqual({
      becomesVisible: 0,
      becomesHidden: 2,
    });
    expect(visibilityChangeForMove(docs, null, folders)).toEqual({
      becomesVisible: 0,
      becomesHidden: 2,
    });
  });

  test("hidden and individually shared files do not change", () => {
    const docs = [
      { clientShare: "hidden", folderId: "plain" },
      { clientShare: "shared", folderId: "shared" },
      { clientShare: "shared", folderId: "plain" },
    ];
    expect(visibilityChangeForMove(docs, "sub", folders)).toEqual({
      becomesVisible: 0,
      becomesHidden: 0,
    });
    expect(visibilityChangeForMove(docs, "plain", folders)).toEqual({
      becomesVisible: 0,
      becomesHidden: 0,
    });
  });

  test("shared to shared and plain to plain are unchanged", () => {
    expect(
      visibilityChangeForMove([{ clientShare: null, folderId: "shared" }], "sub", folders),
    ).toEqual({ becomesVisible: 0, becomesHidden: 0 });
    expect(
      visibilityChangeForMove([{ clientShare: null, folderId: "plain" }], null, folders),
    ).toEqual({ becomesVisible: 0, becomesHidden: 0 });
  });

  test("archived files never count (the portal never shows them)", () => {
    const docs = [
      { clientShare: null, folderId: "plain", status: "archived" },
      { clientShare: null, folderId: "shared", status: "archived" },
      { clientShare: null, folderId: "plain", status: "final" },
    ];
    expect(visibilityChangeForMove(docs, "sub", folders)).toEqual({
      becomesVisible: 1,
      becomesHidden: 0,
    });
    expect(visibilityChangeForMove(docs.slice(0, 2), "plain", folders)).toEqual({
      becomesVisible: 0,
      becomesHidden: 0,
    });
  });
});
