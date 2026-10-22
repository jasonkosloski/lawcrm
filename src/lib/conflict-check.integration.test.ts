/**
 * Integration tests for `runConflictMatcher` against the real
 * test DB. The pure helpers (`normalize`, `summarizeMatchSeverity`)
 * are covered in `conflict-check.test.ts`; this file exercises
 * the DB-driven match paths end-to-end.
 *
 * The matcher compares in Postgres with `mode: "insensitive"`
 * equality over every row (no cap, no JS-side re-filter) against
 * candidate values normalized by `normalize()`, so case + whitespace
 * differences on the candidate side still match.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  adverseNameKeys,
  runAdverseConflictMatcher,
  runConflictMatcher,
} from "@/lib/conflict-check";
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

let firmId: string;
let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
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
    const conflictMatch = result.matches.find((m) => m.kind === "contact_email");
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
    const m = result.matches.find((x) => x.kind === "matter_opposing_party");
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
    const m = result.matches.find((x) => x.kind === "matter_opposing_firm");
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
      (x) => x.kind === "matter_opposing_party" && x.contactId === opposing.contactId,
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
    expect(result.matches.every((m) => m.severity === "conflict")).toBe(true);
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
    expect(result.matches.every((m) => m.severity === "warn")).toBe(true);
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

describe("runConflictMatcher — the lead's own Contact (ownContactId)", () => {
  test("own contact matching by email + name + organization → clear", async () => {
    const own = await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
      organization: "Hale Co",
      type: "client",
    });
    const result = await runConflictMatcher({
      name: "Jessica Hale",
      email: "jhale@example.com",
      organization: "Hale Co",
      ownContactId: own.contactId,
    });
    expect(result.severity).toBe("clear");
    expect(result.matches).toHaveLength(0);
  });

  test("without ownContactId the same candidate self-matches (warn)", async () => {
    await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
      type: "client",
    });
    const result = await runConflictMatcher({
      name: "Jessica Hale",
      email: "jhale@example.com",
      organization: null,
    });
    expect(result.severity).toBe("warn");
  });

  test("own contact that is ALSO opposing on an active matter → still conflict", async () => {
    const own = await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
      type: "client",
    });
    await seedMatterContact({
      matterId,
      contactId: own.contactId,
      category: "opposing",
    });
    const result = await runConflictMatcher({
      name: "Jessica Hale",
      email: "jhale@example.com",
      organization: null,
      ownContactId: own.contactId,
    });
    expect(result.severity).toBe("conflict");
    expect(result.matches.some((m) => m.contactId === own.contactId)).toBe(true);
  });

  test("a DIFFERENT contact with the same email/name still warns", async () => {
    const own = await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
      type: "client",
    });
    const other = await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
      type: "client",
    });
    const result = await runConflictMatcher({
      name: "Jessica Hale",
      email: "jhale@example.com",
      organization: null,
      ownContactId: own.contactId,
    });
    expect(result.severity).toBe("warn");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.every((m) => m.contactId === other.contactId)).toBe(true);
  });
});

describe("runConflictMatcher — deactivated contacts still on matters", () => {
  test("deactivated opposing party (by name) is still a hard conflict", async () => {
    const opposing = await seedContact({
      name: "Gone Inactive",
      type: "opposing",
      isActive: false,
    });
    await seedMatterContact({
      matterId,
      contactId: opposing.contactId,
      category: "opposing",
    });
    const result = await runConflictMatcher({
      name: "Gone Inactive",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    expect(result.matches[0]!.contactId).toBe(opposing.contactId);
  });

  test("deactivated opposing party (by email) is still a hard conflict", async () => {
    const opposing = await seedContact({
      name: "Gone Inactive",
      email: "gone@opposing.com",
      type: "opposing",
      isActive: false,
    });
    await seedMatterContact({
      matterId,
      contactId: opposing.contactId,
      category: "opposing",
    });
    const result = await runConflictMatcher({
      name: null,
      email: "gone@opposing.com",
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    expect(result.matches[0]!.kind).toBe("contact_email");
  });

  test("deactivated contact with NO matter involvement still warns, labelled inactive (former client, Rule 1.9)", async () => {
    await seedContact({
      name: "Retired Contact",
      email: "retired@example.com",
      organization: "Retired Org",
      isActive: false,
    });
    const result = await runConflictMatcher({
      name: "Retired Contact",
      email: "retired@example.com",
      organization: "Retired Org",
    });
    expect(result.severity).toBe("warn");
    expect(result.matches.length).toBeGreaterThan(0);
    for (const m of result.matches) {
      expect(m.severity).toBe("warn");
      expect(m.description).toContain("(inactive)");
    }
  });

  test("a contact merged away is not matched (the survivor carries the rows)", async () => {
    const survivor = await seedContact({ name: "Survivor" });
    const loser = await seedContact({
      name: "Merged Loser",
      email: "loser@example.com",
      isActive: false,
    });
    const { prisma } = await import("@/lib/prisma");
    await prisma.contact.update({
      where: { id: loser.contactId },
      data: { mergedIntoId: survivor.contactId },
    });
    await seedMatterContact({
      matterId,
      contactId: loser.contactId,
      category: "opposing",
    });
    const result = await runConflictMatcher({
      name: "Merged Loser",
      email: "loser@example.com",
      organization: null,
    });
    expect(result.severity).toBe("clear");
  });
});

describe("runConflictMatcher — opposing counsel (representation)", () => {
  /** A party row on the shared matter, with representation fields. */
  async function seedRepresentedParty(
    rep: {
      representationContactId?: string | null;
      representationName?: string | null;
      representationEmail?: string | null;
    },
    onMatterId: string = matterId,
  ) {
    const { prisma } = await import("@/lib/prisma");
    const party = await seedContact({ name: "Defendant Dan", type: "opposing" });
    await prisma.matterContact.create({
      data: {
        matterId: onMatterId,
        contactId: party.contactId,
        category: "opposing",
        isRepresented: true,
        ...rep,
      },
    });
  }

  test("attorney linked only via representationContactId, matched by email → conflict", async () => {
    const atty = await seedContact({
      name: "Pat Smith",
      email: "pat@defense.com",
      type: "opposing_counsel",
    });
    await seedRepresentedParty({ representationContactId: atty.contactId });

    const result = await runConflictMatcher({
      name: null,
      email: "pat@defense.com",
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    expect(result.matches[0]).toMatchObject({
      kind: "contact_email",
      severity: "conflict",
      contactId: atty.contactId,
    });
    expect(result.matches[0]!.description).toContain("appears on opposing side of 1 active matter");
  });

  test("counsel matched by BOTH email and name is reported once, not twice", async () => {
    const atty = await seedContact({
      name: "Pat Smith",
      email: "pat@defense.com",
      type: "opposing_counsel",
    });
    await seedRepresentedParty({ representationContactId: atty.contactId });

    const result = await runConflictMatcher({
      name: "Pat Smith",
      email: "pat@defense.com",
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    expect(result.matches.filter((m) => m.contactId === atty.contactId)).toHaveLength(1);
  });

  test("attorney linked via representationContactId, matched by name → conflict", async () => {
    const atty = await seedContact({
      name: "Pat Smith",
      type: "opposing_counsel",
    });
    await seedRepresentedParty({ representationContactId: atty.contactId });

    const result = await runConflictMatcher({
      name: "pat smith",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    expect(result.matches).toHaveLength(1); // not double-counted as a soft name warn
    expect(result.matches[0]).toMatchObject({
      kind: "matter_opposing_party",
      contactId: atty.contactId,
      matterId,
    });
    expect(result.matches[0]!.description).toContain("opposing counsel");
  });

  test("legacy representationName / representationEmail text (no Contact) → conflict", async () => {
    await seedRepresentedParty({
      representationName: "Legacy Lawyer",
      representationEmail: "legacy@firm.com",
    });

    const byName = await runConflictMatcher({
      name: "Legacy Lawyer",
      email: null,
      organization: null,
    });
    expect(byName.severity).toBe("conflict");

    const byEmail = await runConflictMatcher({
      name: null,
      email: "LEGACY@firm.com",
      organization: null,
    });
    expect(byEmail.severity).toBe("conflict");
    expect(byEmail.matches[0]!.kind).toBe("contact_email");
  });

  test("counsel on an ARCHIVED matter only warns by email (directory), never conflicts", async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.matter.update({
      where: { id: matterId },
      data: { isArchived: true },
    });
    const atty = await seedContact({
      name: "Pat Smith",
      email: "pat@defense.com",
      type: "opposing_counsel",
    });
    await seedRepresentedParty({ representationContactId: atty.contactId });

    const result = await runConflictMatcher({
      name: "Pat Smith",
      email: "pat@defense.com",
      organization: null,
    });
    expect(result.severity).toBe("warn");
  });

  test("several email hits are each counted correctly (batched counts)", async () => {
    // Two directory contacts share an email: one is opposing on 2 matters,
    // the other is unused.
    const { prisma } = await import("@/lib/prisma");
    const used = await seedContact({ name: "Used", email: "shared@x.com" });
    await seedContact({ name: "Unused", email: "SHARED@x.com" });
    const area = await seedPracticeArea();
    const m2 = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Second",
    });
    for (const id of [matterId, m2.matterId]) {
      await prisma.matterContact.create({
        data: { matterId: id, contactId: used.contactId, category: "opposing" },
      });
    }
    const result = await runConflictMatcher({
      name: null,
      email: "shared@x.com",
      organization: null,
    });
    const usedMatch = result.matches.find((m) => m.contactId === used.contactId);
    expect(usedMatch?.severity).toBe("conflict");
    expect(usedMatch?.description).toContain("2 active matters");
    const other = result.matches.find((m) => m.contactId !== used.contactId);
    expect(other?.severity).toBe("warn");
    expect(result.severity).toBe("conflict");
  });
});

describe("runConflictMatcher — manually flagged contacts", () => {
  async function flag(contactId: string) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { conflictStatus: "flagged" },
    });
  }

  test("a flagged contact matched by name is a conflict, not a warn", async () => {
    const c = await seedContact({ name: "Rex Flagged", email: null, type: "witness" });
    await flag(c.contactId);
    const result = await runConflictMatcher({
      name: "rex  flagged",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("conflict");
    const hit = result.matches.find((m) => m.kind === "contact_flagged")!;
    expect(hit).toMatchObject({ matchedField: "name", contactId: c.contactId });
  });

  test("matched by email or organization too; inactive still counts", async () => {
    const c = await seedContact({
      name: "Someone Else",
      email: "flag@example.com",
      organization: "Flag Corp",
      type: "witness",
    });
    await flag(c.contactId);
    await prisma.contact.update({ where: { id: c.contactId }, data: { isActive: false } });

    const byEmail = await runConflictMatcher({
      name: null,
      email: "FLAG@example.com",
      organization: null,
    });
    expect(byEmail.matches.find((m) => m.kind === "contact_flagged")?.matchedField).toBe("email");

    const byOrg = await runConflictMatcher({
      name: null,
      email: null,
      organization: "flag corp",
    });
    expect(byOrg.severity).toBe("conflict");
  });

  test("the lead's own contact, when flagged, is a conflict", async () => {
    const own = await seedContact({ name: "Own Flagged", email: null, type: "client" });
    await flag(own.contactId);
    const result = await runConflictMatcher({
      name: "Own Flagged",
      email: null,
      organization: null,
      ownContactId: own.contactId,
    });
    expect(result.severity).toBe("conflict");
  });

  test("override and clear statuses don't add a hard hit", async () => {
    const c = await seedContact({ name: "Was Flagged", email: null, type: "witness" });
    await prisma.contact.update({
      where: { id: c.contactId },
      data: { conflictStatus: "override" },
    });
    const result = await runConflictMatcher({
      name: "Was Flagged",
      email: null,
      organization: null,
    });
    expect(result.severity).toBe("warn");
  });
});

