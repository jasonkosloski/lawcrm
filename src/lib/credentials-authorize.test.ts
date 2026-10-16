/**
 * authorizeCredentials — every failure returns null (no enumeration)
 * and the audit trail records real-account attempts only.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "198.51.100.4" })),
}));

import * as argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { authorizeCredentials } from "@/lib/credentials-authorize";
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

  test("malformed input returns null without touching the DB log", async () => {
    expect(await authorizeCredentials({ email: "not-an-email", password: "" })).toBeNull();
    expect(await events()).toHaveLength(0);
  });
});
