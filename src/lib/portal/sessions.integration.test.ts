import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { resetDb, seedContact } from "@/test/integration-helpers";
import { hashSecret } from "./secrets";
import {
  createSession,
  deleteSession,
  deleteSessionsFor,
  resolveSession,
} from "./sessions";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

const DAY = 86_400_000;
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

describe("portal sessions", () => {
  test("session resolves, then fails after expiry", async () => {
    const raw = await createSession(identityId);
    const hit = await resolveSession(raw);
    expect(hit?.identityId).toBe(identityId);
    await prisma.portalSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resolveSession(raw)).toBeNull();
  });

  test("only the hash is stored", async () => {
    const raw = await createSession(identityId);
    const row = await prisma.portalSession.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashSecret(raw));
    expect(row.tokenHash).not.toBe(raw);
  });

  test("session for a disabled identity does not resolve", async () => {
    const raw = await createSession(identityId);
    await prisma.portalIdentity.update({
      where: { id: identityId },
      data: { disabledAt: new Date() },
    });
    expect(await resolveSession(raw)).toBeNull();
  });

  test("use slides expiry to now + 7 days", async () => {
    const raw = await createSession(identityId);
    await prisma.portalSession.updateMany({
      data: {
        lastSeenAt: new Date(Date.now() - 2 * 60_000),
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    await resolveSession(raw);
    const row = await prisma.portalSession.findFirstOrThrow();
    expect(Math.abs(row.expiresAt.getTime() - (Date.now() + 7 * DAY))).toBeLessThan(5000);
  });

  test("does not slide more than once a minute", async () => {
    const raw = await createSession(identityId);
    const before = await prisma.portalSession.findFirstOrThrow();
    await resolveSession(raw);
    const after = await prisma.portalSession.findFirstOrThrow();
    expect(after.lastSeenAt).toEqual(before.lastSeenAt);
    expect(after.expiresAt).toEqual(before.expiresAt);
  });

  test("sliding never passes createdAt + 30 days", async () => {
    const raw = await createSession(identityId);
    const createdAt = new Date(Date.now() - (30 * DAY - 3_600_000));
    await prisma.portalSession.updateMany({
      data: {
        createdAt,
        lastSeenAt: new Date(Date.now() - 2 * 60_000),
      },
    });
    expect(await resolveSession(raw)).not.toBeNull();
    const row = await prisma.portalSession.findFirstOrThrow();
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(createdAt.getTime() + 30 * DAY);
  });

  test("deleteSession removes just that session", async () => {
    const a = await createSession(identityId);
    const b = await createSession(identityId);
    await deleteSession(a);
    expect(await resolveSession(a)).toBeNull();
    expect(await resolveSession(b)).not.toBeNull();
  });

  test("deleteSessionsFor removes every session", async () => {
    const a = await createSession(identityId);
    const b = await createSession(identityId);
    expect(await deleteSessionsFor(identityId)).toBe(2);
    expect(await resolveSession(a)).toBeNull();
    expect(await resolveSession(b)).toBeNull();
  });
});
