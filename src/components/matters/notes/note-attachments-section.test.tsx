/**
 * Tests for NoteAttachmentsSection.
 *
 * Two regressions pinned here:
 *
 * 1. aggregateByUser used to key the per-user rollup by initials
 *    alone, so two distinct users sharing initials (two "JS"es)
 *    got their hours summed into one row shown under the first
 *    user's name. It now keys by name+initials — rows only merge
 *    when the displayed attribution is identical.
 *
 * 2. TaskChip / DeadlineChip deletes used to discard the action's
 *    `{ ok, error }` result, so a failed delete (e.g. "Task not
 *    found") left the chip in place with zero feedback. They must
 *    surface the error like TimeEntryItem does.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function renderSection(over: {
  tasks?: NoteAttachedTask[];
  deadlines?: NoteAttachedDeadline[];
  timeEntries?: NoteAttachedTimeEntry[];
}) {
  return render(
    <NoteAttachmentsSection
      noteId="n1"
      matterId="m1"
      tasks={over.tasks ?? []}
      deadlines={over.deadlines ?? []}
      timeEntries={over.timeEntries ?? []}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom doesn't implement confirm/alert — stub both so the
  // chips' confirm() gate passes and alert() calls are observable.
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aggregateByUser — per-user rollup identity", () => {
  test("distinct users sharing initials get separate rows, not one merged row", () => {
    const rows = aggregateByUser([
      entry({ id: "a", userName: "John Smith", userInitials: "JS", hours: 2 }),
      entry({ id: "b", userName: "Jane Salerno", userInitials: "JS", hours: 5 }),
    ]);

    expect(rows).toHaveLength(2);
    // Sorted hours-desc, each under their own name.
    expect(rows[0]).toMatchObject({ name: "Jane Salerno", hours: 5 });
    expect(rows[1]).toMatchObject({ name: "John Smith", hours: 2 });
  });

  test("entries from the same user (name + initials match) still merge", () => {
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
      entry({ id: "a", userName: "John Smith", userInitials: "JS" }),
      entry({ id: "b", userName: "Jane Salerno", userInitials: "JS" }),
    ]);

    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
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
