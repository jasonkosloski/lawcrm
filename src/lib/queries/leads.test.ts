/**
 * Integration tests for the intake queries.
 *
 * Pins:
 *   - listLeads never lets closed (converted / declined) history push an
 *     older, still-open lead out of the queue.
 *   - the statute figure is a live countdown from the stored intake-day
 *     snapshot, counted on the viewer's calendar.
 *   - the header summary resolves "new today" on the viewer's day (not the
 *     server's) and counts conflicts on OPEN leads only.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const tzMock = vi.hoisted(() => ({ tz: "America/Denver" }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => tzMock.tz),
}));

import { prisma } from "@/lib/prisma";
import {
  getLeadById,
  getLeadSummary,
  leadAgeDays,
  listLeads,
  statuteDaysRemaining,
} from "@/lib/queries/leads";
import { resetDb } from "@/test/integration-helpers";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  tzMock.tz = "America/Denver";
  await resetDb();
});

const lead = (data: {
  name: string;
  stage?: string;
  createdAt?: Date;
  statuteWindow?: number | null;
  conflictCheck?: string;
}) =>
  prisma.lead.create({
    data: { stage: "new", ...data },
    select: { id: true },
  });

describe("statute countdown (pure helpers)", () => {
  // 2026-04-28T02:00Z = Apr 27 8 PM in Denver, Apr 28 in UTC.
  const created = new Date("2026-04-20T18:00:00Z");
  const now = new Date("2026-04-28T02:00:00Z");

  test("ages by the viewer's calendar day, not by 24h blocks", () => {
    expect(leadAgeDays(created, "America/Denver", now)).toBe(7);
    expect(leadAgeDays(created, "UTC", now)).toBe(8);
  });

  test("the snapshot counts down with age", () => {
    expect(statuteDaysRemaining(340, created, "America/Denver", now)).toBe(333);
    expect(statuteDaysRemaining(null, created, "America/Denver", now)).toBeNull();
  });

  test("goes negative once the window has run", () => {
    expect(statuteDaysRemaining(5, created, "America/Denver", now)).toBe(-2);
  });

  test("a future createdAt never ages below zero", () => {
    expect(
      leadAgeDays(new Date("2026-05-01T00:00:00Z"), "America/Denver", now)
    ).toBe(0);
  });
});

describe("listLeads", () => {
  test("an old open lead survives more than 200 newer closed leads", async () => {
    const old = await lead({
      name: "Old hold lead",
      stage: "hold",
      createdAt: new Date("2025-01-01T12:00:00Z"),
    });
    await prisma.lead.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        name: `Closed ${i}`,
        stage: i % 2 ? "converted" : "declined",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    });

    const rows = await listLeads(new Date("2026-04-28T02:00:00Z"));
    const found = rows.find((r) => r.id === old.id);
    expect(found).toBeDefined();
    expect(found!.isActive).toBe(true);
    // Closed history stays bounded.
    expect(rows.filter((r) => !r.isActive).length).toBe(200);
    // Agrees with the header's uncapped count.
    expect(rows.filter((r) => r.isActive).length).toBe(
      (await getLeadSummary()).activeCount
    );
  });

  test("statuteDaysRemaining counts down from the intake-day snapshot", async () => {
    const l = await lead({
      name: "Countdown",
      createdAt: new Date("2026-04-20T18:00:00Z"),
      statuteWindow: 40,
    });
    const rows = await listLeads(new Date("2026-04-28T02:00:00Z"));
    const row = rows.find((r) => r.id === l.id)!;
    expect(row.statuteWindow).toBe(40); // raw snapshot untouched
    expect(row.statuteDaysRemaining).toBe(33);
    expect(row.ageDays).toBe(7);
  });

  test("a lead without a statute window has no countdown", async () => {
    const l = await lead({ name: "No statute" });
    const row = (await listLeads()).find((r) => r.id === l.id)!;
    expect(row.statuteDaysRemaining).toBeNull();
  });
});

describe("getLeadById", () => {
  test("exposes the live statute countdown", async () => {
    const l = await lead({
      name: "Detail",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      statuteWindow: 100,
    });
    const detail = await getLeadById(l.id);
    expect(detail!.statuteWindow).toBe(100);
    // 10 days ago in any zone, give or take the day boundary.
    expect([89, 90, 91]).toContain(detail!.statuteDaysRemaining);
  });
});

describe("getLeadSummary", () => {
  test("'new today' rolls over at the viewer's midnight, not the server's", async () => {
    // Denver: Apr 27 8 PM. UTC already says Apr 28.
    const now = new Date("2026-04-28T02:00:00Z");
    // 9 AM Denver on Apr 27 (15:00Z): "today" for the Denver viewer.
    await lead({ name: "Morning", createdAt: new Date("2026-04-27T15:00:00Z") });
    // 11 PM Denver on Apr 26 (05:00Z Apr 27): yesterday for Denver.
    await lead({ name: "Late yesterday", createdAt: new Date("2026-04-27T05:00:00Z") });

    const denver = await getLeadSummary(now);
    expect(denver.newTodayCount).toBe(1);

    // The same instant for a UTC viewer is already Apr 28 — neither lead
    // was created "today" for them.
    tzMock.tz = "UTC";
    const utc = await getLeadSummary(now);
    expect(utc.newTodayCount).toBe(0);
  });

  test("conflict count covers open leads only", async () => {
    await lead({ name: "Open warn", conflictCheck: "warn" });
    await lead({ name: "Open conflict", stage: "qualifying", conflictCheck: "conflict" });
    await lead({ name: "Converted warn", stage: "converted", conflictCheck: "warn" });
    await lead({ name: "Declined conflict", stage: "declined", conflictCheck: "conflict" });
    await lead({ name: "Clear", conflictCheck: "clear" });

    const s = await getLeadSummary();
    expect(s.conflictCount).toBe(2);
    expect(s.activeCount).toBe(3);
    expect(s.convertedCount).toBe(1);
  });
});
