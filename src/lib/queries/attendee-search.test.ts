/**
 * Integration tests for the attendee autocomplete search.
 *
 * Search hits the live test DB — no mocks. Covers:
 *   - empty query short-circuits to []
 *   - matches firm users + contacts in that order
 *   - case-insensitive matching against name / email / jobTitle / org
 *   - inactive users / contacts are excluded
 *   - excludeUserIds / excludeContactIds filter dedupe-style
 *   - per-bucket caps (6 each)
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { searchAttendees } from "@/lib/queries/attendee-search";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

let firmId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("searchAttendees", () => {
  test("empty query returns empty array (no DB call needed)", async () => {
    expect(await searchAttendees("")).toEqual([]);
    expect(await searchAttendees("   ")).toEqual([]);
  });

  test("matches firm users by name", async () => {
    await seedUser({ firmId, name: "Jason Kosloski", email: "jason@k.com" });
    await seedUser({ firmId, name: "Other Person", email: "other@k.com" });
    const out = await searchAttendees("Jason");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "user", name: "Jason Kosloski" });
  });

  test("matches firm users by email + jobTitle (case-insensitive)", async () => {
    await seedUser({
      firmId,
      name: "Alex Doe",
      email: "alex@example.com",
      jobTitle: "Paralegal",
    });
    expect(
      (await searchAttendees("ALEX@EXAMPLE.COM"))[0]?.name
    ).toBe("Alex Doe");
    expect((await searchAttendees("paralegal"))[0]?.name).toBe("Alex Doe");
  });

  test("inactive users are excluded", async () => {
    await seedUser({
      firmId,
      name: "Inactive User",
      email: "inactive@k.com",
      isActive: false,
    });
    const out = await searchAttendees("Inactive");
    expect(out).toHaveLength(0);
  });

  test("matches contacts by name + email + organization", async () => {
    await prisma.contact.createMany({
      data: [
        { name: "Acme Corp", organization: "Acme Holdings", type: "client" },
        {
          name: "Mary Witness",
          email: "mary@evidence.org",
          type: "witness",
        },
      ],
    });
    const byName = await searchAttendees("acme");
    expect(byName.find((r) => r.name === "Acme Corp")?.kind).toBe("contact");
    const byEmail = await searchAttendees("evidence");
    expect(byEmail.find((r) => r.name === "Mary Witness")?.kind).toBe(
      "contact"
    );
    const byOrg = await searchAttendees("Holdings");
    expect(byOrg.find((r) => r.name === "Acme Corp")?.kind).toBe("contact");
  });

  test("inactive contacts are excluded", async () => {
    await prisma.contact.create({
      data: {
        name: "Soft Deleted",
        type: "client",
        isActive: false,
      },
    });
    expect(await searchAttendees("Soft")).toHaveLength(0);
  });

  test("users come before contacts in the output order", async () => {
    await seedUser({ firmId, name: "Match One", email: "u@k.com" });
    await prisma.contact.create({
      data: { name: "Match One Contact", type: "vendor" },
    });
    const out = await searchAttendees("Match");
    expect(out[0]?.kind).toBe("user");
    expect(out[1]?.kind).toBe("contact");
  });

  test("excludeUserIds + excludeContactIds drop matches by id", async () => {
    const u = await seedUser({ firmId, name: "Pickme U", email: "pu@k.com" });
    const c = await prisma.contact.create({
      data: { name: "Pickme C", type: "client" },
      select: { id: true },
    });

    const all = await searchAttendees("Pickme");
    expect(all).toHaveLength(2);

    const filtered = await searchAttendees("Pickme", {
      excludeUserIds: [u.userId],
      excludeContactIds: [c.id],
    });
    expect(filtered).toHaveLength(0);

    const onlyContact = await searchAttendees("Pickme", {
      excludeUserIds: [u.userId],
    });
    expect(onlyContact).toHaveLength(1);
    expect(onlyContact[0]?.kind).toBe("contact");
  });

  test("per-bucket cap is 6 results each", async () => {
    // Seed 8 matching users + 8 matching contacts.
    for (let i = 0; i < 8; i++) {
      await seedUser({
        firmId,
        name: `Match User ${i}`,
        email: `mu${i}@k.com`,
      });
      await prisma.contact.create({
        data: { name: `Match Contact ${i}`, type: "vendor" },
      });
    }
    const out = await searchAttendees("Match");
    const userCount = out.filter((r) => r.kind === "user").length;
    const contactCount = out.filter((r) => r.kind === "contact").length;
    expect(userCount).toBeLessThanOrEqual(6);
    expect(contactCount).toBeLessThanOrEqual(6);
  });
});
