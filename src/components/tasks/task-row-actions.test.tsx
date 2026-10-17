/**
 * Tests for TaskStatusToggle / TaskRowMenu / DashboardTaskRow.
 *
 * Pins:
 *   - a refused action (task already deleted, etc.) shows the server's
 *     message instead of failing silently
 *   - each control is hidden from a viewer without its permission (a
 *     denied server action redirects to `/` and discards their input)
 *   - "Convert to deadline" is prefilled with the task's stored calendar
 *     day (ADR-012) - it used to run browser-local getters over a Date
 *     and pre-fill the previous day west of UTC
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/tasks", () => ({
  deleteTask: vi.fn(),
  setTaskStatus: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock("@/app/actions/time-on-entity", () => ({
  addTimeEntryToTask: vi.fn(),
}));
vi.mock("@/app/actions/note-on-entity", () => ({
  addNoteToTask: vi.fn(),
}));
vi.mock("@/app/actions/conversions", () => ({
  convertTaskToDeadline: vi.fn(),
  convertNoteToTask: vi.fn(),
  convertNoteToDeadline: vi.fn(),
  convertEmailToTask: vi.fn(),
  convertEmailToDeadline: vi.fn(),
  convertMessengerToTask: vi.fn(),
  convertMessengerToDeadline: vi.fn(),
  convertEventToTask: vi.fn(),
  convertEventToDeadline: vi.fn(),
  convertDeadlineToTask: vi.fn(),
}));

import { deleteTask, setTaskStatus } from "@/app/actions/tasks";
import { TaskRowMenu, TaskStatusToggle } from "./task-row-actions";
import { DashboardTaskRow } from "./dashboard-task-row";
import type { EditableTask } from "./edit-task-dialog";

const task: EditableTask = {
  id: "t1",
  title: "Draft MSJ",
  description: null,
  priority: "normal",
  status: "open",
  ownerId: null,
  dueDateKey: "2026-10-16",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const all = {
  canEdit: true,
  canDelete: true,
  canLogTime: true,
  canAddNote: true,
  canConvert: true,
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  vi.mocked(deleteTask).mockReset();
  vi.mocked(setTaskStatus).mockReset();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("TaskStatusToggle", () => {
  test("shows the server error when the status change is refused", async () => {
    vi.mocked(setTaskStatus).mockResolvedValue({
      ok: false,
      error: "Task not found",
    });
    const user = setupUser();
    render(<TaskStatusToggle taskId="t1" status="open" canEdit />);
    await user.click(screen.getByRole("button", { name: /mark task done/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Task not found")
    );
  });

  test("without tasks.edit it is a read-only indicator, not a button", () => {
    render(<TaskStatusToggle taskId="t1" status="done" canEdit={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TaskRowMenu", () => {
  test("shows the server error when a delete is refused", async () => {
    vi.mocked(deleteTask).mockResolvedValue({
      ok: false,
      error: "Task not found",
    });
    const user = setupUser();
    render(<TaskRowMenu task={task} assignees={[]} {...all} />);
    await user.click(screen.getByRole("button", { name: /task actions/i }));
    await user.click(await screen.findByText("Delete"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Task not found")
    );
  });

  test("a viewer with only tasks.edit sees Edit and statuses, nothing else", async () => {
    const user = setupUser();
    render(
      <TaskRowMenu
        task={task}
        assignees={[]}
        canEdit
        canDelete={false}
        canLogTime={false}
        canAddNote={false}
        canConvert={false}
      />
    );
    await user.click(screen.getByRole("button", { name: /task actions/i }));
    await screen.findByText("Edit");
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.queryByText(/log time/i)).toBeNull();
    expect(screen.queryByText(/add note/i)).toBeNull();
    expect(screen.queryByText(/convert to deadline/i)).toBeNull();
  });

  test("a viewer with no task permission gets no kebab", () => {
    render(
      <TaskRowMenu
        task={task}
        assignees={[]}
        canEdit={false}
        canDelete={false}
        canLogTime={false}
        canAddNote={false}
        canConvert={false}
      />
    );
    expect(screen.queryByRole("button", { name: /task actions/i })).toBeNull();
  });

  test("Convert to deadline is prefilled with the stored calendar day", async () => {
    const user = setupUser();
    render(<TaskRowMenu task={task} assignees={[]} {...all} />);
    await user.click(screen.getByRole("button", { name: /task actions/i }));
    await user.click(await screen.findByText("Convert to deadline"));
    const due = await screen.findByLabelText(/due date/i);
    expect((due as HTMLInputElement).value).toBe("2026-10-16");
  });
});

describe("DashboardTaskRow", () => {
  const base = {
    id: "t1",
    title: "Draft MSJ",
    priority: "normal",
    matterId: "m1",
    matterName: "Smith v. City",
    daysUntilDue: 3,
    dueLabel: "3d",
  };

  test("the kebab is visible without hover on small screens and when focused/open", () => {
    render(<DashboardTaskRow {...base} />);
    const cls = screen.getByRole("button", { name: /task actions/i }).className;
    // Hidden-until-hover only from sm up; keyboard focus and an open menu
    // keep it visible.
    expect(cls).toContain("sm:opacity-0");
    expect(cls).toContain("sm:focus-visible:opacity-100");
    expect(cls).toContain("data-popup-open:opacity-100");
    expect(cls).not.toMatch(/(^|\s)opacity-0(\s|$)/);
  });

  test("hides the items the viewer cannot use", async () => {
    const user = setupUser();
    render(<DashboardTaskRow {...base} canLogTime={false} />);
    await user.click(screen.getByRole("button", { name: /task actions/i }));
    await screen.findByText(/add note on this task/i);
    expect(screen.queryByText(/log time on this task/i)).toBeNull();
  });

  test("no kebab at all when neither action is allowed", () => {
    render(<DashboardTaskRow {...base} canLogTime={false} canAddNote={false} />);
    expect(screen.queryByRole("button", { name: /task actions/i })).toBeNull();
  });
});
