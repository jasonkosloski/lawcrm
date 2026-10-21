/**
 * Restricted intake (lead ethical walls, ADR-049) across the LIST
 * surfaces: intake queue + summary, Cmd+K, global search, dashboard
 * tasks + agenda, firm activity, calendar.
 *
 * Real Postgres. alice is on the restricted lead's team, bob is not;
 * an open lead is visible to both. Every case asserts bob doesn't see
 * the restricted lead (or its children) and alice does.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import { getLeadSummary, listLeads } from "@/lib/queries/leads";
import { getPaletteData } from "@/lib/queries/command-palette";
import { globalSearch } from "@/lib/queries/search";
import {
  getDashboardKpis,
  getFollowUpsDueToday,
  getMyOpenTasks,
  getTodayAgenda,
} from "@/lib/queries/dashboard";
import { getSidebarData } from "@/lib/queries/sidebar";
import { getFirmActivity } from "@/lib/queries/firm-activity";
import { getCalendarItems } from "@/lib/queries/calendar";
import { resetDb, seedFirm, seedLead, seedUser } from "@/test/integration-helpers";

let alice: string;
let bob: string;
let walled: string;
let open: string;

const as = (uid: string) => vi.mocked(getCurrentUserId).mockResolvedValue(uid);

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: alice } = await seedUser({ firmId }));
  ({ userId: bob } = await seedUser({ firmId }));
  ({ leadId: walled } = await seedLead({
    name: "Zephyr Walled",
    restricted: true,
    teamUserIds: [alice],
  }));
  ({ leadId: open } = await seedLead({ name: "Zephyr Open" }));
  as(bob);
});

describe("intake queue", () => {
  test("listLeads and getLeadSummary hide a restricted lead from non-members", async () => {
    const ids = async () => (await listLeads()).rows.map((r) => r.id);
    expect(await ids()).toEqual([open]);
    expect((await getLeadSummary()).activeCount).toBe(1);
    as(alice);
    expect((await ids()).sort()).toEqual([open, walled].sort());
    expect((await getLeadSummary()).activeCount).toBe(2);
  });

  test("Cmd+K lists only visible leads", async () => {
    const leadIds = async () =>
      (await getPaletteData()).items
        .filter((i) => i.kind === "lead")
        .map((i) => i.id);
    expect(await leadIds()).toEqual([open]);
    as(alice);
    expect((await leadIds()).sort()).toEqual([open, walled].sort());
  });
});

describe("global search", () => {
  test("a restricted lead and its notes, tasks and documents don't match for bob", async () => {
    await prisma.note.create({
      data: { leadId: walled, authorId: alice, content: "<p>Zephyr secret</p>" },
    });
    await prisma.task.create({ data: { title: "Zephyr call back", leadId: walled } });
    await prisma.document.create({
      data: { leadId: walled, name: "Zephyr intake.pdf", category: "intake" },
    });
    const hits = async () =>
      (await globalSearch("Zephyr")).groups.flatMap((g) =>
        g.hits.map((h) => `${g.type}:${h.id}`)
      );
    const bobHits = await hits();
    expect(bobHits).toContain(`lead:${open}`);
    expect(bobHits).not.toContain(`lead:${walled}`);
    expect(bobHits.some((h) => /^(note|task|document):/.test(h))).toBe(false);
    as(alice);
    const aliceHits = await hits();
    expect(aliceHits).toContain(`lead:${walled}`);
    expect(aliceHits.some((h) => h.startsWith("note:"))).toBe(true);
    expect(aliceHits.some((h) => h.startsWith("task:"))).toBe(true);
    expect(aliceHits.some((h) => h.startsWith("document:"))).toBe(true);
  });
});

describe("dashboard, calendar, activity", () => {
  test("a task on a restricted lead assigned to bob is not in his task list", async () => {
    await prisma.task.create({
      data: { title: "walled task", leadId: walled, ownerId: bob, status: "todo" },
    });
    await prisma.task.create({
      data: { title: "open task", leadId: open, ownerId: bob, status: "todo" },
    });
    const titles = JSON.stringify(await getMyOpenTasks("UTC"));
    expect(titles).toContain("open task");
    expect(titles).not.toContain("walled task");
  });

  test("an event on a restricted lead is Busy for bob, even as an attendee", async () => {
    const start = new Date();
    start.setUTCHours(12, 0, 0, 0);
    const event = await prisma.calendarEvent.create({
      data: {
        title: "Zephyr consult",
        leadId: walled,
        startTime: start,
        endTime: new Date(start.getTime() + 3600_000),
        createdById: alice,
        visibility: "show_details",
        attendees: { create: [{ userId: bob, name: "Bob" }] },
      },
    });
    const dayStart = new Date(start);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const item = (await getCalendarItems(dayStart, dayEnd, "UTC")).find(
      (i) => i.id === event.id
    );
    expect(item?.title).toBe("Busy");
    expect(JSON.stringify(item)).not.toContain("Zephyr");
    const agenda = JSON.stringify(await getTodayAgenda("UTC"));
    expect(agenda).not.toContain("Zephyr");
    as(alice);
    const mine = (await getCalendarItems(dayStart, dayEnd, "UTC")).find(
      (i) => i.id === event.id
    );
    expect(mine?.title).toBe("Zephyr consult");
  });

  test("firm activity rows tagged with a restricted lead are hidden from bob", async () => {
    await logActivity({
      matterId: null,
      leadId: walled,
      userId: alice,
      type: "filing",
      title: "New intake: Zephyr Walled",
    });
    await logActivity({
      matterId: null,
      leadId: open,
      userId: alice,
      type: "filing",
      title: "New intake: Zephyr Open",
    });
    const titles = async (viewerId: string) =>
      (await getFirmActivity({ viewerId })).map((r) => r.title);
    expect(await titles(bob)).toEqual(["New intake: Zephyr Open"]);
    expect((await titles(alice)).sort()).toEqual([
      "New intake: Zephyr Open",
      "New intake: Zephyr Walled",
    ]);
  });
});

describe("email threads filed to a restricted lead", () => {
  // The mailbox belongs to whoever is viewing: seed it for the current
  // viewer, filed to the walled lead, then flip the viewer's team
  // membership via who owns the mailbox.
  async function seedWalledThread(ownerId: string) {
    const account = await prisma.emailAccount.create({
      data: { userId: ownerId, emailAddress: `m-${ownerId.slice(-6)}@firm.test` },
    });
    await prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject: "Zephyr walled thread",
        leadId: walled,
        isRead: false,
        isStarred: true,
        followUpAt: new Date(Date.now() - 86_400_000),
        lastMessageAt: new Date(),
        messages: {
          create: [
            {
              fromName: "S",
              fromEmail: "s@example.com",
              toRecipients: "[]",
              body: "Zephyr body text",
              sentAt: new Date(),
            },
          ],
        },
      },
    });
  }

  test("KPIs, follow-ups, sidebar badge and search hide it from a non-member and show it to a member", async () => {
    await seedWalledThread(bob);
    await seedWalledThread(alice);

    as(bob);
    const kpi = await getDashboardKpis("UTC");
    expect(kpi.unreadEmail).toBe(0);
    expect(kpi.flaggedEmail).toBe(0);
    expect(JSON.stringify(await getFollowUpsDueToday("UTC"))).not.toContain("Zephyr");
    expect((await getSidebarData()).unreadEmailCount).toBe(0);
    const bobHits = JSON.stringify((await globalSearch("Zephyr")).groups.filter((g) => g.type === "email"));
    expect(bobHits).not.toContain("walled thread");

    as(alice);
    const kpiA = await getDashboardKpis("UTC");
    expect(kpiA.unreadEmail).toBe(1);
    expect(kpiA.flaggedEmail).toBe(1);
    expect(JSON.stringify(await getFollowUpsDueToday("UTC"))).toContain("Zephyr walled thread");
    expect((await getSidebarData()).unreadEmailCount).toBe(1);
    const aliceHits = JSON.stringify((await globalSearch("Zephyr")).groups.filter((g) => g.type === "email"));
    expect(aliceHits).toContain("walled thread");
  });
});
