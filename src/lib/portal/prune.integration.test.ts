import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { resetDb, seedContact } from "@/test/integration-helpers";
import { prunePortalRecords } from "./prune";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

const NOW = new Date("2026-10-18T12:00:00Z");
const HOUR = 3_600_000;
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR);
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

describe("prunePortalRecords", () => {
  test("deletes only dead sessions, long-dead tokens and day-old link requests", async () => {
    await prisma.portalSession.createMany({
      data: [
        { identityId, tokenHash: "s-dead", expiresAt: ago(1) },
        { identityId, tokenHash: "s-live", expiresAt: ago(-1) },
      ],
    });
    const tok = (tokenHash: string, expiresAt: Date, usedAt: Date | null) => ({
      identityId,
      tokenHash,
      purpose: "login",
      expiresAt,
      usedAt,
      createdAt: ago(200),
    });
    await prisma.portalLoginToken.createMany({
      data: [
        tok("t-used-old", ago(-100), ago(25)),
        tok("t-used-recent", ago(-100), ago(2)),
        tok("t-expired-old", ago(25), null),
        tok("t-expired-recent", ago(2), null),
        tok("t-live-invite", ago(-100), null),
      ],
    });
    await prisma.portalLinkRequest.createMany({
      data: [
        { emailHash: "e", ipHash: "i", createdAt: ago(25) },
        { emailHash: "e", ipHash: "i", createdAt: ago(2) },
      ],
    });

    const res = await prunePortalRecords(NOW);
    expect(res).toEqual({ sessions: 1, tokens: 2, linkRequests: 1 });

    const sessions = await prisma.portalSession.findMany({ select: { tokenHash: true } });
    expect(sessions.map((s) => s.tokenHash)).toEqual(["s-live"]);
    const tokens = await prisma.portalLoginToken.findMany({
      select: { tokenHash: true },
      orderBy: { tokenHash: "asc" },
    });
    expect(tokens.map((t) => t.tokenHash)).toEqual([
      "t-expired-recent",
      "t-live-invite",
      "t-used-recent",
    ]);
    expect(await prisma.portalLinkRequest.count()).toBe(1);
  });
});
