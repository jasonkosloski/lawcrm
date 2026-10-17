/**
 * CascadeConfirm + its round-trip through the deadline edit dialog.
 * The contract: nothing moves unless it's ticked, and the user always
 * sees the list before anything is saved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/deadlines", () => ({ updateDeadline: vi.fn() }));

import { updateDeadline } from "@/app/actions/deadlines";
import { CascadeConfirm } from "./cascade-confirm";
import { EditDeadlineDialog } from "@/components/deadlines/edit-deadline-dialog";
import type { RecalcChange } from "@/lib/automations/recalc-plan";

afterEach(() => vi.mocked(updateDeadline).mockReset());

const changes: RecalcChange[] = [
  { deadlineId: "m", title: "Motions in limine", ruleTitle: "Motions", fromKey: "2027-05-02", toKey: "2027-06-01", manual: false, anchorDeadlineId: null, anchorText: "Trial" },
  { deadlineId: "w", title: "Witness list", ruleTitle: "Witness", fromKey: "2027-04-25", toKey: "2027-05-25", manual: false, anchorDeadlineId: "m", anchorText: "Motions in limine" },
  { deadlineId: "x", title: "Exhibit list", ruleTitle: "Exhibits", fromKey: "2027-04-20", toKey: "2027-05-20", manual: true, anchorDeadlineId: null, anchorText: "Trial" },
];

/** Render inside a form and capture what each submit button posts. */
function renderInForm() {
  const posted: FormData[] = [];
  render(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        posted.push(new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter));
      }}
    >
      <CascadeConfirm changes={changes} changedLabel="this deadline's date" isPending={false} onCancel={() => {}} />
    </form>
  );
  return posted;
}

describe("CascadeConfirm", () => {
  it("lists every change old → new; hand-set dates start unticked", () => {
    renderInForm();
    expect(screen.getByText(/will change 3 other deadlines/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Update Motions in limine")).toBeChecked();
    expect(screen.getByLabelText("Update Witness list")).toBeChecked();
    expect(screen.getByLabelText("Update Exhibit list")).not.toBeChecked();
    expect(screen.getByText(/changed by hand/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and update 2 deadlines" })).toBeInTheDocument();
  });

  it("unticking an anchor disables what counts from it", async () => {
    const user = userEvent.setup();
    renderInForm();
    await user.click(screen.getByLabelText("Update Motions in limine"));
    expect(screen.getByLabelText("Update Witness list")).toBeDisabled();
    expect(screen.getByLabelText("Update Witness list")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /save and update/i })).toBeDisabled();
  });

  it("apply posts the decision + exactly the ticked ids; skip posts no ids that matter", async () => {
    const user = userEvent.setup();
    const posted = renderInForm();
    await user.click(screen.getByLabelText("Update Exhibit list")); // opt the hand-set one in
    await user.click(screen.getByRole("button", { name: "Save and update 3 deadlines" }));
    expect(posted[0].get("cascadeDecision")).toBe("apply");
    expect(posted[0].getAll("cascadeId")).toEqual(["m", "w", "x"]);

    await user.click(screen.getByRole("button", { name: /save, don't change them/i }));
    expect(posted[1].get("cascadeDecision")).toBe("skip");
  });
});

describe("EditDeadlineDialog — confirm round-trip", () => {
  const deadline = {
    id: "trial",
    title: "Trial",
    description: null,
    kind: "auto_rule",
    sourceRef: null,
    dueDateKey: "2027-06-01",
    status: "open" as const,
    updatedAt: "2026-10-01T00:00:00.000Z",
  };

  it("shows the list instead of saving, then resubmits with the user's decision", async () => {
    const user = userEvent.setup();
    vi.mocked(updateDeadline)
      .mockResolvedValueOnce({ status: "confirm", cascade: changes.slice(0, 1) })
      .mockResolvedValueOnce({ status: "ok" });
    const onOpenChange = vi.fn();
    render(<EditDeadlineDialog open onOpenChange={onOpenChange} deadline={deadline} />);

    const date = document.querySelector<HTMLInputElement>('input[name="dueDate"]')!;
    await user.clear(date);
    await user.type(date, "2027-07-01");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/will change another deadline/i)).toBeInTheDocument();
    // The plain Save is gone while confirming — no way past the list.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save and update 1 deadline" }));

    const second = vi.mocked(updateDeadline).mock.calls[1][2] as FormData;
    expect(second.get("dueDate")).toBe("2027-07-01");
    expect(second.get("cascadeDecision")).toBe("apply");
    expect(second.getAll("cascadeId")).toEqual(["m"]);
  });

  it("editing the date again drops the stale list (the next Save asks afresh)", async () => {
    const user = userEvent.setup();
    vi.mocked(updateDeadline).mockResolvedValueOnce({ status: "confirm", cascade: changes.slice(0, 1) });
    render(<EditDeadlineDialog open onOpenChange={() => {}} deadline={deadline} />);
    const date = document.querySelector<HTMLInputElement>('input[name="dueDate"]')!;
    await user.clear(date);
    await user.type(date, "2027-07-01");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/will change another deadline/i);

    await user.clear(date);
    await user.type(date, "2027-08-01");
    expect(screen.queryByText(/will change another deadline/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
