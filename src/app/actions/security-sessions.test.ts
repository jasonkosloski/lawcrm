/**
 * revokeMySession: identity comes only from getStaffAuth(); the
 * current device is refused; a session owned by another Clerk user is
 * refused by revokeStaffSession and leaves no audit row. Clerk is
 * mocked; the database is real.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/staff-auth", () => ({ getStaffAuth: vi.fn() }));
vi.mock("@/lib/clerk-admin", () => ({ revokeStaffSession: vi.fn() }));

import { getStaffAuth } from "@/lib/staff-auth";
import { revokeStaffSession } from "@/lib/clerk-admin";
import { AUTH_EVENT_TITLES } from "@/lib/auth-events";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import { revokeMySession } from "@/app/actions/security-sessions";

const mAuth = vi.mocked(getStaffAuth);
const mRevoke = vi.mocked(revokeStaffSession);

let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.resetAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  mAuth.mockResolvedValue({
    status: "ok",
    userId,
    clerkUserId: "user_me",
    sessionId: "sess_current",
  });
});

const rows = () =>
  prisma.activityLog.findMany({
    where: { title: AUTH_EVENT_TITLES.session_revoked },
  });

describe("revokeMySession", () => {
  test("refuses when signed out", async () => {
    mAuth.mockResolvedValue({ status: "signed_out" });
    const r = await revokeMySession("sess_other");
    expect(r.ok).toBe(false);
    expect(mRevoke).not.toHaveBeenCalled();
  });

  test("refuses the current session", async () => {
    const r = await revokeMySession("sess_current");
    expect(r).toEqual({ ok: false, error: "Use Sign out for this device." });
    expect(mRevoke).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  test("a session owned by another Clerk user is refused, no audit row", async () => {
    mRevoke.mockResolvedValue({ ok: false, error: "Not your session." });
    const r = await revokeMySession("sess_theirs");
    expect(r).toEqual({ ok: false, error: "Not your session." });
    expect(mRevoke).toHaveBeenCalledWith("user_me", "sess_theirs");
    expect(await rows()).toHaveLength(0);
  });

  test("revokes own other session and logs one row", async () => {
    mRevoke.mockResolvedValue({ ok: true });
    const r = await revokeMySession("sess_other");
    expect(r).toEqual({ ok: true });
    expect(mRevoke).toHaveBeenCalledWith("user_me", "sess_other");
    const logged = await rows();
    expect(logged).toHaveLength(1);
    expect(logged[0].userId).toBe(userId);
  });
});
