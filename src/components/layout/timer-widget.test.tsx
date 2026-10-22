/**
 * Tests for TimerWidget: start-conflict handling, action-failure
 * handling, the activity draft, discard confirm, and the Stop gate.
 *
 * The idle pill renders from a server snapshot that can be stale in
 * another tab/device. startTimer now refuses to replace a running
 * clock; the widget must drop its optimistic "running" copy and
 * re-read the server state (router.refresh) instead of pretending a
 * fresh clock started.
 *
 * Action failures (deploy skew, DB error) must surface as an inline
 * alert and roll the optimistic state back — never rethrow into an
 * error boundary (this widget lives in the layout, so that would
 * replace the whole app).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/timer", () => ({
  startTimer: vi.fn(),
  updateTimer: vi.fn(),
  discardTimer: vi.fn(),
  stopTimer: vi.fn(),
}));
// The real dialog pulls in the whole time-entry form + server action;
// the widget only needs to hand it `open`.
vi.mock("@/components/time-entries/stop-timer-dialog", () => ({
  StopTimerDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">stop dialog</div> : null,
}));

import { discardTimer, startTimer, updateTimer } from "@/app/actions/timer";
import type { ActiveTimerSession } from "@/lib/queries/timer";
import { TimerWidget, TIMER_NETWORK_ERROR } from "./timer-widget";

const mockedStart = vi.mocked(startTimer);
const mockedUpdate = vi.mocked(updateTimer);
const mockedDiscard = vi.mocked(discardTimer);

const running = (over: Partial<ActiveTimerSession> = {}): ActiveTimerSession => ({
  id: "t1",
  matterId: null,
  matterName: null,
  activity: null,
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Click without user-event (its delays fight fake timers). */
function fireClick(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

describe("TimerWidget — start", () => {
  test("a refused start (timer already running elsewhere) reverts the optimistic pill and refreshes", async () => {
    mockedStart.mockResolvedValue({
      ok: false,
      code: "already_running",
      error: "A timer is already running.",
    });
    render(<TimerWidget session={null} matterOptions={[]} />);

    await userEvent.click(screen.getByRole("button", { name: /timer/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Back to the idle pill; no phantom running clock.
    expect(screen.queryByLabelText("Stop timer")).toBeNull();
    expect(screen.getByTitle("Start a timer")).toBeInTheDocument();
  });

  test("a successful start keeps the running pill and does not force a refresh", async () => {
    mockedStart.mockResolvedValue({ ok: true });
    render(<TimerWidget session={null} matterOptions={[]} />);

    await userEvent.click(screen.getByRole("button", { name: /timer/i }));

    expect(await screen.findByLabelText("Stop timer")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("the Stop button is disabled until the server session id replaces the optimistic one", async () => {
    mockedStart.mockResolvedValue({ ok: true });
    render(<TimerWidget session={null} matterOptions={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /timer/i }));
    expect(await screen.findByLabelText("Stop timer")).toBeDisabled();
  });
});

describe("TimerWidget — action failures never escape to an error boundary", () => {
  test("a thrown startTimer (deploy skew) reverts the pill and shows an inline error", async () => {
    mockedStart.mockRejectedValue(new Error("Server Action not found"));
    render(<TimerWidget session={null} matterOptions={[]} />);

    await userEvent.click(screen.getByRole("button", { name: /timer/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(TIMER_NETWORK_ERROR);
    expect(screen.getByTitle("Start a timer")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  test("a thrown discardTimer restores the running pill and shows an error", async () => {
    mockedDiscard.mockRejectedValue(new Error("pool timeout"));
    render(<TimerWidget session={running()} matterOptions={[]} />);

    await userEvent.click(screen.getByLabelText("Discard timer"));
    await userEvent.click(screen.getByLabelText("Confirm discard"));

    expect(await screen.findByRole("alert")).toHaveTextContent(TIMER_NETWORK_ERROR);
    // The clock is still running: the discard did not happen.
    expect(screen.getByLabelText("Stop timer")).toBeInTheDocument();
  });

  test("a failed matter re-point ({ ok: false }) rolls the picker back", async () => {
    mockedUpdate.mockResolvedValue({ ok: false, error: "Matter not found" });
    render(
      <TimerWidget session={running()} matterOptions={[{ id: "m1", name: "Smith v. Jones" }]} />,
    );
    await userEvent.click(screen.getByTitle("Edit timer matter / activity"));
    await userEvent.selectOptions(screen.getByLabelText("Timer matter"), "m1");

    expect(await screen.findByRole("alert")).toHaveTextContent("Matter not found");
    expect(screen.getByLabelText("Timer matter")).toHaveValue("");
    expect(refresh).toHaveBeenCalled();
  });

  test("a successful matter re-point calls updateTimer and shows no error", async () => {
    mockedUpdate.mockResolvedValue({ ok: true });
    render(
      <TimerWidget session={running()} matterOptions={[{ id: "m1", name: "Smith v. Jones" }]} />,
    );
    await userEvent.click(screen.getByTitle("Edit timer matter / activity"));
    await userEvent.selectOptions(screen.getByLabelText("Timer matter"), "m1");

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith({ matterId: "m1" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Timer matter")).toHaveValue("m1");
  });
});

describe("TimerWidget — activity draft", () => {
  test("text being typed survives a server payload (new object, changed content) landing mid-typing", async () => {
    mockedUpdate.mockResolvedValue({ ok: true });
    const opts = [{ id: "m1", name: "Smith v. Jones" }];
    const base = running();
    const { rerender } = render(<TimerWidget session={base} matterOptions={opts} />);
    await userEvent.click(screen.getByTitle("Edit timer matter / activity"));
    await userEvent.type(screen.getByLabelText("Timer activity"), "Draft mo");

    // The layout revalidation from an earlier matter change lands now:
    // activity is still null server-side.
    rerender(
      <TimerWidget
        session={{ ...base, matterId: "m1", matterName: "Smith v. Jones" }}
        matterOptions={opts}
      />,
    );
    expect(screen.getByLabelText("Timer activity")).toHaveValue("Draft mo");

    await userEvent.type(screen.getByLabelText("Timer activity"), "tion");
    expect(screen.getByLabelText("Timer activity")).toHaveValue("Draft motion");
  });

  test("blur persists the trimmed activity once", async () => {
    mockedUpdate.mockResolvedValue({ ok: true });
    render(<TimerWidget session={running()} matterOptions={[]} />);
    await userEvent.click(screen.getByTitle("Edit timer matter / activity"));
    await userEvent.type(screen.getByLabelText("Timer activity"), "  Research ");
    await userEvent.tab();

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith({ activity: "Research" }));
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  test("a payload identical in content (fresh object) does not reset a local change", async () => {
    mockedUpdate.mockResolvedValue({ ok: true });
    const base = running();
    const opts = [{ id: "m1", name: "Smith v. Jones" }];
    const { rerender } = render(<TimerWidget session={base} matterOptions={opts} />);
    await userEvent.click(screen.getByTitle("Edit timer matter / activity"));
    await userEvent.selectOptions(screen.getByLabelText("Timer matter"), "m1");

    // Unrelated revalidation (bell, pins...): same content as before the
    // local change, fresh object identity.
    rerender(<TimerWidget session={{ ...base }} matterOptions={opts} />);
    expect(screen.getByLabelText("Timer matter")).toHaveValue("m1");
  });
});

describe("TimerWidget — running clock, discard confirm, stop gate", () => {
  test("elapsed ticks every second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
    render(
      <TimerWidget session={running({ startedAt: "2026-04-15T11:59:00Z" })} matterOptions={[]} />,
    );
    expect(screen.getByText("0:01:00")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("0:01:03")).toBeInTheDocument();
  });

  test("Discard needs two clicks and disarms after 4s", async () => {
    vi.useFakeTimers();
    mockedDiscard.mockResolvedValue({ ok: true });
    render(<TimerWidget session={running()} matterOptions={[]} />);

    fireClick(screen.getByLabelText("Discard timer"));
    expect(screen.getByLabelText("Confirm discard")).toBeInTheDocument();
    expect(mockedDiscard).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(screen.getByLabelText("Discard timer")).toBeInTheDocument();
    expect(mockedDiscard).not.toHaveBeenCalled();

    fireClick(screen.getByLabelText("Discard timer"));
    fireClick(screen.getByLabelText("Confirm discard"));
    await act(async () => {});
    expect(mockedDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Start a timer")).toBeInTheDocument();
  });

  test("Stop opens the dialog for users who can log time", async () => {
    render(<TimerWidget session={running()} matterOptions={[]} />);
    await userEvent.click(screen.getByLabelText("Stop timer"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("Stop is disabled (with a reason) without time_entries.create; Discard still works", () => {
    render(<TimerWidget session={running()} matterOptions={[]} canLogTime={false} />);
    const stop = screen.getByLabelText("Stop timer");
    expect(stop).toBeDisabled();
    expect(stop).toHaveAttribute("title", "You do not have permission to log time");
    expect(screen.getByLabelText("Discard timer")).toBeEnabled();
  });
});
