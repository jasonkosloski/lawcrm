/**
 * Server actions are public POST endpoints: argument types are not
 * enforced at runtime. The action validates the payload and returns
 * an empty result rather than throwing or building an oversized
 * NOT IN list.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/queries/attendee-search", () => ({
  searchAttendees: vi.fn(),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { searchAttendees } from "@/lib/queries/attendee-search";
import { searchAttendeesAction } from "@/app/actions/attendee-search";

const mockedUser = vi.mocked(getCurrentUserId);
const mockedSearch = vi.mocked(searchAttendees);

beforeEach(() => {
  mockedUser.mockReset().mockResolvedValue("u1");
  mockedSearch.mockReset().mockResolvedValue([]);
});

describe("searchAttendeesAction", () => {
  test("a valid payload is forwarded to the query", async () => {
    mockedSearch.mockResolvedValue([
      {
        kind: "user",
        id: "u2",
        name: "Ann",
        email: "ann@x.com",
        initials: "A",
        jobTitle: "Associate",
      },
    ]);
    const out = await searchAttendeesAction("ann", ["u1"], ["c1"]);
    expect(out).toHaveLength(1);
    expect(mockedSearch).toHaveBeenCalledWith("ann", {
      excludeUserIds: ["u1"],
      excludeContactIds: ["c1"],
    });
  });

  test("a signed-out caller is rejected before anything runs", async () => {
    mockedUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(searchAttendeesAction("ann", [], [])).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  test("a non-string query returns [] instead of throwing", async () => {
    const out = await searchAttendeesAction(
      { evil: true } as unknown as string,
      [],
      []
    );
    expect(out).toEqual([]);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  test("non-array exclusion lists return []", async () => {
    expect(
      await searchAttendeesAction("a", "u1" as unknown as string[], [])
    ).toEqual([]);
    expect(
      await searchAttendeesAction("a", [], null as unknown as string[])
    ).toEqual([]);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  test("an oversized exclusion list returns [] (NOT IN parameter blow-up)", async () => {
    const many = Array.from({ length: 201 }, (_, i) => `id${i}`);
    expect(await searchAttendeesAction("a", many, [])).toEqual([]);
    expect(await searchAttendeesAction("a", [], many)).toEqual([]);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  test("the cap itself (200) is still allowed", async () => {
    const edge = Array.from({ length: 200 }, (_, i) => `id${i}`);
    await searchAttendeesAction("a", edge, edge);
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });

  test("an over-long query or id returns []", async () => {
    expect(await searchAttendeesAction("x".repeat(101), [], [])).toEqual([]);
    expect(await searchAttendeesAction("a", ["y".repeat(65)], [])).toEqual([]);
    expect(mockedSearch).not.toHaveBeenCalled();
  });
});
