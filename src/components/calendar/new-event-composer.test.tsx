/**
 * Tests for the docked quick composer (NewEventComposer).
 *
 * Pinned behaviours: wall-clock defaults / posts in the user's
 * profile zone, the all-day toggle reseeds 9-10am on the way back to
 * timed (it used to leave a zero-length midnight event), validation
 * errors keep the typed fields, and the dock is closed on success
 * without a redundant router.refresh (the action revalidates).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/actions/calendar-events", () => ({
  createCalendarEvent: vi.fn(),
}));

import { createCalendarEvent } from "@/app/actions/calendar-events";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { NewEventComposer } from "./new-event-composer";

const createMock = vi.mocked(createCalendarEvent);

function renderComposer(onClose?: () => void) {
  return render(
    <UserTimeZoneProvider timeZone="America/Denver">
      <NewEventComposer onClose={onClose} />
    </UserTimeZoneProvider>
  );
}

const submit = () =>
  act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /create event/i }).closest("form")!);
  });

beforeEach(() => {
  vi.clearAllMocks();
  createMock.mockReset();
  createMock.mockResolvedValue({ status: "idle" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-06T15:20:00Z")); // 09:20 Denver
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NewEventComposer", () => {
  test("defaults to the next top-of-hour on the user's wall clock and posts it as typed", async () => {
    renderComposer();
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-07-06T10:00");
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Focus time" },
    });
    await submit();

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const fd = createMock.mock.calls[0]![1];
    expect(fd.get("startTime")).toBe("2026-07-06T10:00");
    expect(fd.get("endTime")).toBe("2026-07-06T11:00");
  });

  test("toggling all-day off after picking dates reseeds 9-10am instead of midnight", () => {
    renderComposer();
    const allDay = screen.getByRole("checkbox", { name: "All day" });
    fireEvent.click(allDay);
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-07-09" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-07-09" },
    });
    fireEvent.click(allDay);
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-07-09T09:00");
    expect(screen.getByLabelText("Ends")).toHaveValue("2026-07-09T10:00");
  });

  test("all-day posts date-only keys", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("checkbox", { name: "All day" }));
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Retreat" },
    });
    await submit();
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const fd = createMock.mock.calls[0]![1];
    expect(fd.get("isAllDay")).toBe("on");
    expect(fd.get("startTime")).toBe("2026-07-06");
    expect(fd.get("endTime")).toBe("2026-07-06");
  });

  test("a validation error keeps the typed fields", async () => {
    createMock.mockResolvedValueOnce({
      status: "error",
      errors: { title: ["Title is required"] },
    });
    renderComposer();
    fireEvent.change(screen.getByPlaceholderText(/Location/), {
      target: { value: "Courtroom 5B" },
    });
    await submit();
    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Location/)).toHaveValue("Courtroom 5B");
  });

  test("closes the dock on success without a second router.refresh", async () => {
    createMock.mockResolvedValueOnce({ status: "ok", eventId: "ev1" });
    const onClose = vi.fn();
    renderComposer(onClose);
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Focus time" },
    });
    await submit();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /create event/i })).toBeDisabled();
  });

  test("a bad video link blocks the submit", async () => {
    renderComposer();
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Call" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Zoom \/ video URL/), {
      target: { value: "not a link" },
    });
    await submit();
    expect(await screen.findByText(/valid video link/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
