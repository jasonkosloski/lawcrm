/**
 * Tests for NoteAttachmentsSection.
 *
 * Regressions pinned here:
 *
 * 1. aggregateByUser used to key the per-user rollup by initials
 *    alone, so two distinct users sharing initials (two "JS"es)
 *    got their hours summed into one row shown under the first
 *    user's name. It now keys by user id.
 *
 * 2. TaskChip / DeadlineChip deletes used to discard the action's
 *    `{ ok, error }` result, so a failed delete (e.g. "Task not
 *    found") left the chip in place with zero feedback. They must
 *    surface the error like TimeEntryItem does.
 *
 * 3. Date-only values (due dates, time-entry dates) are UTC-midnight
 *    calendar dates (ADR-012). The chips used to format them with the
 *    browser's zone - a day early west of UTC - and flagged a
 *    deadline overdue the evening before it was due. They must show
 *    the stored calendar day and compare it to the viewer's today.
 *
 * 4. Controls follow the viewer's `access`: nothing is offered that
 *    the server would bounce to the dashboard.
 *
 * Runs in both the developer's zone and TZ=UTC (npm run test:utc).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Pure anchor stand-in — chips only need href-based navigation and
// next/link wants router context that doesn't exist in tests.
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

vi.mock("@/app/actions/tasks", () => ({ deleteTask: vi.fn() }));
vi.mock("@/app/actions/deadlines", () => ({ deleteDeadline: vi.fn() }));
vi.mock("@/app/actions/time-entries", () => ({ deleteTimeEntry: vi.fn() }));
vi.mock("@/app/actions/note-attachments", () => ({
  addCapturesToNoteBulk: vi.fn(),
}));

import { deleteTask } from "@/app/actions/tasks";
import { deleteDeadline } from "@/app/actions/deadlines";
import { parseDateOnly } from "@/lib/format-date";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { NO_NOTE_ACCESS, type NoteAccess } from "@/lib/note-constants";
import type {
  NoteAttachedDeadline,
  NoteAttachedTask,
  NoteAttachedTimeEntry,
} from "@/lib/queries/matter-detail";
import {
  aggregateByUser,
  NoteAttachmentsSection,
} from "./note-attachments-section";

const entry = (
  over: Partial<NoteAttachedTimeEntry> = {}
): NoteAttachedTimeEntry => ({
  id: "te1",
  userId: "u-js",
  date: new Date("2026-07-01T12:00:00Z"),
  hours: 1,
  activity: "Research",
  narrative: null,
  billable: true,
  noCharge: false,
  privileged: false,
  status: "draft",
  userName: "John Smith",
  userInitials: "JS",
  ...over,
});

const task = (over: Partial<NoteAttachedTask> = {}): NoteAttachedTask => ({
  id: "t1",
  title: "File the motion",
  status: "open",
  priority: "normal",
  dueDate: null,
  ...over,
});

const deadline = (
  over: Partial<NoteAttachedDeadline> = {}
): NoteAttachedDeadline => ({
  id: "d1",
  title: "Answer due",
  status: "open",
  kind: "standard",
  dueDate: new Date("2099-01-15T12:00:00Z"),
  ...over,
});

/** Everything allowed - the baseline most tests render with. */
const FULL_ACCESS: NoteAccess = {
  userId: "u-js",
  canCreateNote: true,
  canPin: true,
  canDeleteAnyNote: true,
  canEditAnyNote: true,
  canCreateTask: true,
  canDeleteTask: true,
  canCreateDeadline: true,
  canDeleteDeadline: true,
  canCreateTime: true,
  canDeleteAnyTime: true,
  canCreateEvent: true,
};

function renderSection(over: {
  tasks?: NoteAttachedTask[];
  deadlines?: NoteAttachedDeadline[];
  timeEntries?: NoteAttachedTimeEntry[];
  access?: NoteAccess;
}) {
  return render(
    <UserTimeZoneProvider timeZone="America/Denver">
      <NoteAttachmentsSection
        noteId="n1"
        matterId="m1"
        tasks={over.tasks ?? []}
        deadlines={over.deadlines ?? []}
        timeEntries={over.timeEntries ?? []}
        access={over.access ?? FULL_ACCESS}
      />
    </UserTimeZoneProvider>
  );
}

