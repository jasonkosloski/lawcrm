/**
 * Integration tests for `runConflictMatcher` against the real
 * test DB. The pure helpers (`normalize`, `summarizeMatchSeverity`)
 * are covered in `conflict-check.test.ts`; this file exercises
 * the DB-driven match paths end-to-end.
 *
 * The matcher uses bounded find-many queries + JS-side normalize
 * (SQLite doesn't support insensitive Prisma filters), so case +
 * whitespace differences should match.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { runConflictMatcher } from "@/lib/conflict-check";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let firmId: string;
let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  const u = await seedUser({ firmId });
  userId = u.userId;
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runConflictMatcher — clear path", () => {
  test("empty candidate → clear (nothing to scan against)", async () => {
    const result = await runConflictMatcher({
      name: null,
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("clear");
    expect(result.matches).toHaveLength(0);
  });

  test("candidate with no firm data to match → clear", async () => {
    const result = await runConflictMatcher({
      name: "Jane Doe",
      email: "jane@example.com",
      organization: "Doe LLC",
    });
    expect(result.severity).toBe("clear");
    expect(result.matches).toHaveLength(0);
  });
});

describe("runConflictMatcher — email matches", () => {
  test("same email on a contact appearing as opposing-side → conflict", async () => {
    const opposing = await seedContact({
      name: "John Adversary",
      email: "john@opposing.com",
      type: "opposing_counsel",
    });
    await seedMatterContact({
      matterId,
      contactId: opposing.contactId,
      category: "opposing_counsel",
    });

    const result = await runConflictMatcher({
      name: null,
      email: "john@opposing.com",
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    const conflictMatch = result.matches.find(
      (m) => m.kind === "contact_email"
    );
    expect(conflictMatch).toBeDefined();
    expect(conflictMatch!.severity).toBe("conflict");
    expect(conflictMatch!.contactId).toBe(opposing.contactId);
  });

  test("same email on a contact NOT used as opposing-side → warn (soft signal)", async () => {
    await seedContact({
      name: "Past Client",
      email: "former@example.com",
      type: "client",
    });

    const result = await runConflictMatcher({
      name: null,
      email: "former@example.com",
      organization: null,
    });
    // Soft warn — a former client re-engaging isn't a Rule 1.7
    // bright-line, but the lawyer should know.
    expect(result.severity).toBe("warn");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.severity).toBe("warn");
    expect(result.matches[0]!.kind).toBe("contact_email");
  });

  test("email matching is case + whitespace insensitive", async () => {
    const opposing = await seedContact({
      name: "John Adversary",
      email: "John@OPPOSING.com",
      type: "opposing_counsel",
    });
    await seedMatterContact({
      matterId,
      contactId: opposing.contactId,
      category: "opposing_counsel",
    });

    const result = await runConflictMatcher({
      name: null,
      email: "  john@opposing.com  ",
      organization: null,
    });
    expect(result.severity).toBe("conflict");
  });
});

describe("runConflictMatcher — name matches", () => {
  test("exact name match against Matter.opposingParty → conflict", async () => {
    // Re-seed a fresh matter with an opposing-party text field.
    const area = await seedPracticeArea();
    await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Other Matter",
      opposingParty: "Acme Defendants LLC",
    });

    const result = await runConflictMatcher({
      name: "Acme Defendants LLC",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    const m = result.matches.find(
      (x) => x.kind === "matter_opposing_party"
    );
    expect(m).toBeDefined();
  });

  test("exact name match against Matter.opposingFirm → conflict", async () => {
    const area = await seedPracticeArea();
    await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Yet another matter",
      opposingFirm: "Big Law LLP",
    });

    const result = await runConflictMatcher({
      name: "Big Law LLP",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    const m = result.matches.find(
      (x) => x.kind === "matter_opposing_firm"
    );
    expect(m).toBeDefined();
  });

  test("name in contact directory only (no opposing-side use) → warn", async () => {
    await seedContact({
      name: "Common Name",
      email: null,
      type: "witness",
    });
    const result = await runConflictMatcher({
      name: "Common Name",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("warn");
    expect(result.matches[0]!.kind).toBe("contact_name");
  });

  test("name match on opposing-side MatterContact → conflict", async () => {
    const opposing = await seedContact({
      name: "Hostile Witness",
      type: "witness",
    });
    await seedMatterContact({
      matterId,
      contactId: opposing.contactId,
      category: "witness",
    });
    const result = await runConflictMatcher({
      name: "hostile witness", // case-insensitive
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    const m = result.matches.find(
      (x) =>
        x.kind === "matter_opposing_party" &&
        x.contactId === opposing.contactId
    );
    expect(m).toBeDefined();
  });
});

describe("runConflictMatcher — organization soft match", () => {
  test("same organization → warn (no name/email match needed)", async () => {
    await seedContact({
      name: "Some Person",
      organization: "Big Industries Inc",
      type: "witness",
    });
    const result = await runConflictMatcher({
      name: null,
      email: null,
      organization: "Big Industries Inc",
    });
    expect(result.severity).toBe("warn");
    expect(result.matches[0]!.matchedField).toBe("organization");
  });
});

describe("runConflictMatcher — severity rollup", () => {
  test("any conflict in the match list rolls up to 'conflict'", async () => {
    // Seed both a soft warn AND a hard conflict.
    await seedContact({
      name: "Soft Match",
      email: "soft@example.com",
      type: "client",
    });
    const opposing = await seedContact({
      name: "Hard Match",
      email: "hard@example.com",
      type: "opposing_counsel",
    });
    await seedMatterContact({
      matterId,
      contactId: opposing.contactId,
      category: "opposing_counsel",
    });

    const result = await runConflictMatcher({
      name: null,
      email: "hard@example.com", // hits the conflict path
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    expect(
      result.matches.every((m) => m.severity === "conflict")
    ).toBe(true);
  });

  test("only-warn matches roll up to 'warn'", async () => {
    await seedContact({
      name: "Repeat Person",
      organization: "Some Org",
      type: "client",
    });
    const result = await runConflictMatcher({
      name: "Repeat Person",
      email: null,
      organization: "Some Org",
    });
    expect(result.severity).toBe("warn");
    expect(
      result.matches.every((m) => m.severity === "warn")
    ).toBe(true);
  });

  test("archived matters don't trigger matches", async () => {
    // Set up a matter with an opposing-party field, then archive it.
    const area = await seedPracticeArea();
    const m = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      opposingParty: "Old Defendant LLC",
    });
    const { prisma } = await import("@/lib/prisma");
    await prisma.matter.update({
      where: { id: m.matterId },
      data: { isArchived: true },
    });

    const result = await runConflictMatcher({
      name: "Old Defendant LLC",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("clear");
  });
});
