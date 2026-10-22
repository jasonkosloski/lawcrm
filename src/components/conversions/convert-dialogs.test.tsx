/**
 * Tests for the note → task and task → deadline convert dialogs.
 *
 * Pins: the working copy is re-seeded from the prefill on every open; a
 * server error keeps what was typed; a successful conversion asks the
 * parent to close — every time, not just the first.
 */

import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/conversions", () => ({
  convertNoteToTask: vi.fn(),
  convertTaskToDeadline: vi.fn(),
}));

import { convertNoteToTask, convertTaskToDeadline } from "@/app/actions/conversions";
import { ConvertNoteToTaskDialog, ConvertTaskToDeadlineDialog } from "./convert-dialogs";

const mockedNote = vi.mocked(convertNoteToTask);
const mockedTask = vi.mocked(convertTaskToDeadline);

function NoteHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <ConvertNoteToTaskDialog
        open={open}
        onOpenChange={setOpen}
        noteId="n1"
        defaultTitle="Call counsel"
        defaultDescription="About discovery"
      />
    </>
  );
}

function TaskHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <ConvertTaskToDeadlineDialog
        open={open}
        onOpenChange={setOpen}
        taskId="t1"
        defaultTitle="File notice"
        defaultDueDate="2026-04-15"
        defaultDescription=""
      />
    </>
  );
}

const openIt = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "open" }));

beforeEach(() => {
  mockedNote.mockReset();
  mockedTask.mockReset();
});

describe("ConvertNoteToTaskDialog", () => {
  test("reopening re-seeds the title and description from the prefill", async () => {
    const user = userEvent.setup();
    render(<NoteHarness />);
    await openIt(user);
    const title = screen.getByPlaceholderText("Task title");
    await user.clear(title);
    await user.type(title, "Edited");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await openIt(user);
    expect(screen.getByPlaceholderText("Task title")).toHaveValue("Call counsel");
    expect(screen.getByPlaceholderText("Description (optional)")).toHaveValue("About discovery");
  });

  test("a server error shows its message and keeps the typed title", async () => {
    const user = userEvent.setup();
    mockedNote.mockResolvedValue({
      status: "error",
      errors: { dueDate: ["Invalid due date"] },
    });
    render(<NoteHarness />);
    await openIt(user);
    const title = screen.getByPlaceholderText("Task title");
    await user.clear(title);
    await user.type(title, "Typed title");
    await user.click(screen.getByRole("button", { name: /convert to task/i }));
    expect(await screen.findByText("Invalid due date")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Task title")).toHaveValue("Typed title");
  });

  test("a successful conversion closes the dialog, every time", async () => {
    const user = userEvent.setup();
    mockedNote.mockResolvedValue({ status: "ok" });
    render(<NoteHarness />);
    for (let i = 0; i < 2; i++) {
      await openIt(user);
      await user.click(screen.getByRole("button", { name: /convert to task/i }));
      await waitFor(() =>
        expect(screen.queryByPlaceholderText("Task title")).not.toBeInTheDocument(),
      );
    }
    expect(mockedNote).toHaveBeenCalledTimes(2);
    expect(mockedNote.mock.calls[0][0]).toBe("n1");
  });
});

describe("ConvertTaskToDeadlineDialog", () => {
  test("prefills the due date from the task and re-seeds it on reopen", async () => {
    const user = userEvent.setup();
    render(<TaskHarness />);
    await openIt(user);
    const due = screen.getByLabelText("Due date");
    expect(due).toHaveValue("2026-04-15");
    await user.clear(due);
    await user.type(due, "2026-05-01");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await openIt(user);
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-04-15");
  });

  test("a successful conversion closes the dialog, every time", async () => {
    const user = userEvent.setup();
    mockedTask.mockResolvedValue({ status: "ok" });
    render(<TaskHarness />);
    for (let i = 0; i < 2; i++) {
      await openIt(user);
      await user.click(screen.getByRole("button", { name: /convert to deadline/i }));
      await waitFor(() =>
        expect(screen.queryByPlaceholderText("Deadline title")).not.toBeInTheDocument(),
      );
    }
    expect(mockedTask).toHaveBeenCalledTimes(2);
  });

  test("a server error keeps the typed values", async () => {
    const user = userEvent.setup();
    mockedTask.mockResolvedValue({
      status: "error",
      errors: { dueDate: ["Invalid due date"] },
    });
    render(<TaskHarness />);
    await openIt(user);
    const title = screen.getByPlaceholderText("Deadline title");
    await user.clear(title);
    await user.type(title, "Typed deadline");
    await user.click(screen.getByRole("button", { name: /convert to deadline/i }));
    expect(await screen.findByText("Invalid due date")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Deadline title")).toHaveValue("Typed deadline");
  });
});
