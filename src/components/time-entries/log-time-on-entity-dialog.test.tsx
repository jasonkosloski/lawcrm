/**
 * Tests for LogTimeOnEntityDialog.
 *
 * The regression worth pinning: the close-on-success effect must
 * key on the action-state OBJECT, not the status string.
 * useActionState keeps its state across submissions, and the row
 * components that host this dialog (dashboard row, task row) keep
 * it mounted between opens — so after the first success the status
 * is "ok" forever. An effect depending on `state.status` never
 * re-fires for a second successful log (time on the same task on
 * two occasions), leaving the dialog open with a just-cleared form
 * that reads as a failure and invites a duplicate entry.
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LogTimeOnEntityDialog } from "./log-time-on-entity-dialog";
import type { NoteAttachmentFormState } from "@/lib/note-attachment-form";

// Fresh object per call — mirrors real server actions, whose
// return value is deserialized over the wire and therefore never
// reference-equal across submissions. A shared object would mask
// the very bug this suite pins (React bails out on Object.is-equal
// state).
const action =
  vi.fn<
    (
      prev: NoteAttachmentFormState,
      formData: FormData
    ) => Promise<NoteAttachmentFormState>
  >();

beforeEach(() => {
  action.mockReset();
  action.mockImplementation(async () => ({ status: "ok" as const }));
});

const baseProps = {
  action,
  parentLabel: "Draft discovery responses",
  parentKind: "task" as const,
};

// Radix locks body pointer-events while the dialog is open;
// userEvent's computed-style check trips over that in happy-dom,
// so disable it — the elements are genuinely interactive.
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

/** Fill the two required fields so "Log time" enables, then submit. */
async function logTime(user: ReturnType<typeof setupUser>) {
  await user.type(await screen.findByPlaceholderText("Hrs"), "0.5");
  await user.type(screen.getByPlaceholderText("Activity"), "Call with client");
  await user.click(screen.getByRole("button", { name: /log time/i }));
}

describe("LogTimeOnEntityDialog — close on success", () => {
  test("closes the dialog after a successful log", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(
      <LogTimeOnEntityDialog {...baseProps} open onOpenChange={onOpenChange} />
    );

    await logTime(user);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(action).toHaveBeenCalledOnce();
  });

  test("closes again on a SECOND successful log after reopening", async () => {
    // The regression case: log time → dialog reopened later in the
    // session → second submit succeeds. The component stays mounted
    // across the close/reopen (only the dialog's content unmounts),
    // so useActionState still holds {status:"ok"} from round one —
    // the effect must fire off the new state object.
    //
    // A stateful harness plays the parent (like the task row):
    // onOpenChange drives `open`, and a reopen button stands in for
    // clicking "Log time" from the row menu again.
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen dialog
          </button>
          <LogTimeOnEntityDialog
            {...baseProps}
            open={open}
            onOpenChange={(o) => {
              onOpenChange(o);
              setOpen(o);
            }}
          />
        </>
      );
    }

    const user = setupUser();
    render(<Harness />);

    // Round one: log → dialog closes.
    await logTime(user);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /log time/i })
      ).not.toBeInTheDocument()
    );

    // Round two: reopen and log again. With the effect keyed on
    // `state.status` this is where the bug bit — status was already
    // "ok", so the close effect never re-fired.
    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));
    onOpenChange.mockClear();
    await logTime(user);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(action).toHaveBeenCalledTimes(2);
  });

  test("stays open and surfaces field errors when the action fails", async () => {
    action.mockImplementation(async () => ({
      status: "error" as const,
      errors: { hours: ["Hours must be a positive number."] },
    }));
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(
      <LogTimeOnEntityDialog {...baseProps} open onOpenChange={onOpenChange} />
    );

    await logTime(user);

    expect(
      await screen.findByText("Hours must be a positive number.")
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
