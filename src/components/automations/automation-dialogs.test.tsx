/**
 * Automation dialogs — the client halves of the apply round-trips
 * and the task-list editor's posted payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/automations", () => ({
  applyDeadlineRuleToMatter: vi.fn(),
  applyTaskListToMatter: vi.fn(),
  createTaskList: vi.fn(async () => ({ status: "ok" })),
  updateTaskList: vi.fn(),
}));

import {
  applyDeadlineRuleToMatter,
  applyTaskListToMatter,
  createTaskList,
} from "@/app/actions/automations";
import { ApplyDeadlineRuleDialog } from "./apply-deadline-rule-dialog";
import { ApplyTaskListDialog } from "./apply-task-list-dialog";
import { TaskListDialog } from "./task-list-dialog";

afterEach(() => vi.clearAllMocks());
// clearAllMocks keeps queued mockResolvedValueOnce values — reset the
// apply mocks so one test's unused responses can't leak into the next.
beforeEach(() => {
  vi.mocked(applyDeadlineRuleToMatter).mockReset();
  vi.mocked(applyTaskListToMatter).mockReset();
});

const rules = [
  { id: "r1", title: "Answer due", summary: "21 days after Date of service" },
  { id: "r2", title: "CGIA notice", summary: "182 days after Incident date" },
];

describe("ApplyDeadlineRuleDialog", () => {
  it("asks for the anchor date when the server needs one, then resends with it", async () => {
    const user = userEvent.setup();
    vi.mocked(applyDeadlineRuleToMatter)
      .mockResolvedValueOnce({ status: "needs_date", title: "Answer due", reason: "it needs a date (Date of service)", label: "Date of service" })
      .mockResolvedValueOnce({ status: "ok", title: "Answer due", dueKey: "2026-11-22" });

    render(<ApplyDeadlineRuleDialog matterId="m1" rules={rules} />);
    await user.click(screen.getByRole("button", { name: /apply deadline rule/i }));
    expect(screen.getByText("21 days after Date of service")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    // The summary line also says "Date of service", so target the input.
    await screen.findByText(/needed because/i);
    const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    // Apply stays disabled until a date is entered.
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
    await user.type(dateInput, "2026-11-01");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(vi.mocked(applyDeadlineRuleToMatter).mock.calls).toEqual([
      ["m1", "r1", { force: undefined, anchorDate: undefined }],
      ["m1", "r1", { force: undefined, anchorDate: "2026-11-01" }],
    ]);
  });

  it("confirms before applying a rule already on the matter", async () => {
    const user = userEvent.setup();
    vi.mocked(applyDeadlineRuleToMatter)
      .mockResolvedValueOnce({ status: "duplicate", title: "CGIA notice" })
      .mockResolvedValueOnce({ status: "ok", title: "CGIA notice", dueKey: "2026-09-08" });

    render(<ApplyDeadlineRuleDialog matterId="m1" rules={rules} />);
    await user.click(screen.getByRole("button", { name: /apply deadline rule/i }));
    await user.selectOptions(screen.getByRole("combobox"), "r2");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(await screen.findByText(/already on this matter/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /apply again/i }));
    expect(vi.mocked(applyDeadlineRuleToMatter).mock.calls[1]).toEqual([
      "m1",
      "r2",
      { force: true, anchorDate: undefined },
    ]);
  });
});

describe("ApplyTaskListDialog", () => {
  it("previews the list's tasks and confirms a re-apply", async () => {
    const user = userEvent.setup();
    vi.mocked(applyTaskListToMatter)
      .mockResolvedValueOnce({ status: "duplicate", name: "Intake" })
      .mockResolvedValueOnce({ status: "ok", name: "Intake", count: 2 });
    render(
      <ApplyTaskListDialog matterId="m1" lists={[{ id: "l1", name: "Intake", itemTitles: ["Conflict check", "Engagement letter"] }]} />
    );
    await user.click(screen.getByRole("button", { name: /apply task list/i }));
    expect(screen.getByText("Engagement letter")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    await user.click(await screen.findByRole("button", { name: /apply again/i }));
    expect(vi.mocked(applyTaskListToMatter).mock.calls).toEqual([
      ["m1", "l1", { force: false }],
      ["m1", "l1", { force: true }],
    ]);
  });
});

describe("TaskListDialog", () => {
  it("posts ordered items as JSON, skipping blank rows", async () => {
    const user = userEvent.setup();
    render(<TaskListDialog open onOpenChange={() => {}} list={null} />);
    await user.type(screen.getByPlaceholderText("§1983 intake checklist"), "Intake");
    const titles = () => screen.getAllByLabelText("Task title");
    await user.type(titles()[0], "Conflict check");
    await user.click(screen.getByRole("button", { name: /add task/i }));
    await user.type(titles()[1], "Engagement letter");
    await user.type(screen.getAllByLabelText("Due days after applied")[1], "3");
    await user.click(screen.getByRole("button", { name: /add task/i })); // left blank
    // Move "Engagement letter" above "Conflict check".
    await user.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    await user.click(screen.getByRole("button", { name: /create list/i }));

    const fd = vi.mocked(createTaskList).mock.calls[0][1] as FormData;
    expect(fd.get("name")).toBe("Intake");
    expect(JSON.parse(fd.get("items") as string)).toEqual([
      { title: "Engagement letter", description: null, priority: "normal", assignTo: "lead", dueOffsetDays: 3 },
      { title: "Conflict check", description: null, priority: "normal", assignTo: "lead", dueOffsetDays: null },
    ]);
  });
});
