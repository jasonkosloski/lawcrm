/**
 * changePasswordAction + logoutAction auditing.
 *
 * Real DB + real argon2 (the point is that the stored hash really
 * changes); Auth.js and request headers are mocked.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// next-auth doesn't load under Vitest (it imports next/server by a
// path the test resolver can't follow); the action only needs the
// AuthError class from it.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  unstable_update: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({
    "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    "user-agent": "TestBrowser/1.0",
  })),
}));

import * as argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { auth, signOut, unstable_update } from "@/auth";
import { getCurrentUserId } from "@/lib/current-user";
import { changePasswordAction, logoutAction } from "@/app/actions/auth";
import { changePasswordInitialState } from "@/lib/security-form";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const CURRENT = "old passphrase here";
const EMAIL = "pat@kosloskilaw.com";
let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId, email: EMAIL }));
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await argon2.hash(CURRENT, { type: argon2.argon2id }) },
  });
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
});

afterEach(() => {
  vi.clearAllMocks();
});

function form(fields: { current?: string; next?: string; confirm?: string }) {
  const fd = new FormData();
  fd.set("currentPassword", fields.current ?? CURRENT);
  fd.set("newPassword", fields.next ?? "a brand new passphrase");
  fd.set("confirmPassword", fields.confirm ?? fields.next ?? "a brand new passphrase");
  return fd;
}

async function storedHash() {
  return (
    await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } })
  ).passwordHash!;
}

async function authEvents() {
  return prisma.activityLog.findMany({
    where: { userId, type: "auth" },
    orderBy: { timestamp: "asc" },
  });
}

describe("changePasswordAction", () => {
  test("changes the password, audits it, and re-stamps this session", async () => {
    const before = await storedHash();
    const res = await changePasswordAction(changePasswordInitialState, form({}));

    expect(res).toEqual({ status: "ok" });
    const after = await storedHash();
    expect(after).not.toBe(before);
    expect(await argon2.verify(after, "a brand new passphrase")).toBe(true);
    expect(vi.mocked(unstable_update)).toHaveBeenCalledTimes(1);

    const [event] = await authEvents();
    expect(event.title).toBe("Changed password");
    expect(event.matterId).toBeNull();
    expect(event.detail).toContain("IP 203.0.113.7");
    // The new password never lands in the audit trail.
    expect(JSON.stringify(event)).not.toContain("brand new");
  });

  test("wrong current password: refused, audited, hash untouched", async () => {
    const before = await storedHash();
    const res = await changePasswordAction(
      changePasswordInitialState,
      form({ current: "not my password" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.currentPassword).toEqual(["Current password is incorrect."]);
    expect(await storedHash()).toBe(before);
    expect(vi.mocked(unstable_update)).not.toHaveBeenCalled();
    expect((await authEvents()).map((e) => e.title)).toEqual(["Failed password change"]);
  });

  test("enforces the password policy", async () => {
    const short = await changePasswordAction(
      changePasswordInitialState,
      form({ next: "too short" })
    );
    expect(short.errors?.newPassword?.[0]).toMatch(/at least 12/);

    const email = await changePasswordAction(
      changePasswordInitialState,
      form({ next: EMAIL })
    );
    expect(email.errors?.newPassword?.[0]).toMatch(/email address/);
  });

  test("confirmation must match", async () => {
    const res = await changePasswordAction(
      changePasswordInitialState,
      form({ next: "a brand new passphrase", confirm: "a different passphrase" })
    );
    expect(res.errors?.confirmPassword).toEqual(["Passwords don't match."]);
  });

  test("refuses re-using the current password", async () => {
    const before = await storedHash();
    const res = await changePasswordAction(
      changePasswordInitialState,
      form({ next: CURRENT })
    );
    expect(res.errors?.newPassword?.[0]).toMatch(/aren't using now/);
    expect(await storedHash()).toBe(before);
  });
});

describe("logoutAction", () => {
  test("audits the sign-out before clearing the session", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userId }, expires: "" } as never);
    await logoutAction();
    expect((await authEvents()).map((e) => e.title)).toEqual(["Signed out"]);
    expect(vi.mocked(signOut)).toHaveBeenCalledWith({ redirectTo: "/login" });
  });
});
