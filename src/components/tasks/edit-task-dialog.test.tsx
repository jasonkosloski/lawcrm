/**
 * Tests for EditTaskDialog.
 *
 * Two regressions worth pinning, both consequences of useActionState
 * persisting across submissions while the dialog component stays
 * mounted between opens (TaskRowMenu renders it unconditionally):
 *
 * 1. The close-on-success effect must key on the action-state OBJECT,
 *    not the status string. After the first success the status is "ok"
 *    forever — an effect depending on `state.status` never re-fires for
 *    a second successful save (edit → reopen → edit again), leaving the
 *    dialog open with no feedback. Each action invocation returns a
 *    fresh object, so identity is the reliable "a submission just
 *    finished" signal. Same fix as RecordPaymentDialog.
 *
 * 2. Field errors from a failed attempt must not reappear when the
 *    dialog is reopened — the fields reset on open, so a stale error
 *    next to a restored (valid) value is a lie.
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/tasks", () => ({
  updateTask: vi.fn(),
}));

import { updateTask } from "@/app/actions/tasks";
import { EditTaskDialog, type EditableTask } from "./edit-task-dialog";

const mockedAction = vi.mocked(updateTask);

// Fresh object per call — mirrors real server actions, whose return
// value is deserialized over the wire and therefore never
// reference-equal across submissions. `mockResolvedValue` would hand
// back the SAME object each time and mask the very bug this suite
// pins (React bails out on Object.is-equal state).
beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
});

const baseTask: EditableTask = {
  id: "task1",
  title: "Draft complaint",
  description: null,
  priority: "normal",
  status: "open",
  ownerId: null,
  dueDateKey: "",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

const assignees = [
  { id: "u1", name: "Ada Lovelace", initials: "AL" },
  { id: "u2", name: "Grace Hopper", initials: "GH" },
];

// Radix locks body pointer-events while the dialog is open;
// userEvent's computed-style check trips over that in happy-dom,
// so disable it — the elements are genuinely interactive.
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

/**
 * Stateful stand-in for TaskRowMenu: keeps EditTaskDialog mounted
 * across the close/reopen cycle (only the dialog's content unmounts),
 * exactly like production — that persistence is what both regressions
 * depend on.
 */
function Harness({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen dialog
      </button>
      <EditTaskDialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          setOpen(o);
        }}
        task={baseTask}
        assignees={assignees}
      />
    </>
  );
}

describe("EditTaskDialog — close on success", () => {
  test("closes the dialog after a successful save", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(
      <EditTaskDialog
        open
        onOpenChange={onOpenChange}
        task={baseTask}
        assignees={assignees}
      />
    );

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction).toHaveBeenCalledOnce();
    // Bound arg — the action is task-id-bound via .bind().
    expect(mockedAction.mock.calls[0][0]).toBe("task1");
  });

  test("closes again on a SECOND successful save after reopening", async () => {
    // The regression case: save → dialog reopened from the row menu →
    // second save succeeds. useActionState still holds {status:"ok"}
    // from round one, so the close effect must fire off the new state
    // object, not the (unchanged) status string.
    const onOpenChange = vi.fn();
    const user = setupUser();
    render(<Harness onOpenChange={onOpenChange} />);

    // Round one: save → dialog closes.
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /save/i })
      ).not.toBeInTheDocument()
    );

    // Round two: reopen and save again. With the effect keyed on
    // `state.status` this is where the bug bit — status was already
    // "ok", so the close effect never re-fired.
    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));
    onOpenChange.mockClear();
    await user.click(await screen.findByRole("button", { name: /save/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction).toHaveBeenCalledTimes(2);
  });
});

describe("EditTaskDialog — validation errors", () => {
  test("stays open and shows the field error when validation fails", async () => {
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      errors: { title: ["Title is required"] },
    }));
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(
      <EditTaskDialog
        open
        onOpenChange={onOpenChange}
        task={baseTask}
        assignees={assignees}
      />
    );

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("does NOT resurface a stale error after close and reopen", async () => {
    // useActionState still holds the error state from the failed
    // attempt when the dialog reopens, but the fields have been reset
    // to the task's saved values — the leftover error must be cleared
    // along with them.
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      errors: { title: ["Title is required"] },
    }));
    const user = setupUser();
    render(<Harness onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Title is required")).toBeInTheDocument();

    // Close via Cancel, then reopen — same persisted action state.
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));

    expect(
      await screen.findByRole("button", { name: /save/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("Title is required")).not.toBeInTheDocument();
  });
});

