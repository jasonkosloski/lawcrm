/**
 * Tests for EditDeadlineDialog.
 *
 * The regression worth pinning: the close-on-success effect must
 * key on the action-state OBJECT, not the status string.
 * useActionState keeps its state across submissions, so after the
 * first success the status is "ok" forever — an effect depending
 * on `state.status` never re-fires for a second successful save.
 * DeadlineRowMenu keeps this dialog mounted across close/reopen,
 * so the second edit of the same deadline in a session hit exactly
 * that: the save landed but the dialog silently stayed open. Each
 * action invocation returns a fresh object, so object identity is
 * the reliable "a submission just finished" signal.
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/deadlines", () => ({
  updateDeadline: vi.fn(),
}));

import { updateDeadline } from "@/app/actions/deadlines";
import { EditDeadlineDialog, type EditableDeadline } from "./edit-deadline-dialog";

const mockedAction = vi.mocked(updateDeadline);

// Fresh object per call — mirrors real server actions, whose
// return value is deserialized over the wire and therefore never
// reference-equal across submissions. `mockResolvedValue` would
// hand back the SAME object each time and mask the very bug this
// suite pins (React bails out on Object.is-equal state).
beforeEach(() => {
  mockedAction.mockReset();
  mockedAction.mockImplementation(async () => ({ status: "ok" as const }));
});

const deadline: EditableDeadline = {
  id: "d1",
  title: "File answer",
  description: null,
  kind: "critical",
  sourceRef: "CRCP 12(a)",
  dueDateKey: "2026-07-20",
  updatedAt: "2026-07-01T10:00:00.000Z",
  status: "open",
};

// Radix locks body pointer-events while the dialog is open;
// userEvent's computed-style check trips over that in happy-dom,
// so disable it — the elements are genuinely interactive.
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("EditDeadlineDialog — close on success", () => {
  test("closes the dialog after a successful save", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(<EditDeadlineDialog open onOpenChange={onOpenChange} deadline={deadline} />);

    // Fields are prefilled from the deadline, so the form is
    // submittable as-is.
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction).toHaveBeenCalledOnce();
    // Bound arg — the action is deadline-id-bound via .bind().
    expect(mockedAction.mock.calls[0][0]).toBe("d1");
  });

  test("closes again on a SECOND successful save after reopening", async () => {
    // The regression case: edit → save → reopen → save again.
    // DeadlineRowMenu keeps the dialog component mounted (only the
    // dialog's content unmounts), so useActionState still holds
    // {status:"ok"} from round one — the effect must fire off the
    // new state object, not the unchanged status string.
    //
    // A stateful harness plays the parent (like DeadlineRowMenu):
    // onOpenChange drives `open`, and a reopen button stands in
    // for the row menu's "Edit" item.
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen dialog
          </button>
          <EditDeadlineDialog
            open={open}
            onOpenChange={(o) => {
              onOpenChange(o);
              setOpen(o);
            }}
            deadline={deadline}
          />
        </>
      );
    }

    const user = setupUser();
    render(<Harness />);

    // Round one: save → dialog closes.
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument(),
    );

    // Round two: reopen and save again. With the effect keyed on
    // `state.status` this is where the bug bit — status was
    // already "ok", so the close effect never re-fired.
    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));
    onOpenChange.mockClear();
    await user.click(await screen.findByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAction).toHaveBeenCalledTimes(2);
  });

  test("stays open and surfaces field errors when the action fails", async () => {
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      errors: { title: ["Title is required."] },
    }));
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(<EditDeadlineDialog open onOpenChange={onOpenChange} deadline={deadline} />);

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("EditDeadlineDialog — auto-managed SOL row", () => {
  const solDeadline: EditableDeadline = {
    ...deadline,
    title: "Statute of limitations",
    sourceRef: null,
    sourceType: "statute_of_limitations",
  };

  test("renders the date read-only and only offers the status", () => {
    render(<EditDeadlineDialog open onOpenChange={vi.fn()} deadline={solDeadline} />);
    expect(screen.getByText(/managed on the matter edit page/i)).toBeInTheDocument();
    // No editable title / due date / description inputs.
    expect(screen.queryByPlaceholderText("Deadline title")).toBeNull();
    expect(screen.queryByPlaceholderText("Due date")).toBeNull();
    expect(screen.queryByPlaceholderText(/why this deadline applies/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });
});

describe("EditDeadlineDialog - date-only due date (ADR-012)", () => {
  test("prefills the stored calendar day exactly and posts it back unchanged", async () => {
    // Regression: the dialog used browser-local getters on a Date, so a
    // UTC-midnight 2026-10-16 prefilled as Oct 15 in a Denver browser and
    // every save of an unrelated field moved the deadline a day earlier.
    // The server now hands over the YYYY-MM-DD key; no zone is applied.
    const user = setupUser();
    render(
      <EditDeadlineDialog
        open
        onOpenChange={vi.fn()}
        deadline={{ ...deadline, dueDateKey: "2026-10-16" }}
      />,
    );
    const input = screen.getByLabelText("Due date") as HTMLInputElement;
    expect(input.value).toBe("2026-10-16");

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledOnce());
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("dueDate")).toBe("2026-10-16");
  });

  test("posts the row version it was seeded from", async () => {
    const user = setupUser();
    render(<EditDeadlineDialog open onOpenChange={vi.fn()} deadline={deadline} />);
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mockedAction).toHaveBeenCalledOnce());
    const fd = mockedAction.mock.calls[0][2] as FormData;
    expect(fd.get("expectedUpdatedAt")).toBe(deadline.updatedAt);
  });
});

describe("EditDeadlineDialog - keeps what the user typed", () => {
  test("a validation error does not wipe the fields", async () => {
    // React 19 resets a <form action> form after the action settles;
    // the manual dispatch keeps the user's edits so they can correct.
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      errors: { dueDate: ["Invalid due date"] },
    }));
    const user = setupUser();
    render(<EditDeadlineDialog open onOpenChange={vi.fn()} deadline={deadline} />);
    const title = screen.getByPlaceholderText("Deadline title");
    await user.clear(title);
    await user.type(title, "Edited title");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Invalid due date")).toBeInTheDocument();
    expect((screen.getByPlaceholderText("Deadline title") as HTMLInputElement).value).toBe(
      "Edited title",
    );
  });

  test("a prop refresh while open does not reseed the form", async () => {
    // A revalidate delivers a fresh deadline object; the old
    // [open, deadline] effect reset the working copy mid-edit.
    const user = setupUser();
    const { rerender } = render(
      <EditDeadlineDialog open onOpenChange={vi.fn()} deadline={deadline} />,
    );
    const title = screen.getByPlaceholderText("Deadline title");
    await user.clear(title);
    await user.type(title, "Half-typed");

    rerender(<EditDeadlineDialog open onOpenChange={vi.fn()} deadline={{ ...deadline }} />);
    expect((screen.getByPlaceholderText("Deadline title") as HTMLInputElement).value).toBe(
      "Half-typed",
    );
  });

  test("shows a stale-version error from the server", async () => {
    mockedAction.mockImplementation(async () => ({
      status: "error" as const,
      errors: { _form: ["This deadline was changed by someone else."] },
    }));
    const user = setupUser();
    render(<EditDeadlineDialog open onOpenChange={vi.fn()} deadline={deadline} />);
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/changed by someone else/i)).toBeInTheDocument();
  });
});
