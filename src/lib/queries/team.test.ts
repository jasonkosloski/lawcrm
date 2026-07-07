/**
 * Integration tests for `listAssigneeOptions` — the option list
 * behind the task assignee pickers.
 *
 * Rules under test: active users only (inactive users keep old
 * assignments but can't receive new ones — mirrors the write-side
 * `isAssignableUser` check), scoped to the CURRENT user's firm,
 * name-ordered, compact shape (id / name / initials).
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// The query resolves the firm via getCurrentFirm → getCurrentUserId;
// stub the auth chain so next-auth doesn't have to load.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { listAssigneeOptions } from "@/lib/queries/team";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  const { userId } = await seedUser({
    firmId,
    name: "Zoe Viewer",
    initials: "ZV",
    email: "viewer@example.com",
  });
  mockedGetUser.mockResolvedValue(userId);
});

describe("listAssigneeOptions", () => {
  test("returns active firm users, name-ordered, compact shape", async () => {
    await seedUser({
      firmId,
      name: "Ada Lovelace",
      initials: "AL",
      email: "ada@example.com",
    });
    await seedUser({
      firmId,
      name: "Grace Hopper",
      initials: "GH",
      email: "grace@example.com",
    });

    const options = await listAssigneeOptions();
    expect(options.map((o) => o.name)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Zoe Viewer",
    ]);
    expect(options[0]).toEqual(
      expect.objectContaining({ name: "Ada Lovelace", initials: "AL" })
    );
    expect(options[0]!.id).toBeTruthy();
  });

  test("excludes inactive users", async () => {
    await seedUser({
      firmId,
      name: "Gone Guy",
      email: "gone@example.com",
      isActive: false,
    });
    const options = await listAssigneeOptions();
    expect(options.map((o) => o.name)).toEqual(["Zoe Viewer"]);
  });

  test("excludes users from other firms", async () => {
    const other = await seedFirm({ name: "Other Firm" });
    await seedUser({
      firmId: other.firmId,
      name: "Alien Attorney",
      email: "alien@example.com",
    });
    const options = await listAssigneeOptions();
    expect(options.map((o) => o.name)).toEqual(["Zoe Viewer"]);
  });
});
