/**
 * PinToggle — sends the state the user clicked toward (so a stale view
 * can't invert the intent) and reports failures instead of throwing
 * into the error boundary (F783).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/matter-pins", () => ({
  setMatterPin: vi.fn(),
}));

import { setMatterPin } from "@/app/actions/matter-pins";
import { notifyError } from "@/lib/feedback";
import { PinToggle } from "./pin-toggle";

const mockedSet = vi.mocked(setMatterPin);

beforeEach(() => {
  mockedSet.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PinToggle", () => {
  test("an unpinned matter is pinned explicitly", async () => {
    mockedSet.mockResolvedValue({ ok: true, pinned: true });
    render(<PinToggle matterId="m1" initialPinned={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin matter" }));
    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith("m1", true));
  });

  test("a pinned matter is unpinned explicitly", async () => {
    mockedSet.mockResolvedValue({ ok: true, pinned: false });
    render(<PinToggle matterId="m1" initialPinned />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin matter" }));
    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith("m1", false));
  });

  test("a refused pin toasts and the button returns to its real state", async () => {
    mockedSet.mockResolvedValue({ ok: false, pinned: false, error: "Couldn't update the pin." });
    render(<PinToggle matterId="m1" initialPinned={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin matter" }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't update the pin."));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pin matter" })).toBeInTheDocument(),
    );
  });

  test("a thrown action toasts instead of escaping to the error boundary", async () => {
    mockedSet.mockRejectedValue(new Error("boom"));
    render(<PinToggle matterId="m1" initialPinned={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin matter" }));
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
  });
});
