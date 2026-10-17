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
 *   - The date field is a date-only value: it prefills with the stored
 *     calendar day (UTC getters), not the browser-local day. Local
 *     getters read a UTC-midnight Date as the PREVIOUS day west of UTC,
 *     and every save then posted that day back (one day earlier per
 *     edit). The suite runs under America/Denver and TZ=UTC; the
 *     prefill assertions fail on the old code in Denver.
 *   - A cancelled attempt's field errors must not reappear on reopen.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { parseDateOnly } from "@/lib/format-date";

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
  // Date-only value as the server stores it: UTC midnight.
  date: parseDateOnly("2026-07-01")!,
  hours: 1.5,
  activity: "Deposition prep",
  narrative: null,
  utbmsCode: null,
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

describe("EditTimeEntryDialog — date-only prefill (no zone drift)", () => {
  test("prefills the stored calendar day, whatever the browser zone", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);

    expect(screen.getByLabelText("Date")).toHaveValue("2026-07-01");
  });

  test("an untouched save posts the same day back (the entry does not drift)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);
    await save(user);
    await expectClosed();

    const fd = vi.mocked(updateTimeEntry).mock.calls[0]![2] as FormData;
    expect(fd.get("date")).toBe("2026-07-01");
  });

  test("a UTC-midnight date on the year boundary keeps its day", async () => {
    function NewYear() {
      const [open, setOpen] = useState(true);
      return (
        <EditTimeEntryDialog
          open={open}
          onOpenChange={setOpen}
          entry={{ ...ENTRY, date: parseDateOnly("2026-01-01")! }}
        />
      );
    }
    render(<NewYear />);
    await screen.findByText("Edit time entry");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-01-01");
  });
});

describe("EditTimeEntryDialog — stale errors and reseeding", () => {
  test("a cancelled attempt's validation error is gone when the dialog reopens", async () => {
    vi.mocked(updateTimeEntry).mockResolvedValueOnce({
      status: "error",
      errors: { hours: ["Hours required"] },
    });
    const user = userEvent.setup();
    render(<Harness />);

    await openDialog(user);
    await save(user);
    await screen.findByText("Hours required");

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() =>
      expect(screen.queryByText("Edit time entry")).not.toBeInTheDocument()
    );

    await openDialog(user);
    expect(screen.queryByText("Hours required")).not.toBeInTheDocument();
  });

  test("reopening reseeds the fields from the entry, discarding abandoned edits", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);

    const activity = screen.getByPlaceholderText(/activity/i);
    await user.clear(activity);
    await user.type(activity, "Something I abandoned");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() =>
      expect(screen.queryByText("Edit time entry")).not.toBeInTheDocument()
    );

    await openDialog(user);
    expect(screen.getByPlaceholderText(/activity/i)).toHaveValue(
      "Deposition prep"
    );
  });
});

describe("EditTimeEntryDialog — accessibility and status errors", () => {
  test("status select and hours input have accessible names", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);

    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Hours" })).toBeInTheDocument();
  });

  test("never offers 'Billed' in the status picker", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);

    const options = within(
      screen.getByRole("combobox", { name: "Status" })
    ).getAllByRole("option");
    expect(options.map((o) => o.textContent)).not.toContain("Billed");
  });

  test("a rejected status is displayed under the picker", async () => {
    vi.mocked(updateTimeEntry).mockResolvedValueOnce({
      status: "error",
      errors: { status: ["Entries are marked billed by invoice generation."] },
    });
    const user = userEvent.setup();
    render(<Harness />);
    await openDialog(user);
    await save(user);

    expect(
      await screen.findByText(/marked billed by invoice generation/i)
    ).toBeInTheDocument();
  });
});
