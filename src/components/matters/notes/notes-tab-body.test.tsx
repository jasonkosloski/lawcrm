/**
 * NotesTabBody — client-side search over entity-encoded note HTML.
 * (Thread building / rollups are unit-tested in src/lib/note-threads.test.ts.)
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/notes", () => ({
  markMatterNotesRead: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./note-card", () => ({
  NoteCard: ({ note }: { note: { id: string } }) => <div data-testid="card">{note.id}</div>,
}));

import { NO_NOTE_ACCESS } from "@/lib/note-constants";
import { NotesTabBody } from "./notes-tab-body";
import type { NoteCardNote } from "./note-card";

const note = (id: string, content: string): NoteCardNote => ({
  id,
  type: "note",
  content,
  isPinned: false,
  authorId: "u",
  authorName: "Ann Author",
  authorInitials: "AA",
  createdAt: new Date("2026-04-15T12:00:00Z"),
  parentNoteId: null,
  link: null,
  isRead: true,
  reactions: [],
  attachedTasks: [],
  attachedDeadlines: [],
  attachedTimeEntries: [],
});

beforeEach(() => vi.clearAllMocks());

describe("NotesTabBody search", () => {
  test("finds 'Smith & Jones' in a note stored as 'Smith &amp; Jones'", async () => {
    const user = userEvent.setup();
    render(
      <NotesTabBody
        scope={{ kind: "matter", matterId: "m1" }}
        access={NO_NOTE_ACCESS}
        notes={[note("a", "<p>Call Smith &amp; Jones tomorrow</p>"), note("b", "<p>Unrelated</p>")]}
      />,
    );
    await user.type(screen.getByPlaceholderText("Search notes…"), "Smith & Jones");
    const cards = screen.getAllByTestId("card");
    expect(cards.map((c) => c.textContent)).toEqual(["a"]);
  });

  test("matches '<' and '>' typed by the user", async () => {
    const user = userEvent.setup();
    render(
      <NotesTabBody
        scope={{ kind: "matter", matterId: "m1" }}
        access={NO_NOTE_ACCESS}
        notes={[note("a", "<p>if x &lt; 5 then stop</p>")]}
      />,
    );
    await user.type(screen.getByPlaceholderText("Search notes…"), "x < 5");
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });

  test("type filter pills expose their pressed state", async () => {
    const user = userEvent.setup();
    render(
      <NotesTabBody
        scope={{ kind: "matter", matterId: "m1" }}
        access={NO_NOTE_ACCESS}
        notes={[note("a", "<p>x</p>")]}
      />,
    );
    const pill = screen.getByRole("button", { name: /^Note\s*1$/ });
    expect(pill).toHaveAttribute("aria-pressed", "false");
    await user.click(pill);
    expect(pill).toHaveAttribute("aria-pressed", "true");
  });
});