describe("EditTaskDialog — assignee picker", () => {
  test("renders Unassigned + every assignee, defaulting to the task's owner", () => {
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...baseTask, ownerId: "u2" }}
        assignees={assignees}
      />
    );
    const select = screen.getByRole("combobox", {
      name: /assignee/i,
    }) as HTMLSelectElement;
    expect(select.value).toBe("u2");
    expect(
      [...select.options].map((o) => o.textContent)
    ).toEqual(["Unassigned", "Ada Lovelace", "Grace Hopper"]);
  });

  test("unassigned task defaults to the Unassigned option and posts ownerId", async () => {
    const user = setupUser();
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={baseTask}
        assignees={assignees}
      />
    );
    const select = screen.getByRole("combobox", {
      name: /assignee/i,
    }) as HTMLSelectElement;
    expect(select.value).toBe("");

    // Pick an assignee, save — the picker's value must reach the
    // action's FormData under the tri-state `ownerId` key.
    await user.selectOptions(select, "u1");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledOnce());
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("ownerId")).toBe("u1");
  });
});

describe("EditTaskDialog - date-only due date (ADR-012)", () => {
  test("prefills the stored calendar day exactly and posts it back unchanged", async () => {
    // Regression: the dialog used browser-local getters on a Date, so a
    // UTC-midnight 2026-10-16 prefilled as Oct 15 in a Denver browser and
    // every save of an unrelated field moved the due date a day earlier.
    const user = setupUser();
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...baseTask, dueDateKey: "2026-10-16" }}
        assignees={assignees}
      />
    );
    const input = screen.getByLabelText("Due date") as HTMLInputElement;
    expect(input.value).toBe("2026-10-16");

    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledOnce());
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("dueDate")).toBe("2026-10-16");
  });

  test("a task with no due date posts an empty dueDate", async () => {
    const user = setupUser();
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={baseTask}
        assignees={assignees}
      />
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledOnce());
    expect((mockedAction.mock.calls[0][2] as FormData).get("dueDate")).toBe("");
  });
});

describe("EditTaskDialog - owner who has since been deactivated", () => {
  const inactiveOwnerTask: EditableTask = {
    ...baseTask,
    ownerId: "gone",
    ownerName: "Pat Paralegal",
    ownerInitials: "PP",
  };

  test("keeps the owner selected and re-posts their id (does not silently unassign)", async () => {
    const user = setupUser();
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={inactiveOwnerTask}
        assignees={assignees}
      />
    );
    const select = screen.getByRole("combobox", {
      name: /assignee/i,
    }) as HTMLSelectElement;
    expect(select.value).toBe("gone");
    expect(
      [...select.options].map((o) => o.textContent)
    ).toContain("Pat Paralegal (inactive)");

    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledOnce());
    expect((mockedAction.mock.calls[0][2] as FormData).get("ownerId")).toBe(
      "gone"
    );
  });

  test("an active owner is not duplicated as inactive", () => {
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...baseTask, ownerId: "u1", ownerName: "Ada Lovelace", ownerInitials: "AL" }}
        assignees={assignees}
      />
    );
    const select = screen.getByRole("combobox", {
      name: /assignee/i,
    }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Unassigned",
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });
});

describe("EditTaskDialog - keeps what the user typed", () => {
  test("posts the row version it was seeded from", async () => {
    const user = setupUser();
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={baseTask}
        assignees={assignees}
      />
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledOnce());
    expect(
      (mockedAction.mock.calls[0][2] as FormData).get("expectedUpdatedAt")
    ).toBe(baseTask.updatedAt);
  });

  test("a validation error does not wipe the fields", async () => {
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      errors: { dueDate: ["Invalid due date"] },
    }));
    const user = setupUser();
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={baseTask}
        assignees={assignees}
      />
    );
    const title = screen.getByPlaceholderText("Task title");
    await user.clear(title);
    await user.type(title, "Edited title");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Invalid due date")).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText("Task title") as HTMLInputElement).value
    ).toBe("Edited title");
  });

  test("a prop refresh while open does not reseed the form", async () => {
    const user = setupUser();
    const { rerender } = render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={baseTask}
        assignees={assignees}
      />
    );
    const title = screen.getByPlaceholderText("Task title");
    await user.clear(title);
    await user.type(title, "Half-typed");

    rerender(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={{ ...baseTask }}
        assignees={assignees}
      />
    );
    expect(
      (screen.getByPlaceholderText("Task title") as HTMLInputElement).value
    ).toBe("Half-typed");
  });

  test("shows a stale-version error from the server", async () => {
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      errors: { _form: ["This task was changed by someone else."] },
    }));
    const user = setupUser();
    render(
      <EditTaskDialog
        open
        onOpenChange={vi.fn()}
        task={baseTask}
        assignees={assignees}
      />
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(
      await screen.findByText(/changed by someone else/i)
    ).toBeInTheDocument();
  });
});
