/**
 * ReplyComposer - threads under its parent, offers only the capture
 * kinds the viewer may create, keeps the draft on a failed save and
 * hands control back (onDone) on success.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NO_NOTE_ACCESS, type NoteFormState } from "@/lib/note-constants";

const createNote =
  vi.fn<(matterId: string, prev: NoteFormState, fd: FormData) => Promise<NoteFormState>>();
const createLeadNote =
  vi.fn<(leadId: string, prev: NoteFormState, fd: FormData) => Promise<NoteFormState>>();
vi.mock("@/app/actions/notes", () => ({
  createNote: (matterId: string, prev: NoteFormState, fd: FormData) =>
    createNote(matterId, prev, fd),
  createLeadNote: (leadId: string, prev: NoteFormState, fd: FormData) =>
    createLeadNote(leadId, prev, fd),
}));
vi.mock("./note-editor", () => ({
  NoteEditor: ({ onChange }: { onChange: (html: string) => void }) => (
    <textarea data-testid="editor" onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/matters/captures/capture-stack", () => ({
  CaptureStack: ({ allowedKinds }: { allowedKinds?: string[] }) => (
    <div data-testid="stack" data-kinds={allowedKinds?.join(",")} />
  ),
}));

import { ReplyComposer } from "./reply-composer";

const access = {
  ...NO_NOTE_ACCESS,
  userId: "me",
  canCreateNote: true,
  canCreateTask: true,
  canCreateTime: true,
};

beforeEach(() => {
  createNote.mockReset();
  createNote.mockResolvedValue({ status: "ok" });
  createLeadNote.mockReset();
  createLeadNote.mockResolvedValue({ status: "ok" });
});

describe("ReplyComposer", () => {
  test("offers only the actionable kinds the viewer may create", () => {
    render(
      <ReplyComposer
        scope={{ kind: "matter", matterId: "m1" }}
        parentNoteId="p1"
        access={access}
        onDone={vi.fn()}
      />,
    );
    // No deadline (not permitted) and never event / sibling note.
    expect(screen.getByTestId("stack").dataset.kinds).toBe("task,time");
  });

  test("posts the reply under its parent and calls onDone", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <ReplyComposer
        scope={{ kind: "matter", matterId: "m7" }}
        parentNoteId="p1"
        access={access}
        onDone={onDone}
      />,
    );
    await user.type(screen.getByTestId("editor"), "agreed");
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const [matterId, , fd] = createNote.mock.calls[0];
    expect(matterId).toBe("m7");
    expect(fd.get("parentNoteId")).toBe("p1");
    expect(fd.get("content")).toBe("agreed");
  });

  test("a failed reply stays open with the draft and the error", async () => {
    createNote.mockResolvedValue({
      status: "error",
      errors: { content: ["Parent note not found on this matter"] },
    });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <ReplyComposer
        scope={{ kind: "matter", matterId: "m1" }}
        parentNoteId="p1"
        access={access}
        onDone={onDone}
      />,
    );
    await user.type(screen.getByTestId("editor"), "my reply");
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    expect(await screen.findByText("Parent note not found on this matter")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect((screen.getByTestId("editor") as HTMLTextAreaElement).value).toBe("my reply");
  });

  test("on an intake note: posts through createLeadNote and offers no captures", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <ReplyComposer
        scope={{ kind: "lead", leadId: "l3" }}
        parentNoteId="p1"
        access={access}
        onDone={onDone}
      />,
    );
    expect(screen.getByTestId("stack").dataset.kinds).toBe("");
    await user.type(screen.getByTestId("editor"), "called back");
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(createNote).not.toHaveBeenCalled();
    const [leadId, , fd] = createLeadNote.mock.calls[0];
    expect(leadId).toBe("l3");
    expect(fd.get("parentNoteId")).toBe("p1");
  });
});
