/**
 * Wiring of the Auth.js callbacks in src/auth.ts: what the `jwt`
 * callback forwards from the `unstable_update` payload to
 * validateSessionToken, and that the `session` callback never leaks
 * the password fingerprint. (validateSessionToken itself is covered
 * in src/lib/session-token.test.ts.) next-auth is mocked to capture
 * the config object; the DB is real.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const captured = vi.hoisted(() => ({
  config: undefined as
    | undefined
    | {
        callbacks: {
          jwt: (a: Record<string, unknown>) => Promise<Record<string, unknown>>;
          session: (a: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
      },
}));

vi.mock("next-auth", () => ({
  default: (config: typeof captured.config) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn(() => ({})) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));

import { prisma } from "@/lib/prisma";
import { passwordFingerprint } from "@/lib/session-fingerprint";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import "@/auth";

let userId: string;
const jwt = (a: Record<string, unknown>) => captured.config!.callbacks.jwt(a);

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: "$argon2id$original" },
  });
});

describe("jwt callback wiring", () => {
  async function staleToken() {
    const token = await jwt({ token: {}, user: { id: userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: "$argon2id$changed" },
    });
    return token;
  }

  test("an update payload carrying the fresh fingerprint re-stamps the session", async () => {
    const token = await staleToken();
    const out = await jwt({
      token: { ...token },
      trigger: "update",
      session: { pwv: passwordFingerprint("$argon2id$changed") },
    });
    expect(out.userId).toBe(userId);
  });

  test("an update with no payload, or a wrong fingerprint, strips a stale token", async () => {
    const token = await staleToken();
    for (const session of [undefined, {}, { pwv: "deadbeefdeadbeef" }, { pwv: 123 }]) {
      const out = await jwt({ token: { ...token }, trigger: "update", session });
      expect(out.userId).toBeUndefined();
    }
  });

  test("the fingerprint in the payload is ignored outside trigger 'update'", async () => {
    const token = await staleToken();
    const out = await jwt({
      token: { ...token },
      session: { pwv: passwordFingerprint("$argon2id$changed") },
    });
    expect(out.userId).toBeUndefined();
  });
});

describe("session callback", () => {
  test("exposes user.id but never the password fingerprint", async () => {
    const out = await captured.config!.callbacks.session({
      session: { user: { name: "A" }, expires: "x" },
      token: { userId, pwv: "0123456789abcdef" },
    });
    expect((out.user as { id?: string }).id).toBe(userId);
    expect(JSON.stringify(out)).not.toContain("0123456789abcdef");
    expect(out).not.toHaveProperty("pwv");
  });
});
