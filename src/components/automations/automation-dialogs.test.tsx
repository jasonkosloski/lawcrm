/**
 * Automation dialogs — the client halves of the apply round-trips
 * and the task-list editor's posted payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("@/app/actions/automations", () => ({
  applyDeadlineRuleToMatter: vi.fn(),
  applyTaskListToMatter: vi.fn(),
  createTaskList: vi.fn(async () => ({ status: "ok" })),
  updateTaskList: vi.fn(),
  createDeadlineRule: vi.fn(),
  updateDeadlineRule: vi.fn(),
  addAutoApply: vi.fn(),
  removeAutoApply: vi.fn(async () => ({ ok: true })),
  deleteDeadlineRule: vi.fn(async () => ({ ok: true })),
  deleteTaskList: vi.fn(async () => ({ ok: true })),
  setDeadlineRuleActive: vi.fn(async () => ({ ok: true })),
  setTaskListActive: vi.fn(async () => ({ ok: true })),
}));

import {
  addAutoApply,
  applyDeadlineRuleToMatter,
  applyTaskListToMatter,
  createTaskList,
  deleteDeadlineRule,
  deleteTaskList,
} from "@/app/actions/automations";
import { confirmAction } from "@/lib/feedback";
import type { AutoApplyRow, DeadlineRuleRow, TaskListRow } from "@/lib/queries/automations";
import { ApplyDeadlineRuleDialog } from "./apply-deadline-rule-dialog";
import { ApplyTaskListDialog } from "./apply-task-list-dialog";
import { AutomationsLibrary } from "./automations-library";
import { DeadlineRuleDialog } from "./deadline-rule-dialog";
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
      .mockResolvedValueOnce({
        status: "needs_date",
        title: "Answer due",
        reason: "it needs a date (Date of service)",
        label: "Date of service",
      })
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

describe("ApplyDeadlineRuleDialog: a rule that is both a duplicate and needs a date", () => {
  it("keeps the force flag when the date step appears, so the second deadline can be created", async () => {
    const user = userEvent.setup();
    vi.mocked(applyDeadlineRuleToMatter)
      .mockResolvedValueOnce({ status: "duplicate", title: "Answer due" })
      .mockResolvedValueOnce({
        status: "needs_date",
        title: "Answer due",
        reason: "it needs a date (Date of service)",
        label: "Date of service",
      })
      .mockResolvedValueOnce({ status: "ok", title: "Answer due", dueKey: "2026-12-22" });

    render(<ApplyDeadlineRuleDialog matterId="m1" rules={rules} />);
    await user.click(screen.getByRole("button", { name: /apply deadline rule/i }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    await user.click(await screen.findByRole("button", { name: /apply again/i }));
    await screen.findByText(/needed because/i);
    await user.type(document.querySelector<HTMLInputElement>('input[type="date"]')!, "2026-12-01");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(vi.mocked(applyDeadlineRuleToMatter).mock.calls).toEqual([
      ["m1", "r1", { force: undefined, anchorDate: undefined }],
      ["m1", "r1", { force: true, anchorDate: undefined }],
      // The old dialog dropped force here and the server said "duplicate" again, forever.
      ["m1", "r1", { force: true, anchorDate: "2026-12-01" }],
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
      <ApplyTaskListDialog
        matterId="m1"
        lists={[{ id: "l1", name: "Intake", itemTitles: ["Conflict check", "Engagement letter"] }]}
      />,
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

const ruleRow = (
  over: Partial<DeadlineRuleRow> & { id: string; title: string },
): DeadlineRuleRow => ({
  kind: "critical",
  anchor: "incident_date",
  anchorRuleId: null,
  anchorRuleTitle: null,
  anchorLabel: null,
  offsetDays: 30,
  offsetUnit: "days",
  sourceRef: null,
  description: null,
  isActive: true,
  summary: "30 days after Incident date",
  dependentCount: 0,
  ...over,
});

describe("DeadlineRuleDialog", () => {
  it("keeps an archived anchor rule selected when editing a rule that counts from it", () => {
    const archived = ruleRow({ id: "a", title: "Trial date", isActive: false });
    const other = ruleRow({ id: "z", title: "Other archived", isActive: false });
    const b = ruleRow({
      id: "b",
      title: "Motions",
      anchor: "rule",
      anchorRuleId: "a",
      anchorRuleTitle: "Trial date",
      offsetDays: -30,
    });
    render(
      <DeadlineRuleDialog open onOpenChange={() => {}} rule={b} allRules={[archived, other, b]} />,
    );
    const select = screen.getByLabelText(/which rule/i) as HTMLSelectElement;
    expect(select.value).toBe("a");
    expect(screen.getByRole("option", { name: "Trial date (archived)" })).toBeInTheDocument();
    // Other archived rules still aren't offered as new anchors.
    expect(screen.queryByRole("option", { name: /Other archived/ })).toBeNull();
  });

  it("explains that incident-date rules need a statute-of-limitations area and that dates are calendar days", () => {
    render(<DeadlineRuleDialog open onOpenChange={() => {}} rule={null} allRules={[]} />);
    expect(
      screen.getByText(/only resolves on matters in practice areas that track a statute/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no weekend, holiday or court-day adjustment/i)).toBeInTheDocument();
  });
});

describe("AutomationsLibrary", () => {
  const can = {
    ruleCreate: true,
    ruleEdit: true,
    ruleDelete: true,
    listCreate: true,
    listEdit: true,
    listDelete: true,
    defaultsCreate: true,
    defaultsDelete: true,
  };
  const list: TaskListRow = {
    id: "l1",
    name: "Intake",
    description: null,
    isActive: true,
    items: [
      {
        title: "Conflict check",
        description: null,
        priority: "normal",
        assignTo: "lead",
        dueOffsetDays: null,
      },
    ],
  };
  const defaults: AutoApplyRow[] = [
    {
      id: "d1",
      trigger: "matter_created",
      practiceAreaId: "pa1",
      practiceAreaName: "Civil rights",
      targetKind: "list",
      targetId: "l1",
      targetName: "Intake",
      targetActive: true,
    },
    {
      id: "d2",
      trigger: "matter_created",
      practiceAreaId: null,
      practiceAreaName: null,
      targetKind: "list",
      targetId: "l1",
      targetName: "Intake",
      targetActive: true,
    },
    {
      id: "d3",
      trigger: "matter_created",
      practiceAreaId: null,
      practiceAreaName: null,
      targetKind: "rule",
      targetId: "r1",
      targetName: "CGIA",
      targetActive: true,
    },
  ];

  it("tells the admin how many automatic defaults a delete will remove", async () => {
    const user = userEvent.setup();
    vi.mocked(confirmAction).mockResolvedValue(false);
    render(
      <AutomationsLibrary
        rules={[ruleRow({ id: "r1", title: "CGIA" }), ruleRow({ id: "r2", title: "No defaults" })]}
        lists={[list]}
        defaults={defaults}
        practiceAreas={[{ id: "pa1", name: "Civil rights" }]}
        can={can}
      />,
    );
    const deleteVia = async (label: string) => {
      await user.click(screen.getByRole("button", { name: `Actions for ${label}` }));
      await user.click(await screen.findByRole("menuitem", { name: /delete permanently/i }));
    };

    await deleteVia("Intake");
    await waitFor(() =>
      expect(confirmAction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("also removes 2 automatic defaults"),
        }),
      ),
    );
    expect(deleteTaskList).not.toHaveBeenCalled(); // declined

    await deleteVia("CGIA");
    await waitFor(() =>
      expect(confirmAction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("also removes 1 automatic default "),
        }),
      ),
    );

    await deleteVia("No defaults");
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(3));
    expect(vi.mocked(confirmAction).mock.calls.at(-1)![0].description).not.toMatch(
      /automatic default/,
    );
    expect(deleteDeadlineRule).not.toHaveBeenCalled();
  });

  it("keeps the picked rule and practice area when adding a default fails", async () => {
    const user = userEvent.setup();
    vi.mocked(addAutoApply).mockResolvedValueOnce({
      status: "error",
      errors: { target: ["That's already a default for this practice area"] },
    });
    render(
      <AutomationsLibrary
        rules={[]}
        lists={[list]}
        defaults={[]}
        practiceAreas={[{ id: "pa1", name: "Civil rights" }]}
        can={can}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Rule or task list"), "list:l1");
    await user.selectOptions(screen.getByLabelText("Practice area"), "pa1");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(await screen.findByText(/already a default/i)).toBeInTheDocument();
    // React 19's form-action reset used to snap both selects back.
    expect((screen.getByLabelText("Rule or task list") as HTMLSelectElement).value).toBe("list:l1");
    expect((screen.getByLabelText("Practice area") as HTMLSelectElement).value).toBe("pa1");
    expect(vi.mocked(addAutoApply).mock.calls[0][1].get("target")).toBe("list:l1");
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
      {
        title: "Engagement letter",
        description: null,
        priority: "normal",
        assignTo: "lead",
        dueOffsetDays: 3,
      },
      {
        title: "Conflict check",
        description: null,
        priority: "normal",
        assignTo: "lead",
        dueOffsetDays: null,
      },
    ]);
  });
});
