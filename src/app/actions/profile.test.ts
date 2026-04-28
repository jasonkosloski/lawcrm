/**
 * Profile action — focused tests on the bits that don't fall out
 * trivially from the schema. The schema rules (name/initials
 * required, time zone valid, etc.) are well-covered by the field
 * highlighting in the form; we exercise the branches that have
 * real product impact:
 *
 *   - defaultEventVisibility flips between "default" and
 *     "show_details" and is rejected when tampered to a third
 *     value (the resolver only knows the two — a tampered "private"
 *     would silently coerce events to default-deny which is fine
 *     defensively, but accepting an unknown enum is a bug).
 *
 *   - Action targets the session user, not the form. Even if a
 *     formData entry tried to specify a userId, it can't write to
 *     another row.
 *
 * Permission gate is intentionally not tested here — there is no
 * gate; every signed-in user can edit their own profile.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { updateProfileAction } from "@/app/actions/profile";
import { profileInitialState } from "@/lib/profile-form";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  const u = await seedUser({ firmId });
  userId = u.userId;
  mockedGetUser.mockResolvedValue(userId);
});

afterEach(() => {
  vi.clearAllMocks();
});

const buildForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("name", overrides.name ?? "Updated Name");
  fd.set("initials", overrides.initials ?? "UN");
  fd.set("phone", overrides.phone ?? "");
  fd.set("barNumber", overrides.barNumber ?? "");
  fd.set("avatarUrl", overrides.avatarUrl ?? "");
  fd.set("timeZone", overrides.timeZone ?? "America/Chicago");
  fd.set(
    "defaultEventVisibility",
    overrides.defaultEventVisibility ?? "default"
  );
  return fd;
};

describe("updateProfileAction — defaultEventVisibility", () => {
  test("flips to show_details and persists", async () => {
    const res = await updateProfileAction(
      profileInitialState,
      buildForm({ defaultEventVisibility: "show_details" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.defaultEventVisibility).toBe("show_details");
  });

  test("flips back to default", async () => {
    // Start in show_details; flip to default.
    await prisma.user.update({
      where: { id: userId },
      data: { defaultEventVisibility: "show_details" },
    });
    const res = await updateProfileAction(
      profileInitialState,
      buildForm({ defaultEventVisibility: "default" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.defaultEventVisibility).toBe("default");
  });

  test("rejects an unknown enum value (tampered form)", async () => {
    // The resolver only branches on "default" / "show_details".
    // A third value (say "private", which doesn't exist yet) would
    // silently behave like "default" — but that would also let a
    // tampered form set garbage that future-us has to clean up.
    const res = await updateProfileAction(
      profileInitialState,
      buildForm({ defaultEventVisibility: "private" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.defaultEventVisibility?.length).toBeGreaterThan(0);
    // Original value untouched.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.defaultEventVisibility).toBe("default");
  });

  test("missing field is rejected (zod required)", async () => {
    const fd = buildForm();
    fd.delete("defaultEventVisibility");
    const res = await updateProfileAction(profileInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.defaultEventVisibility?.length).toBeGreaterThan(0);
  });
});

describe("updateProfileAction — self-only write", () => {
  test("session user is the target, regardless of any extra form fields", async () => {
    // Seed a second user; try to write through that user's id in
    // the form. The action must ignore the form id and write to
    // the session user.
    const other = await seedUser({ firmId, name: "Other", email: "o@x.com" });
    const fd = buildForm({ name: "Hijack attempt" });
    fd.set("userId", other.userId); // not in schema, should be ignored
    const res = await updateProfileAction(profileInitialState, fd);
    expect(res.status).toBe("ok");

    const sessionRow = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(sessionRow.name).toBe("Hijack attempt");

    const otherRow = await prisma.user.findUniqueOrThrow({
      where: { id: other.userId },
    });
    expect(otherRow.name).toBe("Other"); // untouched
  });
});