const chipOf = (title: string): HTMLElement | null =>
  screen.getByText(title).closest("[class*='group/chip']");

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom doesn't implement confirm/alert — stub both so the
  // chips' confirm() gate passes and alert() calls are observable.
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("aggregateByUser — per-user rollup identity", () => {
  test("distinct users sharing initials get separate rows, not one merged row", () => {
    const rows = aggregateByUser([
      entry({
        id: "a",
        userId: "u1",
        userName: "John Smith",
        userInitials: "JS",
        hours: 2,
      }),
      entry({
        id: "b",
        userId: "u2",
        userName: "Jane Salerno",
        userInitials: "JS",
        hours: 5,
      }),
    ]);

    expect(rows).toHaveLength(2);
    // Sorted hours-desc, each under their own name.
    expect(rows[0]).toMatchObject({ name: "Jane Salerno", hours: 5 });
    expect(rows[1]).toMatchObject({ name: "John Smith", hours: 2 });
  });

  test("entries from the same user still merge", () => {
    const rows = aggregateByUser([
      entry({ id: "a", hours: 1.5 }),
      entry({ id: "b", hours: 0.5 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "John Smith",
      initials: "JS",
      hours: 2,
    });
  });

  test("rows carry a collision-safe React key (unique across shared initials)", () => {
    const rows = aggregateByUser([
      entry({
        id: "a",
        userId: "u1",
        userName: "John Smith",
        userInitials: "JS",
      }),
      entry({
        id: "b",
        userId: "u2",
        userName: "Jane Salerno",
        userInitials: "JS",
      }),
    ]);

    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  test("two different people with the SAME name and initials stay separate", () => {
    const rows = aggregateByUser([
      entry({ id: "a", userId: "u1", hours: 1 }),
      entry({ id: "b", userId: "u2", hours: 2 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("chip deletes surface action failures", () => {
  test("task chip: failed delete alerts with the action's error", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteTask).mockResolvedValue({
      ok: false,
      error: "Task not found",
    });

    renderSection({ tasks: [task()] });
    await user.click(screen.getByRole("button", { name: "Delete task" }));

    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith("Task not found")
    );
  });

  test("deadline chip: failed delete alerts with the action's error", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteDeadline).mockResolvedValue({
      ok: false,
      error: "Deadline not found",
    });

    renderSection({ deadlines: [deadline()] });
    await user.click(screen.getByRole("button", { name: "Delete deadline" }));

    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith("Deadline not found")
    );
  });

  test("task chip: successful delete stays silent", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteTask).mockResolvedValue({ ok: true });

    renderSection({ tasks: [task()] });
    await user.click(screen.getByRole("button", { name: "Delete task" }));

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("t1"));
    expect(window.alert).not.toHaveBeenCalled();
  });
});

describe("date-only values show the stored calendar day (ADR-012)", () => {
  test("task chip shows Apr 15 for a 2026-04-15 due date, not Apr 14", () => {
    // 00:00Z renders as Apr 14 in Denver with any zone-applying
    // formatter - the old local-getter code showed the day before.
    renderSection({
      tasks: [task({ dueDate: parseDateOnly("2026-04-15") })],
    });
    expect(screen.getByText("Apr 15")).toBeInTheDocument();
    expect(screen.queryByText("Apr 14")).toBeNull();
  });

  test("deadline chip shows the stored day", () => {
    renderSection({
      deadlines: [deadline({ dueDate: parseDateOnly("2026-04-16")! })],
    });
    expect(screen.getByText("Apr 16")).toBeInTheDocument();
  });

  test("expanded time entry shows the stored day", async () => {
    const user = userEvent.setup();
    renderSection({
      timeEntries: [entry({ date: parseDateOnly("2026-04-15")! })],
    });
    await user.click(screen.getByRole("button", { name: /expand time/i }));
    expect(screen.getByText("Apr 15")).toBeInTheDocument();
  });

  test("a deadline due today (viewer's evening) is NOT overdue", () => {
    // 2026-04-28T02:00Z is Apr 27, 8 PM in Denver. Due Apr 27 = today.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
    renderSection({
      deadlines: [deadline({ dueDate: parseDateOnly("2026-04-27")! })],
    });
    expect(chipOf("Answer due")?.className).not.toMatch(/bg-warn-soft/);
  });

  test("a deadline due yesterday IS overdue", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
    renderSection({
      deadlines: [deadline({ dueDate: parseDateOnly("2026-04-26")! })],
    });
    expect(chipOf("Answer due")?.className).toMatch(/bg-warn-soft/);
  });

  test("a completed deadline is never flagged overdue", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
    renderSection({
      deadlines: [
        deadline({
          status: "completed",
          dueDate: parseDateOnly("2026-04-01")!,
        }),
      ],
    });
    expect(chipOf("Answer due")?.className).not.toMatch(/bg-warn-soft/);
  });
});

describe("chip structure", () => {
  test("the delete button is a sibling of the link, never nested in it", () => {
    renderSection({ tasks: [task()], deadlines: [deadline()] });
    for (const name of ["Delete task", "Delete deadline"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn.closest("a")).toBeNull();
    }
  });

  test("the delete button is revealed on keyboard focus and on touch", () => {
    renderSection({ tasks: [task()] });
    const cls = screen.getByRole("button", { name: "Delete task" }).className;
    expect(cls).toContain("focus-visible:opacity-100");
    expect(cls).toContain("[@media(pointer:coarse)]:opacity-100");
  });
});

describe("controls follow the viewer's access", () => {
  test("no create/delete permissions: no Add buttons and no delete controls", () => {
    renderSection({
      tasks: [task()],
      deadlines: [deadline()],
      timeEntries: [entry({ userId: "someone-else" })],
      access: { ...NO_NOTE_ACCESS, userId: "u-me" },
    });
    expect(screen.queryByRole("button", { name: /add task/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add deadline/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /log time/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add multiple/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete deadline" })).toBeNull();
  });

  test("only the permitted Add buttons render; 'Add multiple' needs two kinds", () => {
    renderSection({
      access: { ...NO_NOTE_ACCESS, userId: "u", canCreateTask: true },
    });
    expect(screen.getByRole("button", { name: /add task/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add deadline/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add multiple/i })).toBeNull();
  });

  test("full access renders every Add button", () => {
    renderSection({});
    for (const name of [
      /add task/i,
      /add deadline/i,
      /log time/i,
      /add multiple/i,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  test("a time entry's author can delete it; others need time_entries.delete_any", async () => {
    const user = userEvent.setup();
    const mine = entry({ id: "mine", userId: "u-me", activity: "Mine" });
    const theirs = entry({
      id: "theirs",
      userId: "u-other",
      activity: "Theirs",
    });
    renderSection({
      timeEntries: [mine, theirs],
      access: { ...NO_NOTE_ACCESS, userId: "u-me" },
    });
    await user.click(screen.getByRole("button", { name: /expand time/i }));
    const items = screen.getAllByRole("listitem");
    expect(
      within(items[0]).queryByRole("button", { name: "Delete time entry" })
    ).not.toBeNull();
    expect(
      within(items[1]).queryByRole("button", { name: "Delete time entry" })
    ).toBeNull();
  });
});
