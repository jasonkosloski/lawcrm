import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { resetDb, seedContact } from "@/test/integration-helpers";
import { consumeToken, issueToken } from "./tokens";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let identityId: string;

beforeEach(async () => {
  await resetDb();
  const { contactId } = await seedContact({ email: "jane@example.com" });
  identityId = (
    await prisma.portalIdentity.create({
      data: { contactId, email: "jane@example.com" },
    })
  ).id;
});

describe("portal tokens", () => {
  test("a token works once", async () => {
    const raw = await issueToken(identityId, "login");
    expect(await consumeToken(raw)).toEqual({ identityId });
    expect(await consumeToken(raw)).toBeNull();
  });

  test("two concurrent consumes: exactly one wins", async () => {
    const raw = await issueToken(identityId, "login");
    const results = await Promise.all([consumeToken(raw), consumeToken(raw)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  test("expired token is rejected", async () => {
    const raw = await issueToken(identityId, "login");
    await prisma.portalLoginToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeToken(raw)).toBeNull();
  });

  test("an unknown token is rejected", async () => {
    expect(await consumeToken("nope")).toBeNull();
  });

  test("issuing a new token kills the old one (either purpose)", async () => {
    const invite = await issueToken(identityId, "invite");
    const login = await issueToken(identityId, "login");
    expect(await consumeToken(invite)).toBeNull();
    expect(await consumeToken(login)).toEqual({ identityId });
  });

  test("only the hash is stored", async () => {
    const raw = await issueToken(identityId, "login");
    const rows = await prisma.portalLoginToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows.some((r) => r.tokenHash === raw)).toBe(false);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("login tokens last 15 minutes, invite tokens 7 days", async () => {
    await issueToken(identityId, "login");
    const login = await prisma.portalLoginToken.findFirstOrThrow({
      where: { purpose: "login" },
    });
    await issueToken(identityId, "invite");
    const invite = await prisma.portalLoginToken.findFirstOrThrow({
      where: { purpose: "invite" },
    });
    const span = (t: { expiresAt: Date; createdAt: Date }) =>
      t.expiresAt.getTime() - t.createdAt.getTime();
    expect(Math.abs(span(login) - 15 * 60_000)).toBeLessThan(5000);
    expect(Math.abs(span(invite) - 7 * 86_400_000)).toBeLessThan(5000);
  });
});
