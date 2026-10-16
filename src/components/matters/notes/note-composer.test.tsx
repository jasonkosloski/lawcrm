/**
 * NoteComposer — the Pin toggle is only offered to notes.pin holders
 * (createNote rejects a pinned note from anyone else), and it fails
 * closed when the caller doesn't say.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/notes", () => ({
  createNote: vi.fn(async () => ({ status: "ok" as const })),
}));
// Tiptap isn't needed to exercise the toolbar.
vi.mock("./note-editor", () => ({ NoteEditor: () => <div data-testid="editor" /> }));
vi.mock("@/components/matters/captures/capture-stack", () => ({
  CaptureStack: () => <div data-testid="stack" />,
}));

import { NoteComposer } from "./note-composer";

async function expand() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /write a note/i }));
}

describe("NoteComposer pin toggle", () => {
  test("hidden by default (fails closed)", async () => {
    render(<NoteComposer matterId="m1" />);
    await expand();
    expect(screen.queryByRole("button", { name: /^pin$/i })).toBeNull();
  });

  test("hidden when the viewer lacks notes.pin", async () => {
    render(<NoteComposer matterId="m1" canPin={false} />);
    await expand();
    expect(screen.queryByRole("button", { name: /^pin$/i })).toBeNull();
  });

  test("shown for notes.pin holders", async () => {
    render(<NoteComposer matterId="m1" canPin />);
    await expand();
    expect(screen.getByRole("button", { name: /^pin$/i })).toBeTruthy();
  });
});
