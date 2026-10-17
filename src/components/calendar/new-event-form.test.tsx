/**
 * Tests for the full-page create form (NewEventForm).
 *
 * Pinned behaviours:
 *  - defaults and the posted schedule are wall-clock in the user's
 *    PROFILE zone (ADR-012), all-day posts date-only keys;
 *  - a validation error does not wipe the typed fields (React 19
 *    resets <form action> forms; we dispatch manually);
 *  - the Create button stays disabled after success while the
 *    redirect is in flight (no duplicate create);
 *  - a scheme-less video link is normalized, a bad one blocks submit;
 *  - the matter combobox no longer claims an invalid listbox role.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/calendar/events/new",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/actions/calendar-events", () => ({
  createCalendarEvent: vi.fn(),
}));

vi.mock("@/app/actions/attendee-search", () => ({
  searchAttendeesAction: vi.fn(async () => []),
}));

import { createCalendarEvent } from "@/app/actions/calendar-events";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import type { CreateCalendarEventState } from "@/lib/calendar-event-form";
import { NewEventForm } from "./new-event-form";

const createMock = vi.mocked(createCalendarEvent);

const MATTERS = [
  { id: "m1", name: "Smith v. Jones", color: "#336699", area: "Employment", isPinned: false },
];

function renderForm() {
  return render(
    <UserTimeZoneProvider timeZone="America/Denver">
      <NewEventForm matters={MATTERS} />
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
  // 2026-07-06 09:20 in Denver.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-06T15:20:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("defaults and posted schedule", () => {
  test("defaults to the next top-of-hour on the user's wall clock", () => {
    renderForm();
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-07-06T10:00");
    expect(screen.getByLabelText("Ends")).toHaveValue("2026-07-06T11:00");
  });

  test("posts the wall-clock strings untouched", async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Hearing" },
    });
    await submit();

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const fd = createMock.mock.calls[0]![1];
    expect(fd.get("title")).toBe("Hearing");
    expect(fd.get("startTime")).toBe("2026-07-06T10:00");
    expect(fd.get("endTime")).toBe("2026-07-06T11:00");
    expect(fd.get("isAllDay")).toBeNull();
    expect(fd.get("visibility")).toBe("default");
  });

  test("all-day posts date-only keys; toggling back to timed reseeds 9-10am", async () => {
    renderForm();
    const allDay = screen.getByRole("checkbox", { name: "All day" });
    fireEvent.click(allDay);
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-07-06");

    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Trial" },
    });
    await submit();
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const fd = createMock.mock.calls[0]![1];
    expect(fd.get("isAllDay")).toBe("on");
    expect(fd.get("startTime")).toBe("2026-07-06");
    expect(fd.get("endTime")).toBe("2026-07-06");

    // Back to timed: the all-day midnight placeholders become 9/10am.
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-07-08" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-07-08" },
    });
    fireEvent.click(allDay);
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-07-08T09:00");
    expect(screen.getByLabelText("Ends")).toHaveValue("2026-07-08T10:00");
  });
});

describe("error handling", () => {
  test("a validation error keeps what the user typed", async () => {
    const error: CreateCalendarEventState = {
      status: "error",
      errors: { endTime: ["End must be after start"] },
    };
    createMock.mockResolvedValueOnce(error);
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Hearing" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Location/), {
      target: { value: "Courtroom 5B" },
    });
    await submit();

    expect(await screen.findByText("End must be after start")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Event title/)).toHaveValue("Hearing");
    expect(screen.getByPlaceholderText(/Location/)).toHaveValue("Courtroom 5B");
  });

  test("a scheme-less video link is normalized before posting", async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Call" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Zoom \/ video URL/), {
      target: { value: "zoom.us/j/8123" },
    });
    await submit();
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0]![1].get("zoomUrl")).toBe(
      "https://zoom.us/j/8123"
    );
  });

  test("an unusable video link blocks the submit with a message", async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Call" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Zoom \/ video URL/), {
      target: { value: "javascript:alert(1)" },
    });
    await submit();
    expect(await screen.findByText(/valid video link/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("after success", () => {
  test("keeps Create disabled while the redirect is in flight and navigates to the event", async () => {
    createMock.mockResolvedValueOnce({ status: "ok", eventId: "ev1" });
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/Event title/), {
      target: { value: "Hearing" },
    });
    await submit();

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/calendar?event=ev1")
    );
    const button = screen.getByRole("button", { name: /opening/i });
    expect(button).toBeDisabled();
  });
});

describe("matter combobox", () => {
  test("lists matters as plain buttons without an invalid listbox role", () => {
    renderForm();
    const search = screen.getByRole("textbox", { name: "Search matters" });
    expect(search).not.toHaveAttribute("aria-expanded");
    expect(search).not.toHaveAttribute("aria-haspopup");
    fireEvent.focus(search);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Smith v\. Jones/ }));
    expect(screen.getByText("Smith v. Jones")).toBeInTheDocument();
  });
});
