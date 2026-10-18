/**
 * /intake/[id]/tasks — composer gating, lead scope, and the matter-only
 * row actions staying off.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RecordScope } from "@/lib/record-scope";
import type { TaskRowPerms } from "@/components/tasks/task-list-by-status";

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
  getCurrentUserId: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    task: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/queries/matter-detail", () => ({
  getLeadTasks: vi.fn(async () => []),
}));
vi.mock("@/lib/queries/team", () => ({
  listAssigneeOptions: vi.fn(async () => []),
}));
vi.mock("@/components/matters/captures/task-composer", () => ({
  TaskComposer: ({
    scope,
    siblingKinds,
  }: {
    scope: RecordScope;
    siblingKinds: string[];
  }) => (
    <div
      data-testid="task-composer"
      data-scope={JSON.stringify(scope)}
      data-kinds={siblingKinds.join(",")}
    />
  ),
}));
vi.mock("@/components/tasks/task-list-by-status", () => ({
  TaskListByStatus: ({
    matterId,
    perms,
  }: {
    matterId: string | null;
    perms: TaskRowPerms;
  }) => (
    <div
      data-testid="task-list"
      data-matter={String(matterId)}
      data-perms={JSON.stringify(perms)}
    />
  ),
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getLeadTasks } from "@/lib/queries/matter-detail";
import LeadTasksPage from "./page";

const lead = (stage: string, convertedMatterId: string | null = null) =>
  vi
    .mocked(prisma.lead.findUnique)
    .mockResolvedValue({ stage, convertedMatterId } as never);

const grant = (...keys: string[]) =>
  vi
    .mocked(currentUserHasPermission)
    .mockImplementation(async (key: string) => keys.includes(key));

const renderPage = async () => {
  const ui = await LeadTasksPage({
    params: Promise.resolve({ id: "lead_1" }),
  } as Parameters<typeof LeadTasksPage>[0]);
  return render(ui ?? <></>);
};

afterEach(() => vi.clearAllMocks());

describe("LeadTasksPage", () => {
  test("tasks.create: lead-scoped composer with no siblings; matter-only row actions off", async () => {
    lead("qualifying");
    grant("tasks.create", "tasks.edit", "tasks.delete", "time_entries.create");
    await renderPage();
    const composer = screen.getByTestId("task-composer");
    expect(JSON.parse(composer.getAttribute("data-scope")!)).toEqual({
      kind: "lead",
      leadId: "lead_1",
    });
    expect(composer.getAttribute("data-kinds")).toBe("");
    expect(getLeadTasks).toHaveBeenCalledWith("lead_1");
    const list = screen.getByTestId("task-list");
    expect(list.getAttribute("data-matter")).toBe("null");
    expect(JSON.parse(list.getAttribute("data-perms")!)).toEqual({
      canEdit: true,
      canDelete: true,
      canLogTime: false,
      canAddNote: false,
      canConvert: false,
    });
  });

  test("no tasks.create: no composer", async () => {
    lead("new");
    grant("tasks.edit");
    await renderPage();
    expect(screen.queryByTestId("task-composer")).toBeNull();
  });

  test("converted lead: pointer to the matter's tasks, no composer", async () => {
    lead("converted", "m_9");
    grant("tasks.create");
    await renderPage();
    expect(screen.queryByTestId("task-composer")).toBeNull();
    expect(
      screen.getByRole("link", { name: /open matter tasks/i }).getAttribute("href")
    ).toBe("/matters/m_9/tasks");
  });
});
