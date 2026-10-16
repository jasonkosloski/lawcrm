/**
 * validateSessionToken — the Auth.js `jwt` callback body (ADR-017).
 * Real DB: the check is a user-row read, and the property under test
 * is "a password change invalidates sessions issued before it".
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { passwordFingerprint } from "@/lib/session-fingerprint";
import { validateSessionToken } from "@/lib/session-token";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

let userId: string;

async function setHash(hash: string | null) {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
}

/** Simulates sign-in: Auth.js hands the callback a fresh token + user. */
function signIn(): Promise<JWT> {
  return validateSessionToken({}, { signInUserId: userId });
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  await setHash("$argon2id$original");
});

describe("validateSessionToken", () => {
  test("sign-in stamps userId + a password fingerprint", async () => {
    const token = await signIn();
    expect(token.userId).toBe(userId);
    expect(token.pwv).toMatch(/^[0-9a-f]{16}$/);
  });

  test("later requests keep the session while the password is unchanged", async () => {
    const token = await signIn();
    const next = await validateSessionToken({ ...token });
    expect(next.userId).toBe(userId);
  });

  test("a password change signs out sessions issued before it", async () => {
    const token = await signIn();
    await setHash("$argon2id$changed");
    const next = await validateSessionToken({ ...token });
    expect(next.userId).toBeUndefined();
  });

  test("trigger 'update' with the freshly computed fingerprint re-stamps the session", async () => {
    const token = await signIn();
    await setHash("$argon2id$changed");
    const updated = await validateSessionToken(
      { ...token },
      { trigger: "update", updatePwv: passwordFingerprint("$argon2id$changed") }
    );
    expect(updated.userId).toBe(userId);
    // …and it stays valid on subsequent requests.
    const next = await validateSessionToken({ ...updated });
    expect(next.userId).toBe(userId);
  });

  test("trigger 'update' with no payload fingerprint strips a stale token (forged POST /api/auth/session)", async () => {
    const token = await signIn();
    await setHash("$argon2id$changed");
    const forged = await validateSessionToken({ ...token }, { trigger: "update" });
    expect(forged.userId).toBeUndefined();
  });

  test("trigger 'update' with a wrong or non-string fingerprint strips a stale token", async () => {
    const token = await signIn();
    await setHash("$argon2id$changed");
    for (const updatePwv of [
      token.pwv, // the OLD fingerprint
      passwordFingerprint("$argon2id$guess"),
      "",
      12345,
      { pwv: "x" },
    ]) {
      const res = await validateSessionToken({ ...token }, { trigger: "update", updatePwv });
      expect(res.userId).toBeUndefined();
    }
  });

  test("trigger 'update' on a still-current token with no payload keeps it", async () => {
    const token = await signIn();
    const res = await validateSessionToken({ ...token }, { trigger: "update" });
    expect(res.userId).toBe(userId);
  });

  test("a correct fingerprint without trigger 'update' does not re-stamp", async () => {
    const token = await signIn();
    await setHash("$argon2id$changed");
    const res = await validateSessionToken(
      { ...token },
      { updatePwv: passwordFingerprint("$argon2id$changed") }
    );
    expect(res.userId).toBeUndefined();
  });

  test("tokens minted before fingerprints existed are dropped", async () => {
    const legacy: JWT = { userId };
    const next = await validateSessionToken(legacy);
    expect(next.userId).toBeUndefined();
  });

  test("deactivated or deleted users lose the session", async () => {
    const token = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    expect((await validateSessionToken({ ...token })).userId).toBeUndefined();

    const ghost = await validateSessionToken({ userId: "missing", pwv: token.pwv });
    expect(ghost.userId).toBeUndefined();
  });

  test("tokens without a userId pass through untouched", async () => {
    expect(await validateSessionToken({ name: "x" })).toEqual({ name: "x" });
  });
});
