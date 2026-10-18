/**
 * NoteComposer.
 *
 *  - The Pin toggle is only offered to notes.pin holders (createNote
 *    rejects a pinned note from anyone else) and fails closed when the
 *    caller doesn't say.
 *  - Cancel resets EVERYTHING the user set - type, pin and queued
 *    captures - so none of it leaks into the next note. (It used to
 *    clear only the text: the next note came out pinned, typed
 *    "Strategy" and carrying a stale deadline.)
 *  - A failed save keeps what was typed and shows the error; a good
 *    save resets and collapses.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { NoteCapture, NoteFormState } from "@/lib/note-constants";

const createNote = vi.fn<
  (matterId: string, prev: NoteFormState, fd: FormData) => Promise<NoteFormState>
>();
vi.mock("@/app/actions/notes", () => ({
  createNote: (matterId: string, prev: NoteFormState, fd: FormData) =>
    createNote(matterId, prev, fd),
}));
// Tiptap isn't needed: a textarea stands in and reports its HTML.
vi.mock("./note-editor", () => ({
  NoteEditor: ({ onChange }: { onChange: (html: string) => void }) => (
    <textarea
      data-testid="editor"
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
// A stack that can queue one capture and shows its count.
vi.mock("@/components/matters/captures/capture-stack", () => ({
  CaptureStack: ({
    captures,
    onChange,
    allowedKinds,
  }: {
    captures: NoteCapture[];
    onChange: (c: NoteCapture[]) => void;
    allowedKinds?: string[];
  }) => (
    <div data-testid="stack" data-kinds={allowedKinds?.join(",") ?? "default"}>
      <span data-testid="capture-count">{captures.length}</span>
      <button
        type="button"
        onClick={() =>
          onChange([
            ...captures,
            {
              kind: "deadline",
              tempId: "d1",
              title: "Answer",
              dueDate: "2026-08-01",
              kind_: "manual",
              description: "",
            },
          ])
        }
      >
        queue deadline
      </button>
    </div>
  ),
}));

import { NoteComposer } from "./note-composer";

beforeEach(() => {
  createNote.mockReset();
  createNote.mockResolvedValue({ status: "ok" });
});

async function expand() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /write a note/i }));
  return user;
}

describe("NoteComposer pin toggle", () => {
  test("hidden by default (fails closed)", async () => {
    render(<NoteComposer scope={{ kind: "matter", matterId: "m1" }} />);
    await expand();
    expect(screen.queryByRole("button", { name: /^pin$/i })).toBeNull();
  });

  test("hidden when the viewer lacks notes.pin", async () => {
    render(<NoteComposer scope={{ kind: "matter", matterId: "m1" }} canPin={false} />);
    await expand();
    expect(screen.queryByRole("button", { name: /^pin$/i })).toBeNull();
  });

  test("shown for notes.pin holders", async () => {
    render(<NoteComposer scope={{ kind: "matter", matterId: "m1" }} canPin />);
    await expand();
    expect(screen.getByRole("button", { name: /^pin$/i })).toBeTruthy();
  });
});

describe("NoteComposer capture kinds", () => {
  test("passes the viewer's allowed kinds to the stack", async () => {
    render(<NoteComposer scope={{ kind: "matter", matterId: "m1" }} allowedKinds={["task", "time"]} />);
    await expand();
    expect(screen.getByTestId("stack").dataset.kinds).toBe("task,time");
  });
});

describe("NoteComposer type pills", () => {
  test("expose the selected type with aria-pressed", async () => {
    render(<NoteComposer scope={{ kind: "matter", matterId: "m1" }} />);
    const user = await expand();
    expect(screen.getByRole("button", { name: "Note" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await user.click(screen.getByRole("button", { name: "Strategy" }));
    expect(screen.getByRole("button", { name: "Strategy" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Note" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});

describe("NoteComposer Cancel", () => {
  test("resets type, pin and queued captures - none leak into the next note", async () => {
    render(<NoteComposer scope={{ kind: "matter", matterId: "m1" }} canPin />);
    const user = await expand();

    await user.type(screen.getByTestId("editor"), "draft");
    await user.click(screen.getByRole("button", { name: "Strategy" }));
    await user.click(screen.getByRole("button", { name: /^pin$/i }));
    await user.click(screen.getByRole("button", { name: "queue deadline" }));
    expect(screen.getByTestId("capture-count").textContent).toBe("1");
    expect(screen.getByRole("button", { name: /save note \+ 1/i })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    // Re-open: pristine.
    await user.click(screen.getByRole("button", { name: /write a note/i }));
    expect(screen.getByTestId("capture-count").textContent).toBe("0");
    expect(screen.getByRole("button", { name: "Note" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /^pin$/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect((screen.getByTestId("editor") as HTMLTextAreaElement).value).toBe("");
  });
});

describe("NoteComposer submit", () => {
  test("posts content, type, pin and captures; resets and collapses on success", async () => {
    render(<NoteComposer scope={{ kind: "matter", matterId: "m9" }} canPin />);
    const user = await expand();
    await user.type(screen.getByTestId("editor"), "<p>Hello</p>");
    await user.click(screen.getByRole("button", { name: "Memo" }));
    await user.click(screen.getByRole("button", { name: /^pin$/i }));
    await user.click(screen.getByRole("button", { name: "queue deadline" }));
    await user.click(screen.getByRole("button", { name: /save note \+ 1/i }));

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    const [matterId, , fd] = createNote.mock.calls[0];
    expect(matterId).toBe("m9");
    expect(fd.get("content")).toBe("<p>Hello</p>");
    expect(fd.get("type")).toBe("memo");
    expect(fd.get("isPinned")).toBe("on");
    expect(JSON.parse(String(fd.get("attachments")))).toHaveLength(1);

    // Collapsed back to the placeholder, ready for the next note.
    expect(
      await screen.findByRole("button", { name: /write a note/i })
    ).toBeTruthy();
  });

  test("a failed save keeps the typed note and shows the error", async () => {
    createNote.mockResolvedValue({
      status: "error",
      errors: { content: ["You don't have permission to log time."] },
    });
    render(<NoteComposer scope={{ kind: "matter", matterId: "m1" }} />);
    const user = await expand();
    await user.type(screen.getByTestId("editor"), "important memo");
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(
      await screen.findByText("You don't have permission to log time.")
    ).toBeInTheDocument();
    // Still expanded with the text intact.
    expect((screen.getByTestId("editor") as HTMLTextAreaElement).value).toBe(
      "important memo"
    );
  });

  test("a previous attempt's error is gone after cancelling and reopening", async () => {
    createNote.mockResolvedValue({
      status: "error",
      errors: { content: ["Nope"] },
    });
    render(<NoteComposer scope={{ kind: "matter", matterId: "m1" }} />);
    const user = await expand();
    await user.type(screen.getByTestId("editor"), "x");
    await user.click(screen.getByRole("button", { name: /save note/i }));
    await screen.findByText("Nope");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await user.click(screen.getByRole("button", { name: /write a note/i }));
    expect(screen.queryByText("Nope")).toBeNull();
  });
});