describe("runAdverseConflictMatcher — adverse party vs the firm's clients", () => {
  let areaId: string;
  let stageId: string;
  beforeEach(async () => {
    const a = await seedPracticeArea();
    areaId = a.areaId;
    stageId = a.stageId;
  });

  const clientMatter = async (
    clientName: string,
    opts: { archived?: boolean; via?: "matter" | "party"; organization?: string } = {},
  ) => {
    const c = await seedContact({
      name: clientName,
      organization: opts.organization ?? null,
      type: "client",
    });
    const m = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: `${clientName} matter`,
    });
    if (opts.via === "party") {
      await seedMatterContact({ matterId: m.matterId, contactId: c.contactId, category: "client" });
    } else {
      await prisma.matter.update({ where: { id: m.matterId }, data: { clientId: c.contactId } });
    }
    if (opts.archived) {
      await prisma.matter.update({ where: { id: m.matterId }, data: { isArchived: true } });
    }
    return { contactId: c.contactId, matterId: m.matterId };
  };

  test("nothing typed → clear", async () => {
    expect(await runAdverseConflictMatcher([null, "  "])).toEqual({
      severity: "clear",
      matches: [],
    });
  });

  test("a current client (Matter.client) named as the adverse party is a conflict", async () => {
    const { matterId: hit } = await clientMatter("Acme Holdings");
    const result = await runAdverseConflictMatcher(["  acme   HOLDINGS "]);
    expect(result.severity).toBe("conflict");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      kind: "adverse_is_client",
      severity: "conflict",
      matterId: hit,
    });
  });

  test("a client party row on an active matter is a conflict", async () => {
    await clientMatter("Rita Party", { via: "party" });
    const result = await runAdverseConflictMatcher(["Rita Party"]);
    expect(result.severity).toBe("conflict");
  });

  test("each comma-separated party in the field is screened", async () => {
    await clientMatter("Officer J. Doe");
    const result = await runAdverseConflictMatcher(["City of Aurora, Officer J. Doe"]);
    expect(result.severity).toBe("conflict");
  });

  test("a client only on archived matters is a former client → warn per matter, so it can be redacted", async () => {
    const { matterId: archived } = await clientMatter("Old Client", { archived: true });
    const result = await runAdverseConflictMatcher(["Old Client"]);
    expect(result.severity).toBe("warn");
    expect(result.matches[0].matterId).toBe(archived);
    expect(result.matches[0].description).toMatch(/former client/);
  });

  test("the new matter's own client is never screened as its own adversary", async () => {
    const { contactId } = await clientMatter("Self Same");
    expect((await runAdverseConflictMatcher(["Self Same"], [contactId])).severity).toBe("clear");
  });

  test("a flagged contact matched only by organization is a warn", async () => {
    const c = await seedContact({
      name: "Flagged Employee",
      organization: "Big City",
      type: "other",
    });
    await prisma.contact.update({
      where: { id: c.contactId },
      data: { conflictStatus: "flagged" },
    });
    const result = await runAdverseConflictMatcher(["Big City"]);
    expect(result.severity).toBe("warn");
    expect(result.matches[0].kind).toBe("contact_flagged");
  });

  test("matching only a client's organization is a warn, not a conflict", async () => {
    await clientMatter("Jane Employee", { organization: "City of Aurora" });
    const result = await runAdverseConflictMatcher(["City of Aurora"]);
    expect(result.severity).toBe("warn");
    expect(result.matches[0].matchedField).toBe("organization");
  });

  test("a non-client contact with the same name is not a match", async () => {
    const w = await seedContact({ name: "Wanda Witness", type: "witness" });
    const m = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
    await seedMatterContact({ matterId: m.matterId, contactId: w.contactId, category: "witness" });
    expect((await runAdverseConflictMatcher(["Wanda Witness"])).severity).toBe("clear");
  });

  test("a flagged contact is a conflict even with no matters", async () => {
    const c = await seedContact({ name: "Flagged Foe", type: "other" });
    await prisma.contact.update({
      where: { id: c.contactId },
      data: { conflictStatus: "flagged" },
    });
    const result = await runAdverseConflictMatcher(["Flagged Foe"]);
    expect(result.severity).toBe("conflict");
    expect(result.matches[0].kind).toBe("contact_flagged");
  });

  test("merged-away contacts are excluded", async () => {
    const { contactId } = await clientMatter("Merged Away");
    const survivor = await seedContact({ name: "Survivor" });
    await prisma.contact.update({
      where: { id: contactId },
      data: { mergedIntoId: survivor.contactId },
    });
    expect((await runAdverseConflictMatcher(["Merged Away"])).severity).toBe("clear");
  });

  test("adverseNameKeys keeps the whole value and each multi-word part", () => {
    expect(
      adverseNameKeys([
        "Doe, John",
        null,
        "Acme, Inc.;  Beta Co",
        "City of Aurora, Officer J. Doe",
      ]),
    ).toEqual([
      "doe, john",
      "acme, inc.; beta co",
      "beta co",
      "city of aurora, officer j. doe",
      "city of aurora",
      "officer j. doe",
    ]);
  });
});
