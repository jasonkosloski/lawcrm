import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/actions/time-on-entity", () => ({ addTimeEntryToTask: vi.fn() }));
vi.mock("@/app/actions/note-on-entity", () => ({ addNoteToTask: vi.fn() }));

import { KpisCard } from "./kpis";
import { AgendaCard } from "./agenda";
import { TasksCard } from "./tasks";
import { FollowUpsCard } from "./follow-ups";
import { ActivityCard } from "./activity";
import { DeadlinesCard } from "./deadlines";
import { PulseCard } from "./pulse";
import { RecordsCard } from "./records";
import type { DashboardKpis, MyTaskItem, MyTasksGrouped } from "@/lib/queries/dashboard";

const kpis: DashboardKpis = {
  openMatters: 12,
  openMattersChange: "+2 this month",
  unreadEmail: 4,
  flaggedEmail: 1,
  hoursToday: 3,
  hoursGoal: 8,
  trustBalance: 12000,
  trustMatterCount: 3,
};

const task = (over: Partial<MyTaskItem> = {}): MyTaskItem => ({
  id: "t1",
  title: "File motion",
  priority: "normal",
  dueDate: new Date("2026-10-19T00:00:00Z"),
  daysUntilDue: -1,
  matterId: "m1",
  matterName: "Smith v. Jones",
  leadId: null,
  ...over,
});

const tasks = (over: Partial<MyTasksGrouped> = {}): MyTasksGrouped => ({
  overdue: [task()],
  today: [],
  thisWeek: [],
  later: [],
  noDueDate: [],
  total: 1,
  overdueCount: 1,
  hidden: 0,
  ...over,
});

const noViewAll = () => screen.queryByRole("link", { name: /view all/i });

describe("KpisCard", () => {
  test("renders stats with v2 copy and links", () => {
    render(<KpisCard kpis={kpis} />);
    expect(screen.getByText("Goal 8.0")).toBeTruthy();
    expect(screen.getByText("Hours today").closest("a")?.getAttribute("href")).toBe("/time");
    expect(screen.getByText("Unread email").closest("a")?.getAttribute("href")).toBe(
      "/communication?filter=unread",
    );
  });

  test("trust tile absent when trustBalance is null", () => {
    const { rerender } = render(<KpisCard kpis={kpis} />);
    expect(screen.getByText("Trust balance")).toBeTruthy();
    rerender(<KpisCard kpis={{ ...kpis, trustBalance: null }} />);
    expect(screen.queryByText("Trust balance")).toBeNull();
  });
});

describe("view-all links", () => {
  test("agenda", () => {
    render(<AgendaCard items={[]} />);
    expect(screen.getByRole("link", { name: /view all/i }).getAttribute("href")).toBe(
      "/calendar?view=day",
    );
  });
  test("deadlines", () => {
    render(<DeadlinesCard data={{ items: [], overdueHidden: 0 }} />);
    expect(screen.getByRole("link", { name: /view all/i }).getAttribute("href")).toBe(
      "/calendar?show=deadlines",
    );
  });
  test("follow-ups", () => {
    render(<FollowUpsCard items={[]} />);
    expect(screen.getByRole("link", { name: /view all/i }).getAttribute("href")).toBe(
      "/communication",
    );
  });
  test("activity only with canViewActivityLog", () => {
    const { rerender } = render(<ActivityCard items={[]} canViewActivityLog />);
    expect(screen.getByRole("link", { name: /view all/i }).getAttribute("href")).toBe(
      "/settings/activity",
    );
    rerender(<ActivityCard items={[]} canViewActivityLog={false} />);
    expect(noViewAll()).toBeNull();
  });
  test("tasks and records have none", () => {
    const { unmount } = render(<TasksCard tasks={tasks()} />);
    expect(noViewAll()).toBeNull();
    unmount();
    render(<RecordsCard items={[]} />);
    expect(noViewAll()).toBeNull();
  });
});

describe("late treatment", () => {
  test("deadline late label is danger", () => {
    render(
      <DeadlinesCard
        data={{
          items: [
            {
              id: "d1",
              title: "Answer due",
              days: -2,
              kind: "manual",
              matterId: "m1",
              matterName: "Smith",
              dueDate: new Date("2026-10-14T00:00:00Z"),
            },
          ],
          overdueHidden: 0,
        }}
      />,
    );
    expect(screen.getByText("2d late").closest(".text-danger")).toBeTruthy();
  });

  test("task late label is danger", () => {
    render(<TasksCard tasks={tasks()} />);
    expect(screen.getByText("1d late").closest(".text-danger")).toBeTruthy();
  });

  test("follow-up and records late labels are danger", () => {
    render(
      <FollowUpsCard
        items={[
          {
            id: "f1",
            kind: "email",
            label: "Re: hearing",
            followUpAt: new Date(),
            isOverdue: true,
            matterName: null,
            matterColor: null,
          },
        ]}
      />,
    );
    expect(screen.getByText(/Late/).closest(".text-danger")).toBeTruthy();
    render(
      <RecordsCard
        items={[
          {
            id: "r1",
            subject: "Chart",
            custodianName: "Clinic",
            href: "/x",
            label: "3d overdue",
            context: "Smith",
          },
        ]}
      />,
    );
    expect(screen.getByText("3d overdue").closest(".text-danger")).toBeTruthy();
  });
});

describe("empty states and nulls", () => {
  test("empty texts preserved", () => {
    render(<AgendaCard items={[]} />);
    expect(screen.getByText("No events scheduled for today.")).toBeTruthy();
  });

  test("PulseCard renders nothing when pulse is null", () => {
    const { container } = render(<PulseCard pulse={null} />);
    expect(container.innerHTML).toBe("");
  });

  test("PulseCard renders figures", () => {
    render(
      <PulseCard
        pulse={{
          billableMtd: 10,
          billableGoal: 100,
          collectionRate: 0,
          arOutstanding: 2500,
        }}
      />,
    );
    expect(screen.getByText("$2,500")).toBeTruthy();
    expect(screen.getByText("10.0h")).toBeTruthy();
  });
});
