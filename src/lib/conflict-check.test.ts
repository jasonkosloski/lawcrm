/**
 * Tests for the conflict-check matcher.
 *
 * Two layers:
 *   - pure helpers (normalize, summarizeMatchSeverity) — no DB
 *   - runConflictMatcher integration tests against the test
 *     Postgres. These pin the two properties an ethics check
 *     can't lose:
 *       1. NO row cap — a match is found no matter how large the
 *          contact table grows (regression: an old revision took
 *          an arbitrary 200-row slice and re-filtered in JS, so
 *          conflicts past the slice reported "clear")
 *       2. the hard "conflict" tier for email matches only counts
 *          opposing-side use on ACTIVE matters — archived files
 *          downgrade to "warn", per the header doc
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import {
  normalize,
  runConflictMatcher,
  summarizeMatchSeverity,
  type ConflictMatch,
} from "./conflict-check";

describe("normalize", () => {
  test("lowercases", () => {
    expect(normalize("Jane Doe")).toBe("jane doe");
    expect(normalize("JANE DOE")).toBe("jane doe");
  });

  test("trims surrounding whitespace", () => {
    expect(normalize("  jane  ")).toBe("jane");
  });

  test("collapses internal whitespace runs", () => {
    expect(normalize("Jane    Doe")).toBe("jane doe");
    expect(normalize("Jane\t\nDoe")).toBe("jane doe");
  });

  test("null / undefined / empty → empty string", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
    expect(normalize("")).toBe("");
    expect(normalize("   ")).toBe("");
  });
});

describe("summarizeMatchSeverity", () => {
  const matchOf = (severity: "warn" | "conflict"): ConflictMatch => ({
    kind: "contact_name",
    severity,
    matchedField: "name",
    description: "test",
  });

  test("empty list → clear", () => {
    expect(summarizeMatchSeverity([])).toBe("clear");
  });

  test("one warn → warn", () => {
    expect(summarizeMatchSeverity([matchOf("warn")])).toBe("warn");
  });

  test("warn + warn → warn", () => {
    expect(
      summarizeMatchSeverity([matchOf("warn"), matchOf("warn")])
    ).toBe("warn");
  });

  test("any conflict → conflict (even mixed with warns)", () => {
    expect(
      summarizeMatchSeverity([matchOf("warn"), matchOf("conflict")])
    ).toBe("conflict");
  });

  test("only conflict → conflict", () => {
    expect(summarizeMatchSeverity([matchOf("conflict")])).toBe("conflict");
  });
});

describe("runConflictMatcher (integration)", () => {
  beforeAll(() => {
    expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
  });

  beforeEach(async () => {
    await resetDb();
  });

  /** Firm + user + practice area + one matter, for tests that
   *  need a MatterContact row. Returns the ids the test threads
   *  into further fixtures. */
  async function seedMatterScaffold(opts?: {
    opposingParty?: string;
  }): Promise<{ matterId: string; areaId: string; stageId: string; userId: string }> {
    const { firmId } = await seedFirm();
    const { userId } = await seedUser({ firmId });
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      opposingParty: opts?.opposingParty ?? null,
    });
    return { matterId, areaId, stageId, userId };
  }

  test("finds email + name matches beyond the old 200-row candidate cap", async () => {
    // 250 fillers first so the real match sits past any bounded
    // slice a regression might reintroduce.
    await prisma.contact.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        name: `Filler Contact ${i}`,
        email: `filler-${i}@example.com`,
        type: "other",
      })),
    });
    const { contactId } = await seedContact({
      name: "Oscar Openheim",
      email: "oscar@opposing.example",
      type: "opposing_counsel",
    });

    const byEmail = await runConflictMatcher({
      name: null,
      email: "oscar@opposing.example",
      organization: null,
    });
    expect(byEmail.severity).toBe("warn"); // in directory, no opposing-side use
    expect(byEmail.matches).toEqual([
      expect.objectContaining({ kind: "contact_email", contactId }),
    ]);

    const byName = await runConflictMatcher({
      name: "Oscar Openheim",
      email: null,
      organization: null,
    });
    expect(byName.matches).toEqual([
      expect.objectContaining({ kind: "contact_name", contactId }),
    ]);
  });

  test("matching is case- and candidate-whitespace-insensitive", async () => {
    const { contactId } = await seedContact({
      name: "Jane Roe",
      email: "Jane.Roe@Example.com",
      organization: "Acme Holdings LLP",
    });

    const result = await runConflictMatcher({
      name: "  JANE   roe ",
      email: " jane.roe@EXAMPLE.com",
      organization: "acme   holdings llp",
    });
    // Exactly one hit: the email path claims the contact first and
    // the name / org paths skip it via seenContactIds (dedupe).
    expect(result.severity).toBe("warn");
    expect(result.matches).toEqual([
      expect.objectContaining({ matchedField: "email", contactId }),
    ]);
  });

  test("free-text opposingParty on an active matter is a hard conflict", async () => {
    const { matterId } = await seedMatterScaffold({
      opposingParty: "ACME Holdings",
    });

    const result = await runConflictMatcher({
      name: "acme   holdings",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    expect(result.matches).toEqual([
      expect.objectContaining({ kind: "matter_opposing_party", matterId }),
    ]);
  });

  test("email match: opposing-side use on archived matters only → warn, not conflict", async () => {
    const scaffold = await seedMatterScaffold();
    await prisma.matter.update({
      where: { id: scaffold.matterId },
      data: { isArchived: true },
    });
    const { contactId } = await seedContact({
      name: "Wanda Witness",
      email: "wanda@example.com",
      type: "witness",
    });
    await seedMatterContact({
      matterId: scaffold.matterId,
      contactId,
      category: "opposing",
    });

    const archivedOnly = await runConflictMatcher({
      name: null,
      email: "wanda@example.com",
      organization: null,
    });
    expect(archivedOnly.severity).toBe("warn");

    // Same contact on the opposing side of an ACTIVE matter → the
    // bright-line tier kicks in.
    const { matterId: activeMatterId } = await seedMatter({
      practiceAreaId: scaffold.areaId,
      stageId: scaffold.stageId,
      leadUserId: scaffold.userId,
      name: "Active Matter",
    });
    await seedMatterContact({
      matterId: activeMatterId,
      contactId,
      category: "opposing",
    });

    const withActive = await runConflictMatcher({
      name: null,
      email: "wanda@example.com",
      organization: null,
    });
    expect(withActive.severity).toBe("conflict");
    expect(withActive.matches[0]?.description).toContain("1 active matter");
  });
});
