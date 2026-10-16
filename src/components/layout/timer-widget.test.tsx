/**
 * Tests for TimerWidget's start-conflict handling.
 *
 * The idle pill renders from a server snapshot that can be stale in
 * another tab/device. startTimer now refuses to replace a running
 * clock; the widget must drop its optimistic "running" copy and
 * re-read the server state (router.refresh) instead of pretending a
 * fresh clock started.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/timer", () => ({
  startTimer: vi.fn(),
  updateTimer: vi.fn(),
  discardTimer: vi.fn(),
  stopTimer: vi.fn(),
}));

import { startTimer } from "@/app/actions/timer";
import { TimerWidget } from "./timer-widget";

const mockedStart = vi.mocked(startTimer);

beforeEach(() => {
  vi.clearAllMocks();
});

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
