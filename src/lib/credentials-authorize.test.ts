/**
 * authorizeCredentials — every failure returns null (no enumeration)
 * and the audit trail records real-account attempts only.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "198.51.100.4" })),
}));

vi.mock("argon2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("argon2")>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

import * as argon2 from "argon2";
import { logAuthEvent } from "@/lib/auth-events";
import { prisma } from "@/lib/prisma";
import {
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MS,
  authorizeCredentials,
} from "@/lib/credentials-authorize";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const EMAIL = "pat@kosloskilaw.com";
const PASSWORD = "correct passphrase";
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
    data: { passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }) },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const events = () =>
  prisma.activityLog.findMany({ where: { type: "auth" }, orderBy: { timestamp: "asc" } });

describe("authorizeCredentials", () => {
  test("valid credentials return the user and log a sign-in", async () => {
    const res = await authorizeCredentials({ email: " PAT@kosloskilaw.com ", password: PASSWORD });
    expect(res).toEqual(expect.objectContaining({ id: userId, email: EMAIL }));
    const [e] = await events();
    expect(e.title).toBe("Signed in");
    expect(e.userId).toBe(userId);
    expect(e.detail).toContain("IP 198.51.100.4");
  });

  test("wrong password returns null and logs the failure with its reason", async () => {
    expect(await authorizeCredentials({ email: EMAIL, password: "nope" })).toBeNull();
    const [e] = await events();
    expect(e.title).toBe("Failed sign-in");
    expect(e.detail).toContain("wrong password");
    expect(e.detail).not.toContain("nope");
  });

  test("deactivated account returns null even with the right password", async () => {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await authorizeCredentials({ email: EMAIL, password: PASSWORD })).toBeNull();
    expect((await events())[0].detail).toContain("account deactivated");
  });

  test("unknown email returns null and writes NO audit row", async () => {
    expect(
      await authorizeCredentials({ email: "nobody@example.com", password: PASSWORD })
    ).toBeNull();
    expect(await events()).toHaveLength(0);
  });

  test("unknown email still burns a dummy argon2 verify (no timing oracle)", async () => {
    const verify = vi.mocked(argon2.verify);
    verify.mockClear();
    expect(
      await authorizeCredentials({ email: "nobody@example.com", password: PASSWORD })
    ).toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
    // …and it was NOT checked against a real account's hash.
    const [hash] = verify.mock.calls[0];
    const real = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    expect(hash).not.toBe(real.passwordHash);
  });

  test("deactivated account also burns a dummy verify", async () => {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    const verify = vi.mocked(argon2.verify);
    verify.mockClear();
    await authorizeCredentials({ email: EMAIL, password: PASSWORD });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  test("malformed input returns null without touching the DB log", async () => {
    expect(await authorizeCredentials({ email: "not-an-email", password: "" })).toBeNull();
    expect(await events()).toHaveLength(0);
  });
});

describe("authorizeCredentials — lockout", () => {
  async function failTimes(n: number) {
    for (let i = 0; i < n; i++) {
      expect(await authorizeCredentials({ email: EMAIL, password: "wrong" })).toBeNull();
    }
  }

  test(`locks after ${LOCKOUT_THRESHOLD} failures — even the right password is refused`, async () => {
    await failTimes(LOCKOUT_THRESHOLD);
    expect(await authorizeCredentials({ email: EMAIL, password: PASSWORD })).toBeNull();
    const titles = (await events()).map((e) => e.title);
    expect(titles.at(-1)).toBe("Blocked sign-in (too many failures)");
    expect(titles).not.toContain("Signed in");
  });

  test("below the threshold the right password still works", async () => {
    await failTimes(LOCKOUT_THRESHOLD - 1);
    expect(await authorizeCredentials({ email: EMAIL, password: PASSWORD })).not.toBeNull();
  });

  test("a successful sign-in resets the count", async () => {
    await failTimes(LOCKOUT_THRESHOLD - 1);
    await authorizeCredentials({ email: EMAIL, password: PASSWORD });
    await failTimes(LOCKOUT_THRESHOLD - 1);
    expect(await authorizeCredentials({ email: EMAIL, password: PASSWORD })).not.toBeNull();
  });

  test("the lock lifts once the failures age out of the window", async () => {
    await failTimes(LOCKOUT_THRESHOLD);
    // Blocked attempts during the lock don't extend it.
    await authorizeCredentials({ email: EMAIL, password: PASSWORD });
    await prisma.activityLog.updateMany({
      where: { userId, title: "Failed sign-in" },
      data: { timestamp: new Date(Date.now() - LOCKOUT_WINDOW_MS - 1000) },
    });
    expect(await authorizeCredentials({ email: EMAIL, password: PASSWORD })).not.toBeNull();
  });

  test("parallel guesses can't all pass the lockout check (atomic check-and-record)", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        authorizeCredentials({ email: EMAIL, password: "wrong" })
      )
    );
    expect(results.every((r) => r === null)).toBe(true);
    const all = await events();
    const failed = all.filter((e) => e.title === "Failed sign-in");
    // Exactly the threshold's worth of guesses were evaluated.
    expect(failed).toHaveLength(LOCKOUT_THRESHOLD);
    // Every settled failure carries its real reason (no dangling reservations).
    expect(failed.every((e) => e.detail?.includes("wrong password"))).toBe(true);
    // And the right password is now refused.
    expect(await authorizeCredentials({ email: EMAIL, password: PASSWORD })).toBeNull();
  });

  test("a successful sign-in leaves no reservation row behind", async () => {
    await authorizeCredentials({ email: EMAIL, password: PASSWORD });
    expect((await events()).map((e) => e.title)).toEqual(["Signed in"]);
  });

  test("blocked attempts are logged at most once a minute", async () => {
    await failTimes(LOCKOUT_THRESHOLD);
    for (let i = 0; i < 4; i++) {
      await authorizeCredentials({ email: EMAIL, password: PASSWORD });
    }
    const blocked = (await events()).filter((e) => e.title.startsWith("Blocked sign-in"));
    expect(blocked).toHaveLength(1);
  });

  test("an admin unlock event clears the lock immediately", async () => {
    await failTimes(LOCKOUT_THRESHOLD);
    expect(await authorizeCredentials({ email: EMAIL, password: PASSWORD })).toBeNull();
    await logAuthEvent({ userId, kind: "sign_in_unlocked" });
    expect(await authorizeCredentials({ email: EMAIL, password: PASSWORD })).not.toBeNull();
  });

  test("one account's lock doesn't affect another", async () => {
    const { firmId } = await seedFirm();
    const other = await seedUser({ firmId, email: "other@kosloskilaw.com" });
    await prisma.user.update({
      where: { id: other.userId },
      data: { passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }) },
    });
    await failTimes(LOCKOUT_THRESHOLD);
    expect(
      await authorizeCredentials({ email: "other@kosloskilaw.com", password: PASSWORD })
    ).not.toBeNull();
  });
});
