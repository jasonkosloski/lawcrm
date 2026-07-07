/**
 * Integration tests for the saved-search actions.
 *
 * The contract under test:
 *   - create validates q length, name bounds, and type scope, caps
 *     rows per user, and dedupes on (q, scope) case-insensitively.
 *   - rename/delete resolve ONLY the current user's rows — another
 *     user's id reads as "not found" and mutates nothing.
 *   - the query layer returns the user's rows newest-first and
 *     narrows stale type strings to null.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  createSavedSearch,
  deleteSavedSearch,
  renameSavedSearch,
} from "@/app/actions/saved-searches";
import {
  getSavedSearches,
  SAVED_SEARCH_CAP,
} from "@/lib/queries/saved-searches";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let userId: string;
let otherUserId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "primary@example.com" });
  userId = u.userId;
  const u2 = await seedUser({ firmId, email: "other@example.com" });
  otherUserId = u2.userId;
  mockedGetUser.mockResolvedValue(userId);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createSavedSearch", () => {
  test("creates a row with trimmed name + query, null scope", async () => {
    const res = await createSavedSearch("  Ambulance report ", " ambulance ");
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row = await prisma.savedSearch.findUnique({
      where: { id: res.id },
    });
    expect(row).toMatchObject({
      userId,
      name: "Ambulance report",
      q: "ambulance",
      type: null,
    });
  });

  test("stores a valid type scope", async () => {
    const res = await createSavedSearch("Ambulance notes", "ambulance", "note");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await prisma.savedSearch.findUnique({ where: { id: res.id } });
    expect(row?.type).toBe("note");
  });

  test("rejects a query below the search minimum (after trim)", async () => {
    const res = await createSavedSearch("Too short", "  a  ");
    expect(res).toEqual({
      ok: false,
      error: expect.stringContaining("at least 2"),
    });
    expect(await prisma.savedSearch.count()).toBe(0);
  });

  test("rejects an empty name and an over-long name", async () => {
    const empty = await createSavedSearch("   ", "ambulance");
    expect(empty.ok).toBe(false);

    const long = await createSavedSearch("x".repeat(81), "ambulance");
    expect(long.ok).toBe(false);

    expect(await prisma.savedSearch.count()).toBe(0);
  });

  test("rejects an invalid type scope", async () => {
    const res = await createSavedSearch("Bad scope", "ambulance", "users");
    expect(res).toEqual({
      ok: false,
      error: expect.stringContaining("users"),
    });
    expect(await prisma.savedSearch.count()).toBe(0);
  });

  test("empty-string type means no scope (null)", async () => {
    const res = await createSavedSearch("All types", "ambulance", "");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await prisma.savedSearch.findUnique({ where: { id: res.id } });
    expect(row?.type).toBeNull();
  });

  test("dedupes on (q, scope) case-insensitively — returns the existing id", async () => {
    const first = await createSavedSearch("Ambulance", "Ambulance");
    expect(first.ok).toBe(true);
    const second = await createSavedSearch("ambulance again", "aMbUlAnCe");
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.id).toBe(first.id);
    expect(await prisma.savedSearch.count({ where: { userId } })).toBe(1);

    // Different scope is a DIFFERENT saved search — no dedupe.
    const scoped = await createSavedSearch("Ambulance notes", "ambulance", "note");
    expect(scoped.ok).toBe(true);
    expect(await prisma.savedSearch.count({ where: { userId } })).toBe(2);
  });

  test("caps rows per user with a clear error", async () => {
    await prisma.savedSearch.createMany({
      data: Array.from({ length: SAVED_SEARCH_CAP }, (_, i) => ({
        userId,
        name: `Saved ${i}`,
        q: `query ${i}`,
      })),
    });

    const res = await createSavedSearch("One too many", "overflow");
    expect(res).toEqual({
      ok: false,
      error: expect.stringContaining(String(SAVED_SEARCH_CAP)),
    });
    expect(await prisma.savedSearch.count({ where: { userId } })).toBe(
      SAVED_SEARCH_CAP
    );

    // The cap is per user — another user can still save.
    mockedGetUser.mockResolvedValue(otherUserId);
    const other = await createSavedSearch("Other user's", "overflow");
    expect(other.ok).toBe(true);
  });
});

describe("renameSavedSearch", () => {
  test("renames the current user's row", async () => {
    const created = await createSavedSearch("Old name", "ambulance");
    if (!created.ok) throw new Error("seed create failed");

    const res = await renameSavedSearch(created.id, "  New name  ");
    expect(res).toEqual({ ok: true });

    const row = await prisma.savedSearch.findUnique({
      where: { id: created.id },
    });
    expect(row?.name).toBe("New name");
  });

  test("validates the new name", async () => {
    const created = await createSavedSearch("Old name", "ambulance");
    if (!created.ok) throw new Error("seed create failed");

    const res = await renameSavedSearch(created.id, "   ");
    expect(res.ok).toBe(false);
    const row = await prisma.savedSearch.findUnique({
      where: { id: created.id },
    });
    expect(row?.name).toBe("Old name");
  });

  test("another user's id does not resolve", async () => {
    const created = await createSavedSearch("Mine", "ambulance");
    if (!created.ok) throw new Error("seed create failed");

    mockedGetUser.mockResolvedValue(otherUserId);
    const res = await renameSavedSearch(created.id, "Hijacked");
    expect(res).toEqual({ ok: false, error: "Saved search not found." });

    const row = await prisma.savedSearch.findUnique({
      where: { id: created.id },
    });
    expect(row?.name).toBe("Mine");
  });
});

describe("deleteSavedSearch", () => {
  test("deletes the current user's row", async () => {
    const created = await createSavedSearch("Mine", "ambulance");
    if (!created.ok) throw new Error("seed create failed");

    const res = await deleteSavedSearch(created.id);
    expect(res).toEqual({ ok: true });
    expect(
      await prisma.savedSearch.findUnique({ where: { id: created.id } })
    ).toBeNull();
  });

  test("another user's id does not resolve", async () => {
    const created = await createSavedSearch("Mine", "ambulance");
    if (!created.ok) throw new Error("seed create failed");

    mockedGetUser.mockResolvedValue(otherUserId);
    const res = await deleteSavedSearch(created.id);
    expect(res).toEqual({ ok: false, error: "Saved search not found." });

    expect(
      await prisma.savedSearch.findUnique({ where: { id: created.id } })
    ).not.toBeNull();
  });
});

describe("getSavedSearches", () => {
  test("returns only the current user's rows, newest first", async () => {
    // Explicit createdAt values so the order is deterministic.
    await prisma.savedSearch.createMany({
      data: [
        {
          userId,
          name: "Older",
          q: "older",
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
        {
          userId,
          name: "Newer",
          q: "newer",
          type: "matter",
          createdAt: new Date("2026-07-02T00:00:00Z"),
        },
        { userId: otherUserId, name: "Not mine", q: "hidden" },
      ],
    });

    const rows = await getSavedSearches();
    expect(rows.map((r) => r.name)).toEqual(["Newer", "Older"]);
    expect(rows[0].type).toBe("matter");
    expect(rows[1].type).toBeNull();
  });

  test("narrows a stale type string to null", async () => {
    await prisma.savedSearch.create({
      data: { userId, name: "Stale", q: "stale", type: "no_longer_a_type" },
    });
    const rows = await getSavedSearches();
    expect(rows[0].type).toBeNull();
  });
});
