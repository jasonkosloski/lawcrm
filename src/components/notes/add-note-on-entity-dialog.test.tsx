/**
 * Tests for AddNoteOnEntityDialog.
 *
 * The regression worth pinning: the close-on-success effect must
 * key on the action-state OBJECT, not the status string.
 * useActionState keeps its state across submissions, so after the
 * first success the status is "ok" forever — an effect depending
 * on `state.status` never re-fires when a second note on the same
 * task/deadline succeeds, leaving the dialog open and inviting a
 * duplicate submission. Each action invocation returns a fresh
 * object, so object identity is the reliable "a submission just
 * finished" signal. (Same fix as RecordPaymentDialog — this suite
 * is the representative pin for the round-2 sweep.)
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AddNoteOnEntityDialog } from "./add-note-on-entity-dialog";
import type { NoteAttachmentFormState } from "@/lib/note-attachment-form";

// Fresh object per call — mirrors real server actions, whose
// return value is deserialized over the wire and therefore never
// reference-equal across submissions. Returning the SAME object
// each time would mask the very bug this suite pins (React bails
// out on Object.is-equal state).
const action = vi.fn<
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

describe("AddNoteOnEntityDialog — close on success", () => {
  test("closes the dialog after a successful add", async () => {
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(
      <AddNoteOnEntityDialog {...baseProps} open onOpenChange={onOpenChange} />
    );

    // Submit stays disabled until there's non-whitespace content.
    await user.type(screen.getByPlaceholderText("Write a note…"), "Called opposing counsel");
    await user.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(action).toHaveBeenCalledOnce();
  });

  test("closes again on a SECOND successful add after reopening", async () => {
    // The regression case: add a note → dialog closes → reopen on
    // the same task → second submit succeeds. The component stays
    // mounted across the close/reopen (only the dialog's content
    // unmounts), so useActionState still holds {status:"ok"} from
    // round one — the effect must fire off the new state object.
    //
    // A stateful harness plays the parent (like the task row's
    // action menu): onOpenChange drives `open`, and a reopen
    // button stands in for clicking "Add note" again.
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen dialog
          </button>
          <AddNoteOnEntityDialog
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

    // Round one: add → dialog closes.
    await user.type(screen.getByPlaceholderText("Write a note…"), "First note");
    await user.click(screen.getByRole("button", { name: /add note/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /add note/i })
      ).not.toBeInTheDocument()
    );

    // Round two: reopen and add again. With the effect keyed on
    // `state.status` this is where the bug bit — status was
    // already "ok", so the close effect never re-fired.
    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));
    onOpenChange.mockClear();
    await user.type(
      await screen.findByPlaceholderText("Write a note…"),
      "Second note"
    );
    await user.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(action).toHaveBeenCalledTimes(2);
  });

  test("stays open and surfaces field errors when the action fails", async () => {
    action.mockImplementation(async () => ({
      status: "error" as const,
      errors: { content: ["Note text is required."] },
    }));
    const user = setupUser();
    const onOpenChange = vi.fn();
    render(
      <AddNoteOnEntityDialog {...baseProps} open onOpenChange={onOpenChange} />
    );

    await user.type(screen.getByPlaceholderText("Write a note…"), "   x");
    await user.click(screen.getByRole("button", { name: /add note/i }));

    expect(
      await screen.findByText("Note text is required.")
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
