import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardLayout } from "@/lib/dashboard-prefs";

const m = vi.hoisted(() => ({
  getDashboardKpis: vi.fn(),
  getFirmPulse: vi.fn(),
  getFollowUpsDueToday: vi.fn(),
  getMyOpenTasks: vi.fn(),
  getRecentActivity: vi.fn(),
  getTodayAgenda: vi.fn(),
  getUpcomingDeadlines: vi.fn(),
  getMyRecordsToChase: vi.fn(),
  currentUserHasPermission: vi.fn(),
}));

vi.mock("@/lib/queries/dashboard", () => ({
  getDashboardKpis: m.getDashboardKpis,
  getFirmPulse: m.getFirmPulse,
  getFollowUpsDueToday: m.getFollowUpsDueToday,
  getMyOpenTasks: m.getMyOpenTasks,
  getRecentActivity: m.getRecentActivity,
  getTodayAgenda: m.getTodayAgenda,
  getUpcomingDeadlines: m.getUpcomingDeadlines,
}));
vi.mock("@/lib/queries/records-requests", () => ({
  getMyRecordsToChase: m.getMyRecordsToChase,
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: m.currentUserHasPermission,
}));

import { dueTodayCount, loadDashboardData } from "./dashboard-data";

const layout = (hidden: DashboardLayout["hidden"] = []): DashboardLayout => ({
  v: 3,
  split: "8/4",
  band: ["kpis"],
  columns: [["agenda"], ["deadlines"]],
  hidden,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.getDashboardKpis.mockResolvedValue({ k: 1 });
  m.getFirmPulse.mockResolvedValue({ p: 1 });
  m.getFollowUpsDueToday.mockResolvedValue([]);
  m.getMyOpenTasks.mockResolvedValue({ today: [], total: 0 });
  m.getRecentActivity.mockResolvedValue([]);
  m.getTodayAgenda.mockResolvedValue([]);
  m.getUpcomingDeadlines.mockResolvedValue({ items: [], overdueHidden: 0 });
  m.getMyRecordsToChase.mockResolvedValue([]);
  m.currentUserHasPermission.mockResolvedValue(true);
});

describe("loadDashboardData", () => {
  it("skips loaders for hidden cards", async () => {
    await loadDashboardData(layout(["pulse", "tasks"]), "America/Chicago");
    expect(m.getFirmPulse).not.toHaveBeenCalled();
    expect(m.getMyOpenTasks).not.toHaveBeenCalled();
    for (const fn of [
      m.getDashboardKpis,
      m.getTodayAgenda,
      m.getFollowUpsDueToday,
      m.getUpcomingDeadlines,
      m.getMyRecordsToChase,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][0]).toBe("America/Chicago");
    }
    expect(m.getRecentActivity).toHaveBeenCalledWith("America/Chicago", 5);
  });

  it("records needs records.view", async () => {
    m.currentUserHasPermission.mockImplementation(
      async (k: string) => k !== "records.view",
    );
    const d = await loadDashboardData(layout(), "UTC");
    expect(m.getMyRecordsToChase).not.toHaveBeenCalled();
    expect(d.canViewRecords).toBe(false);
  });

  it("activity link needs firm.view_activity", async () => {
    m.currentUserHasPermission.mockImplementation(
      async (k: string) => k !== "firm.view_activity",
    );
    const d = await loadDashboardData(layout(), "UTC");
    expect(d.canViewActivityLog).toBe(false);
    expect(d.canViewRecords).toBe(true);
  });
});

describe("dueTodayCount", () => {
  it("sums today's tasks and deadlines due today", async () => {
    m.getMyOpenTasks.mockResolvedValue({ today: [{}, {}], total: 2 });
    m.getUpcomingDeadlines.mockResolvedValue({
      items: [{ days: 0 }, { days: 0 }, { days: 3 }],
      overdueHidden: 0,
    });
    const d = await loadDashboardData(layout(), "UTC");
    expect(dueTodayCount(d, layout())).toBe(4);
  });

  it("is null when tasks and deadlines are both hidden", async () => {
    const l = layout(["tasks", "deadlines"]);
    const d = await loadDashboardData(l, "UTC");
    expect(dueTodayCount(d, l)).toBeNull();
  });
});
