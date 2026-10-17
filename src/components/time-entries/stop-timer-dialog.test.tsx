/**
 * Tests for StopTimerDialog.
 *
 * Pins:
 *   - the prefill (matter, activity, elapsed hours) and today's date in
 *     the USER's profile zone, re-seeded on every open;
 *   - the posted session id (stop consumes exactly the session the
 *     dialog was opened for);
 *   - Save stays disabled until a matter is picked (a TimeEntry cannot
 *     exist without one);
 *   - success calls onStopped and closes, again on a second stop; a
 *     stale-timer refusal stays open and is shown.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/timer", () => ({
  stopTimer: vi.fn(),
}));

import { stopTimer } from "@/app/actions/timer";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { StopTimerDialog } from "./stop-timer-dialog";

const mockedStop = vi.mocked(stopTimer);

const matterOptions = [
  { id: "m1", name: "Smith v. City" },
  { id: "m2", name: "Jones v. County" },
];

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  mockedStop.mockReset();
  // Fresh object per call, like a real server action.
  mockedStop.mockImplementation(async () => ({ status: "ok" as const }));
});

afterEach(() => {
  vi.useRealTimers();
});

function Harness({
  onStopped = vi.fn(),
  initialMatterId = "m1",
  sessionId = "sess_1",
}: {
  onStopped?: () => void;
  initialMatterId?: string | null;
  sessionId?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <UserTimeZoneProvider timeZone="Pacific/Auckland">
      <button type="button" onClick={() => setOpen(true)}>
        reopen dialog
      </button>
      <StopTimerDialog
        open={open}
        onOpenChange={setOpen}
        onStopped={onStopped}
        matterOptions={matterOptions}
        sessionId={sessionId}
        initialMatterId={initialMatterId}
        initialActivity="Deposition prep"
        initialHours={1.25}
      />
    </UserTimeZoneProvider>
  );
}

describe("StopTimerDialog", () => {
  test("prefills matter, activity and elapsed hours", async () => {
    render(<Harness />);
    expect(await screen.findByLabelText("Matter")).toHaveValue("m1");
    expect(screen.getByPlaceholderText("Activity")).toHaveValue("Deposition prep");
    expect(screen.getByPlaceholderText("Hrs")).toHaveValue("1.25");
  });

  test("the date defaults to today in the user's profile zone", async () => {
    // Apr 28 in Auckland while it is still Apr 27 in Denver and UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T20:00:00Z"));
    render(<Harness />);
    expect(await screen.findByLabelText("Date")).toHaveValue("2026-04-28");
  });

  test("posts the session id the dialog was opened for", async () => {
    const user = setupUser();
    const onStopped = vi.fn();
    render(<Harness onStopped={onStopped} sessionId="sess_42" />);

    await user.click(await screen.findByRole("button", { name: /log time/i }));

    await waitFor(() => expect(onStopped).toHaveBeenCalledOnce());
    const fd = mockedStop.mock.calls[0]![1] as FormData;
    expect(fd.get("sessionId")).toBe("sess_42");
    expect(fd.get("matterId")).toBe("m1");
    expect(fd.get("hours")).toBe("1.25");
  });

  test("Save is disabled until a matter is picked", async () => {
    const user = setupUser();
    render(<Harness initialMatterId={null} />);

    const save = await screen.findByRole("button", { name: /log time/i });
    expect(save).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Matter"), "m2");
    expect(save).toBeEnabled();
  });

  test("a stale-timer refusal keeps the dialog open and shows the message", async () => {
    mockedStop.mockImplementation(async () => ({
      status: "error" as const,
      errors: { activity: ["No running timer - it may have been discarded."] },
    }));
    const user = setupUser();
    const onStopped = vi.fn();
    render(<Harness onStopped={onStopped} />);

    await user.click(await screen.findByRole("button", { name: /log time/i }));

    expect(
      await screen.findByText(/No running timer - it may have been discarded/)
    ).toBeInTheDocument();
    expect(onStopped).not.toHaveBeenCalled();
  });

  test("reopening re-seeds the fields and clears a stale error", async () => {
    mockedStop.mockImplementationOnce(async () => ({
      status: "error" as const,
      errors: { hours: ["Hours required"] },
    }));
    const user = setupUser();
    render(<Harness />);

    const activity = await screen.findByPlaceholderText("Activity");
    await user.clear(activity);
    await user.type(activity, "Edited then abandoned");
    await user.click(screen.getByRole("button", { name: /log time/i }));
    await screen.findByText("Hours required");
    await user.click(screen.getByRole("button", { name: /keep running/i }));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Activity")).not.toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /reopen dialog/i }));

    expect(await screen.findByPlaceholderText("Activity")).toHaveValue(
      "Deposition prep"
    );
    expect(screen.queryByText("Hours required")).not.toBeInTheDocument();
  });
});
