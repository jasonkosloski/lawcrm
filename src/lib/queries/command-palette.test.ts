/**
 * Integration tests for the command-palette data fetch.
 *
 * `getPaletteData` fires on every palette open and now runs with
 * narrow `select` projections plus a 500-row cap per kind (matters /
 * contacts / leads / users). These tests pin:
 *
 *   1. Shape — every kind still maps to its Palette* fields after
 *      the include→select refactor (a dropped select column comes
 *      back as a runtime `undefined`, which TypeScript can't catch
 *      because the mapping reads it dynamically off the row).
 *
 *   2. Per-user pins — `isPinned` reflects the CALLER's pins only,
 *      not any other user's.
 *
 *   3. Filters — archived matters, inactive contacts/users, and
 *      converted/declined leads never reach the palette.
 *
 *   4. The cap — each kind returns at most 500 rows, and the rows
 *      that survive are the most-recently-updated ones (the stalest
 *      rows are the ones least likely to be reached for).
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getPaletteData } from "@/lib/queries/command-palette";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let userId: string;
let areaId: string;
let stageId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  const u = await seedUser({
    firmId,
    name: "Paula Palette",
    initials: "PP",
    jobTitle: "Attorney",
  });
  userId = u.userId;
  mockedGetUser.mockResolvedValue(userId);
  const a = await seedPracticeArea({ name: "Injury" });
  areaId = a.areaId;
  stageId = a.stageId;
});

describe("getPaletteData", () => {
  test("maps every kind to its palette fields", async () => {
    const { contactId } = await seedContact({
      name: "Cora Client",
      email: "cora@example.com",
      organization: "Acme Co",
      type: "client",
    });
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Client v. Acme",
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: { clientId: contactId, caseNumber: "2026-CV-001" },
    });
    await prisma.userMatterPin.create({ data: { userId, matterId } });
    const { leadId } = await seedLead({
      name: "Larry Lead",
      email: "larry@example.com",
    });

    const data = await getPaletteData();

    expect(
      data.items.find((i) => i.kind === "matter" && i.id === matterId)
    ).toEqual({
      kind: "matter",
      id: matterId,
      name: "Client v. Acme",
      caseNumber: "2026-CV-001",
      area: "Injury",
      stage: "Intake",
      color: "#2563a8", // schema default — pins that `color` survived the select
      clientName: "Cora Client",
      isPinned: true,
    });
    expect(
      data.items.find((i) => i.kind === "contact" && i.id === contactId)
    ).toEqual({
      kind: "contact",
      id: contactId,
      name: "Cora Client",
      email: "cora@example.com",
      organization: "Acme Co",
      contactType: "client",
    });
    expect(
      data.items.find((i) => i.kind === "lead" && i.id === leadId)
    ).toEqual({
      kind: "lead",
      id: leadId,
      name: "Larry Lead",
      email: "larry@example.com",
      stage: "new",
    });
    expect(
      data.items.find((i) => i.kind === "user" && i.id === userId)
    ).toEqual({
      kind: "user",
      id: userId,
      name: "Paula Palette",
      initials: "PP",
      jobTitle: "Attorney",
    });
  });

  test("isPinned reflects the caller's pins, not other users'", async () => {
    const other = await seedUser({ firmId, name: "Someone Else" });
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.userMatterPin.create({
      data: { userId: other.userId, matterId },
    });

    const data = await getPaletteData();

    const matter = data.items.find(
      (i) => i.kind === "matter" && i.id === matterId
    );
    expect(matter).toMatchObject({ isPinned: false });
  });

  test("excludes archived matters, inactive contacts/users, closed leads", async () => {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Old Case",
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: { isArchived: true },
    });
    const { contactId } = await seedContact({
      name: "Gone Contact",
      isActive: false,
    });
    const { userId: exUserId } = await seedUser({
      firmId,
      name: "Ex Employee",
      isActive: false,
    });
    const converted = await prisma.lead.create({
      data: { name: "Converted Lead", stage: "converted" },
      select: { id: true },
    });
    const declined = await prisma.lead.create({
      data: { name: "Declined Lead", stage: "declined" },
      select: { id: true },
    });

    const data = await getPaletteData();

    const ids = new Set(data.items.map((i) => i.id));
    expect(ids.has(matterId)).toBe(false);
    expect(ids.has(contactId)).toBe(false);
    expect(ids.has(exUserId)).toBe(false);
    expect(ids.has(converted.id)).toBe(false);
    expect(ids.has(declined.id)).toBe(false);
  });

  test("caps each kind at 500 rows, keeping the most-recently-updated", async () => {
    // 502 rows per kind, with `updatedAt` spread one minute apart so
    // the cap has a deterministic cut line: index 0 and 1 are the
    // stalest and must fall off; index 501 is the freshest and must
    // survive. (Prisma lets an explicit `updatedAt` override the
    // @updatedAt default on create.)
    const stamp = (i: number) =>
      new Date(Date.UTC(2026, 0, 1) + i * 60_000);
    const idx = Array.from({ length: 502 }, (_, i) => i);
    await prisma.contact.createMany({
      data: idx.map((i) => ({
        name: `c-${i}`,
        type: "client",
        updatedAt: stamp(i),
      })),
    });
    await prisma.lead.createMany({
      data: idx.map((i) => ({ name: `l-${i}`, updatedAt: stamp(i) })),
    });
    await prisma.user.createMany({
      data: idx.map((i) => ({
        email: `u-${i}@example.com`,
        name: `u-${i}`,
        initials: "UU",
        jobTitle: "Attorney",
        firmId,
        updatedAt: stamp(i),
      })),
    });
    await prisma.matter.createMany({
      data: idx.map((i) => ({
        name: `m-${i}`,
        practiceAreaId: areaId,
        stageId,
        feeStructure: "hourly",
        updatedAt: stamp(i),
      })),
    });

    const data = await getPaletteData();

    const byKind = (kind: string) =>
      data.items.filter((i) => i.kind === kind);
    expect(byKind("contact")).toHaveLength(500);
    expect(byKind("lead")).toHaveLength(500);
    expect(byKind("matter")).toHaveLength(500);
    // The beforeEach seed user is fresher than every u-* row (its
    // @updatedAt is "now"), so it takes one of the 500 slots.
    expect(byKind("user")).toHaveLength(500);

    const contactNames = new Set(byKind("contact").map((c) => c.name));
    expect(contactNames.has("c-501")).toBe(true); // freshest survives
    expect(contactNames.has("c-1")).toBe(false); // stalest fall off
    expect(contactNames.has("c-0")).toBe(false);
  });
});
