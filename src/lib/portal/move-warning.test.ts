import { describe, expect, test } from "vitest";
import { moveWarning } from "./move-warning";

const folders = [
  { id: "shared", parentId: null, clientShared: true },
  { id: "plain", parentId: null, clientShared: false },
];

describe("moveWarning", () => {
  test("null when nothing changes", () => {
    expect(moveWarning([{ clientShare: null, folderId: null }], "plain", folders)).toBeNull();
  });
  test("single file becoming visible", () => {
    expect(moveWarning([{ clientShare: null, folderId: "plain" }], "shared", folders)).toBe(
      "This file will become visible to the client.",
    );
  });
  test("single file becoming hidden", () => {
    expect(moveWarning([{ clientShare: null, folderId: "shared" }], "plain", folders)).toBe(
      "This file will no longer be visible to the client.",
    );
  });
  test("pluralises", () => {
    const docs = [
      { clientShare: null, folderId: "plain" },
      { clientShare: null, folderId: "plain" },
    ];
    expect(moveWarning(docs, "shared", folders)).toBe("2 files will become visible to the client.");
  });
});
