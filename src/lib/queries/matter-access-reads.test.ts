/**
 * Two-user integration tests for matter-team access ("ethical walls")
 * on the READ queries: matters list / count / filter options / detail,
 * global search, the command palette, the sidebar, and the trust
 * (billing.view) gap on the matters list.
 *
 * Alice is the lead of "Alpha Matter"; Bob is the lead of "Bravo
 * Matter". In TEAM mode neither sees the other's matter; a
 * `matters.view_all` holder and FIRM mode see both; a removed member
 * loses access.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let sessionUser = "";
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => sessionUser),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));

import { prisma } from "@/lib/prisma";
import {
  countMatters,
  getMatterById,
  getMattersFilterOptions,
  listMatters,
} from "@/lib/queries/matters";
import { globalSearch } from "@/lib/queries/search";
import { getPaletteData } from "@/lib/queries/command-palette";
import { getSidebarData } from "@/lib/queries/sidebar";
import {
  HIDDEN_MATTER_NOTIFICATION_TITLE,
  getNotificationsBell,
  getNotificationsFeed,
} from "@/lib/queries/notifications";
import { listMessengerThreads } from "@/lib/queries/messenger";
import { EMPTY_FILTER } from "@/lib/matters-filters";
import {
  resetDb,
  seedFirm,
  seedPracticeArea,
  seedUser,
  seedMatter,
} from "@/test/integration-helpers";

let firmId: string;
let defaultRoleId: string;
let alice: string;
let bob: string;
let alphaId: string;
let bravoId: string;
let areaId: string;
let stageId: string;

const setMode = (mode: "FIRM" | "TEAM") =>
  prisma.firm.update({ where: { id: firmId }, data: { matterVisibility: mode } });

const asUser = (id: string) => {
  sessionUser = id;
};

async function grant(userId: string, permission: string) {
  const role = await prisma.role.create({
    data: { firmId, name: `r-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permission },
  });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
}

const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name).sort();

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  ({ firmId, defaultRoleId } = await seedFirm());
  ({ userId: alice } = await seedUser({
    firmId,
    name: "Alice",
    initials: "AL",
    roleIds: [defaultRoleId],
  }));
  ({ userId: bob } = await seedUser({
    firmId,
    name: "Bob",
    initials: "BO",
    roleIds: [defaultRoleId],
  }));
  ({ areaId, stageId } = await seedPracticeArea());
  ({ matterId: alphaId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: alice,
    name: "Alpha Matter zebra",
  }));
  ({ matterId: bravoId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: bob,
    name: "Bravo Matter zebra",
  }));
  // Content on Bravo (hidden from Alice in TEAM mode).
  await prisma.note.create({
    data: { matterId: bravoId, content: "<p>zebra strategy memo</p>", authorId: bob },
  });
  await prisma.timeEntry.create({
    data: {
      matterId: bravoId,
      userId: bob,
      date: new Date("2026-06-30T00:00:00Z"),
      hours: 1,
      activity: "Zebra strategy",
      narrative: "zebra privileged narrative",
      privileged: true,
    },
  });
  asUser(alice);
});

describe("TEAM mode — matters list", () => {
  beforeEach(() => setMode("TEAM"));

  test("listMatters / countMatters show only the viewer's matters", async () => {
    const { rows } = await listMatters(EMPTY_FILTER, undefined, alice, "UTC");
    expect(names(rows)).toEqual(["Alpha Matter zebra"]);
    expect(await countMatters(EMPTY_FILTER, alice, "UTC")).toBe(1);
    const { rows: bobRows } = await listMatters(EMPTY_FILTER, undefined, bob, "UTC");
    expect(names(bobRows)).toEqual(["Bravo Matter zebra"]);
  });

  test("a matters.view_all holder sees everything", async () => {
    await grant(alice, "matters.view_all");
    expect(await countMatters(EMPTY_FILTER, alice, "UTC")).toBe(2);
  });

  test("FIRM mode shows everything", async () => {
    await setMode("FIRM");
    expect(await countMatters(EMPTY_FILTER, alice, "UTC")).toBe(2);
  });

  test("a removed member loses the matter", async () => {
    await prisma.matterTeamMember.update({
      where: { matterId_userId: { matterId: alphaId, userId: alice } },
      data: { removedAt: new Date() },
    });
    expect(await countMatters(EMPTY_FILTER, alice, "UTC")).toBe(0);
  });

  test("filter options do not leak other leads", async () => {
    const opts = await getMattersFilterOptions(alice);
    expect(opts.leads.map((l) => l.name)).toEqual(["Alice"]);
  });

  test("getMatterById returns null for a hidden matter", async () => {
    expect(await getMatterById(bravoId)).toBeNull();
    expect((await getMatterById(alphaId))?.id).toBe(alphaId);
  });
});

describe("trust column (billing.view, ADR-038)", () => {
  beforeEach(async () => {
    await prisma.matter.update({
      where: { id: alphaId },
      data: { trustBalance: 5000 },
    });
  });

  test("without billing.view the balance is withheld and trust sort/filter are ignored", async () => {
    const { rows } = await listMatters(
      { ...EMPTY_FILTER, trust: "has" },
      { field: "trust", dir: "desc" },
      alice,
      "UTC",
    );
    // Filter ignored: Bravo (zero trust) is still listed.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.trustBalance === null)).toBe(true);
    expect(await countMatters({ ...EMPTY_FILTER, trust: "has" }, alice, "UTC")).toBe(2);
  });

  test("with billing.view the balance, sort and filter work", async () => {
    await grant(alice, "billing.view");
    const { rows } = await listMatters(
      { ...EMPTY_FILTER, trust: "has" },
      { field: "trust", dir: "desc" },
      alice,
      "UTC",
    );
    expect(rows.map((r) => [r.name, r.trustBalance])).toEqual([["Alpha Matter zebra", 5000]]);
  });
});

describe("TEAM mode — global search", () => {
  beforeEach(() => setMode("TEAM"));

  test("hides hidden matters' matter, note and time hits", async () => {
    const res = await globalSearch("zebra");
    const types = res.groups.map((g) => g.type);
    expect(types).toContain("matter");
    expect(types).not.toContain("note");
    expect(types).not.toContain("time");
    const matterGroup = res.groups.find((g) => g.type === "matter")!;
    expect(matterGroup.total).toBe(1);
    expect(JSON.stringify(res)).not.toContain("Bravo");
  });

  test("a team member finds a colleague's privileged narrative", async () => {
    await prisma.matterTeamMember.create({
      data: { matterId: bravoId, userId: alice, role: "paralegal" },
    });
    const res = await globalSearch("privileged narrative");
    const time = res.groups.find((g) => g.type === "time");
    expect(time?.hits).toHaveLength(1);
    expect(time!.hits[0].snippet).toContain("narrative");
    // ...and a user without access never sees it.
    asUser(bob);
    await prisma.matterTeamMember.deleteMany({ where: { matterId: bravoId, userId: bob } });
    const hidden = await globalSearch("privileged narrative");
    expect(hidden.groups.find((g) => g.type === "time")).toBeUndefined();
  });

  test("FIRM mode finds everything", async () => {
    await setMode("FIRM");
    const res = await globalSearch("zebra");
    expect(res.groups.find((g) => g.type === "matter")?.total).toBe(2);
    expect(res.groups.find((g) => g.type === "note")?.total).toBe(1);
  });
});

describe("TEAM mode — palette, sidebar, notifications, messenger", () => {
  beforeEach(() => setMode("TEAM"));

  test("palette lists only accessible matters", async () => {
    const data = await getPaletteData();
    const matters = data.items.filter((i) => i.kind === "matter");
    expect(matters.map((m) => m.name)).toEqual(["Alpha Matter zebra"]);
  });

  test("sidebar counts and pins respect access", async () => {
    await prisma.userMatterPin.create({ data: { userId: alice, matterId: alphaId } });
    await prisma.userMatterPin.create({ data: { userId: alice, matterId: bravoId } });
    const side = await getSidebarData();
    expect(side.openMatterCount).toBe(1);
    expect(side.areaCounts.reduce((n, a) => n + a.count, 0)).toBe(1);
    expect(side.pinnedMatters.map((p) => p.name)).toEqual(["Alpha Matter zebra"]);
  });

  test("notification feed redacts a hidden matter's name, title, body and link", async () => {
    await prisma.notification.create({
      data: {
        userId: alice,
        type: "matter",
        title: "Added to Bravo Matter as Paralegal",
        body: "Bravo Matter · $1,200.00",
        link: `/matters/${bravoId}`,
        matterId: bravoId,
      },
    });
    await prisma.notification.create({
      data: {
        userId: alice,
        type: "matter",
        title: "Visible one",
        body: "kept",
        matterId: alphaId,
      },
    });
    const feed = await getNotificationsFeed(1);
    const hidden = feed.rows.find((r) => r.matterId === bravoId)!;
    expect(hidden).toMatchObject({
      title: HIDDEN_MATTER_NOTIFICATION_TITLE,
      body: null,
      link: null,
      matterName: null,
    });
    expect(JSON.stringify(feed.rows)).not.toContain("Bravo");
    const shown = feed.rows.find((r) => r.matterId === alphaId)!;
    expect(shown).toMatchObject({ title: "Visible one", body: "kept" });
  });

  test("notification bell redacts hidden-matter text too", async () => {
    await prisma.notification.create({
      data: {
        userId: alice,
        type: "matter",
        title: "Payment on Bravo Matter",
        matterId: bravoId,
      },
    });
    const bell = await getNotificationsBell();
    expect(bell.recent[0].title).toBe(HIDDEN_MATTER_NOTIFICATION_TITLE);
  });

  test("messenger threads default-routed to a hidden matter are hidden", async () => {
    const account = await prisma.messengerAccount.create({
      data: { provider: "manual", phoneNumber: "+13035550100" },
      select: { id: true },
    });
    await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+13035550111",
        defaultMatterId: bravoId,
        lastItemAt: new Date(),
      },
    });
    await prisma.messengerThread.create({
      data: {
        accountId: account.id,
        contactPhone: "+13035550122",
        lastItemAt: new Date(),
      },
    });
    const { rows: threads } = await listMessengerThreads();
    expect(threads.map((t) => t.contactPhone)).toEqual(["+13035550122"]);
  });
});
