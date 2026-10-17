/**
 * Tests for the task / deadline / event composers and the CaptureStack.
 *
 * Pins:
 *   - zone-aware defaults: with a Denver profile zone and an evening-in-
 *     Denver instant (already "tomorrow" in UTC), the time composer
 *     defaults to the Denver day and the event composer to the next
 *     Denver hour (ADR-012)
 *   - sibling kinds the viewer can't create are never offered, and the
 *     sibling-note Pin toggle follows notes.pin (a denied sibling would
 *     redirect to `/` and lose the draft)
 *   - a validation error keeps what the user typed (no <form action>
 *     reset) and surfaces errors the old composers never rendered
 *     (event location, deadline source ref, form-level errors)
 *   - reset + collapse after a successful save, twice in a row
 *   - selects carry accessible names
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CaptureFormState } from "@/lib/capture-schemas";

const mocks = vi.hoisted(() => ({
  task: vi.fn(),
  event: vi.fn(),
  deadline: vi.fn(),
  time: vi.fn(),
}));

vi.mock("@/app/actions/captures", () => ({
  createTaskWithCaptures: mocks.task,
  createEventWithCaptures: mocks.event,
  createDeadlineWithCaptures: mocks.deadline,
  createTimeEntryWithCaptures: mocks.time,
}));

import { TaskComposer } from "./task-composer";
import { DeadlineComposer } from "./deadline-composer";
import { EventComposer } from "./event-composer";
import { TimeComposer } from "./time-composer";
import { UserTimeZoneProvider } from "@/components/user-time-zone";

const ok = async (): Promise<CaptureFormState> => ({ status: "ok" });

beforeEach(() => {
  for (const m of Object.values(mocks)) {
    m.mockReset();
    m.mockImplementation(ok);
  }
});

afterEach(() => {
  vi.useRealTimers();
});

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

const assignees = [{ id: "u1", name: "Ada Lovelace", initials: "AL" }];

describe("zone-aware defaults", () => {
  test("TimeComposer defaults the date to the PROFILE zone's today", async () => {
    // 2026-10-16T02:20Z is Oct 15, 8:20 PM in Denver but Oct 16 in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T02:20:00Z"));
    const user = userEvent.setup({
      pointerEventsCheck: 0,
      advanceTimers: () => {},
    });
    const { container } = render(
      <UserTimeZoneProvider timeZone="America/Denver">
        <TimeComposer matterId="m1" />
      </UserTimeZoneProvider>
    );
    await user.click(screen.getByRole("button", { name: /log time/i }));
    const date = container.querySelector(
      'input[name="date"]'
    ) as HTMLInputElement;
    expect(date.value).toBe("2026-10-15");
  });

  test("EventComposer defaults start/end to the next full hour in the PROFILE zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T02:20:00Z"));
    const user = userEvent.setup({
      pointerEventsCheck: 0,
      advanceTimers: () => {},
    });
    render(
      <UserTimeZoneProvider timeZone="America/Denver">
        <EventComposer matterId="m1" />
      </UserTimeZoneProvider>
    );
    await user.click(screen.getByRole("button", { name: /schedule an event/i }));
    expect((screen.getByLabelText("Starts") as HTMLInputElement).value).toBe(
      "2026-10-15T21:00"
    );
    expect((screen.getByLabelText("Ends") as HTMLInputElement).value).toBe(
      "2026-10-15T22:00"
    );
  });

  test("a sibling event added in the stack gets the same zone-aware defaults", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T02:20:00Z"));
    const user = userEvent.setup({
      pointerEventsCheck: 0,
      advanceTimers: () => {},
    });
    render(
      <UserTimeZoneProvider timeZone="America/Denver">
        <TaskComposer
          matterId="m1"
          assignees={assignees}
          currentUserId="u1"
        />
      </UserTimeZoneProvider>
    );
    await user.click(screen.getByRole("button", { name: /add a task/i }));
    await user.click(screen.getByRole("button", { name: /event/i }));
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe(
      "2026-10-15T21:00"
    );
  });
});

describe("sibling kinds follow the viewer's permissions", () => {
  test("only the permitted kinds are offered, and Pin is hidden without notes.pin", async () => {
    const user = setupUser();
    render(
      <TaskComposer
        matterId="m1"
        assignees={assignees}
        currentUserId="u1"
        siblingKinds={["time", "note_sibling"]}
        canPin={false}
      />
    );
    await user.click(screen.getByRole("button", { name: /add a task/i }));
    expect(screen.getByRole("button", { name: /time/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^\+?\s*event/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deadline/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /note/i }));
    expect(screen.queryByLabelText(/^pin$/i)).toBeNull();
    expect(screen.queryByText("Pin")).toBeNull();
  });

  test("omitting the props keeps today's behaviour (every kind, Pin shown)", async () => {
    const user = setupUser();
    render(<DeadlineComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /add a deadline/i }));
    for (const kind of [/task/i, /event/i, /time/i, /note/i]) {
      expect(screen.getByRole("button", { name: kind })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: /note/i }));
    expect(screen.getByText("Pin")).toBeInTheDocument();
  });
});

describe("validation errors", () => {
  test("a failed save keeps what the user typed", async () => {
    mocks.task.mockImplementation(async () => ({
      status: "error" as const,
      errors: { dueDate: ["Invalid due date"] },
    }));
    const user = setupUser();
    render(
      <TaskComposer matterId="m1" assignees={assignees} currentUserId="u1" />
    );
    await user.click(screen.getByRole("button", { name: /add a task/i }));
    await user.type(screen.getByPlaceholderText("Task title"), "Serve subpoena");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Priority" }),
      "urgent"
    );
    await user.click(screen.getByRole("button", { name: /save task/i }));

    expect(await screen.findByText("Invalid due date")).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText("Task title") as HTMLInputElement).value
    ).toBe("Serve subpoena");
    expect(
      (screen.getByRole("combobox", { name: "Priority" }) as HTMLSelectElement)
        .value
    ).toBe("urgent");
  });

  test("event location and deadline source ref errors are shown", async () => {
    mocks.event.mockImplementation(async () => ({
      status: "error" as const,
      errors: { location: ["Too long (max 200)"] },
    }));
    mocks.deadline.mockImplementation(async () => ({
      status: "error" as const,
      errors: { sourceRef: ["Source too long"] },
    }));
    const user = setupUser();

    const ev = render(<EventComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /schedule an event/i }));
    await user.type(screen.getByPlaceholderText(/event title/i), "Hearing");
    await user.click(screen.getByRole("button", { name: /save event/i }));
    expect(await screen.findByText("Too long (max 200)")).toBeInTheDocument();
    ev.unmount();

    render(<DeadlineComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /add a deadline/i }));
    await user.type(screen.getByPlaceholderText(/deadline title/i), "Answer");
    await user.type(screen.getByLabelText("Due date"), "2026-10-16");
    await user.click(screen.getByRole("button", { name: /save deadline/i }));
    expect(await screen.findByText("Source too long")).toBeInTheDocument();
  });

  test("a form-level error (stale matter) is shown, not swallowed", async () => {
    mocks.deadline.mockImplementation(async () => ({
      status: "error" as const,
      errors: { _form: ["This matter no longer exists. Reload the page."] },
    }));
    const user = setupUser();
    render(<DeadlineComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /add a deadline/i }));
    await user.type(screen.getByPlaceholderText(/deadline title/i), "Answer");
    await user.type(screen.getByLabelText("Due date"), "2026-10-16");
    await user.click(screen.getByRole("button", { name: /save deadline/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no longer exists/i
    );
  });
});

describe("reset and collapse after a successful save", () => {
  test("works twice in a row and clears the fields", async () => {
    const user = setupUser();
    render(
      <TaskComposer matterId="m1" assignees={assignees} currentUserId="u1" />
    );
    for (let round = 1; round <= 2; round++) {
      await user.click(screen.getByRole("button", { name: /add a task/i }));
      const title = screen.getByPlaceholderText("Task title") as HTMLInputElement;
      expect(title.value).toBe("");
      await user.type(title, `Task ${round}`);
      await user.click(screen.getByRole("button", { name: /save task/i }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /add a task/i })
        ).toBeInTheDocument()
      );
      expect(mocks.task).toHaveBeenCalledTimes(round);
    }
  });
});

describe("accessible names", () => {
  test("selects in the composers and the stack are named", async () => {
    const user = setupUser();
    render(<EventComposer matterId="m1" />);
    await user.click(screen.getByRole("button", { name: /schedule an event/i }));
    expect(
      screen.getByRole("combobox", { name: "Event type" })
    ).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /deadline/i }));
    });
    expect(
      screen.getByRole("combobox", { name: "Deadline kind" })
    ).toBeInTheDocument();
  });
});
