/**
 * Tests for EditTimeEntryDialog.
 *
 * What's worth pinning down:
 *   - Auto-close must happen INSIDE the action, not in an effect keyed on
 *     the committed action state. TimeEntryRowActions keeps the dialog
 *     mounted across opens, so on the SECOND save of the same entry:
 *     (a) `state.status` is already "ok" (string never changes), and
 *     (b) React 19 can drop the post-action re-render outright when the
 *     reopen-reset effect's setStates all bail out on an unchanged entry.
 *     Either way an effect-based close never fires again and the dialog
 *     sticks open — the regression test below dies on both mechanisms.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

vi.mock("@/app/actions/time-entries", () => ({
  // Fresh object per call, mirroring the real action — the fix relies on
  // the state's identity changing even when its contents don't.
  updateTimeEntry: vi.fn(async () => ({ status: "ok" as const })),
}));

import { updateTimeEntry } from "@/app/actions/time-entries";
import {
  EditTimeEntryDialog,
  type EditableTimeEntry,
} from "./edit-time-entry-dialog";

const ENTRY: EditableTimeEntry = {
  id: "te1",
  date: new Date(2026, 6, 1),
  hours: 1.5,
  activity: "Deposition prep",
  narrative: null,
  billable: true,
  noCharge: false,
  privileged: false,
  status: "draft",
};

/**
 * Mimics TimeEntryRowActions: the dialog stays MOUNTED across opens,
 * only the `open` prop toggles. That persistence is what exposes the
 * second-save bug — a remount would reset useActionState and hide it.
 */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open editor
      </button>
      <EditTimeEntryDialog open={open} onOpenChange={setOpen} entry={ENTRY} />
    </>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /open editor/i }));
  await screen.findByText("Edit time entry");
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^save$/i }));
}

function expectClosed() {
  return waitFor(() =>
    expect(screen.queryByText("Edit time entry")).not.toBeInTheDocument()
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditTimeEntryDialog — auto-close on successful save", () => {
  test("first successful save closes the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openDialog(user);
    await save(user);

    await expectClosed();
    expect(updateTimeEntry).toHaveBeenCalledTimes(1);
  });

  test("SECOND successful save of the same entry also closes (regression)", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openDialog(user);
    await save(user);
    await expectClosed();

    // Reopen the still-mounted dialog. state.status is already "ok", so
    // an effect keyed on the string would never fire again.
    await openDialog(user);
    await save(user);

    await expectClosed();
    expect(updateTimeEntry).toHaveBeenCalledTimes(2);
  });

  test("a validation error keeps the dialog open", async () => {
    vi.mocked(updateTimeEntry).mockResolvedValueOnce({
      status: "error",
      errors: { hours: ["Hours must be a positive number"] },
    });
    const user = userEvent.setup();
    render(<Harness />);

    await openDialog(user);
    await save(user);

    await screen.findByText("Hours must be a positive number");
    expect(screen.getByText("Edit time entry")).toBeInTheDocument();
  });
});
