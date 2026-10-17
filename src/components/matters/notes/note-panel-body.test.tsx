/**
 * NotePanelBody (Create dock).
 *
 *  - Clear resets type, pin and queued captures as well as the text
 *    (it used to leave type and pin behind for the next note).
 *  - A failed save keeps the typed note; success closes the panel.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { NoteFormState } from "@/lib/note-constants";

const createNote = vi.fn<
  (matterId: string, prev: NoteFormState, fd: FormData) => Promise<NoteFormState>
>();
vi.mock("@/app/actions/notes", () => ({
  createNote: (matterId: string, prev: NoteFormState, fd: FormData) =>
    createNote(matterId, prev, fd),
}));
vi.mock("./note-editor", () => ({
  NoteEditor: ({ onChange }: { onChange: (html: string) => void }) => (
    <textarea
      data-testid="editor"
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("@/components/matters/captures/capture-stack", () => ({
  CaptureStack: () => <div data-testid="stack" />,
}));
const close = vi.fn();
vi.mock("@/components/create-stack/create-stack-provider", () => ({
  useCreateStack: () => ({ close }),
}));

import { NotePanelBody } from "./note-panel-body";

beforeEach(() => {
  createNote.mockReset();
  createNote.mockResolvedValue({ status: "ok" });
  close.mockReset();
});

describe("NotePanelBody", () => {
  test("Clear resets the text, the type and the pin", async () => {
    const user = userEvent.setup();
    render(<NotePanelBody panelId="p1" matterId="m1" />);
    await user.type(screen.getByTestId("editor"), "draft");
    await user.click(screen.getByRole("button", { name: "Strategy" }));
    await user.click(screen.getByRole("button", { name: /^pin$/i }));
    expect(screen.getByRole("button", { name: /^pin$/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await user.click(screen.getByRole("button", { name: /^clear$/i }));

    expect((screen.getByTestId("editor") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Note" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /^pin$/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  test("the Pin toggle can be withheld", () => {
    render(<NotePanelBody panelId="p1" matterId="m1" canPin={false} />);
    expect(screen.queryByRole("button", { name: /^pin$/i })).toBeNull();
  });

  test("closes the panel after a successful save", async () => {
    const user = userEvent.setup();
    render(<NotePanelBody panelId="p1" matterId="m1" />);
    await user.type(screen.getByTestId("editor"), "hello");
    await user.click(screen.getByRole("button", { name: /save note/i }));
    await waitFor(() => expect(close).toHaveBeenCalledWith("p1"));
  });

  test("a failed save keeps the panel open with the text and shows the error", async () => {
    createNote.mockResolvedValue({
      status: "error",
      errors: { content: ["You don't have permission to pin notes."] },
    });
    const user = userEvent.setup();
    render(<NotePanelBody panelId="p1" matterId="m1" />);
    await user.type(screen.getByTestId("editor"), "keep me");
    await user.click(screen.getByRole("button", { name: /save note/i }));
    expect(
      await screen.findByText("You don't have permission to pin notes.")
    ).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByTestId("editor") as HTMLTextAreaElement).value).toBe(
      "keep me"
    );
  });
});
