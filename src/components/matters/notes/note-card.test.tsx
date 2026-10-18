/**
 * NoteCard — viewer-gated controls, creation-time stamp, plain-text
 * prefill for Convert-to-task.
 *
 * Pinned regressions:
 *  - the card showed `updatedAt`, which pinning bumps, so pinning a
 *    2024 memo relabelled it with today's date;
 *  - Pin / Delete / Reply / Convert were offered to everyone and
 *    bounced users without the permission to the dashboard, losing
 *    what they had typed;
 *  - Convert-to-task prefilled "Smith &amp; Jones" (entity-encoded).
 * Timestamps render in the viewer's PROFILE zone (UserTimeZoneProvider).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
vi.mock("@/app/actions/notes", () => ({
  deleteNote: vi.fn(async () => ({ ok: true })),
  toggleNotePin: vi.fn(async () => ({ ok: true })),
  toggleNoteReaction: vi.fn(async () => ({ ok: true })),
  createNote: vi.fn(),
  updateNote: vi.fn(async () => ({ status: "ok" })),
}));
// Children with their own suites / heavy deps.
vi.mock("./note-attachments-section", () => ({
  NoteAttachmentsSection: () => <div data-testid="attachments" />,
}));
vi.mock("./reply-composer", () => ({
  ReplyComposer: () => <div data-testid="reply-composer" />,
}));
vi.mock("./reactions-bar", () => ({ ReactionsBar: () => null }));
vi.mock("@/components/conversions/convert-dialogs", () => ({
  ConvertNoteToTaskDialog: ({
    defaultTitle,
    defaultDescription,
  }: {
    defaultTitle: string;
    defaultDescription: string;
  }) => (
    <div
      data-testid="convert"
      data-title={defaultTitle}
      data-description={defaultDescription}
    />
  ),
}));

import { deleteNote, toggleNotePin, updateNote } from "@/app/actions/notes";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { NO_NOTE_ACCESS, type NoteAccess } from "@/lib/note-constants";
import type { NoteScope } from "@/lib/note-scope";
import { NoteCard, type NoteCardNote } from "./note-card";

const FULL: NoteAccess = {
  userId: "me",
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

const note = (over: Partial<NoteCardNote> = {}): NoteCardNote => ({
  id: "n1",
  type: "note",
  content: "<p>Body</p>",
  isPinned: false,
  authorId: "me",
  authorName: "Ann Author",
  authorInitials: "AA",
  createdAt: new Date("2024-03-05T17:42:00Z"),
  parentNoteId: null,
  link: null,
  isRead: true,
  reactions: [],
  attachedTasks: [],
  attachedDeadlines: [],
  attachedTimeEntries: [],
  ...over,
});

function renderCard(
  n: NoteCardNote,
  access: NoteAccess,
  scope: NoteScope = { kind: "matter", matterId: "m1" }
) {
  return render(
    <UserTimeZoneProvider timeZone="America/Denver">
      <NoteCard note={n} scope={scope} access={access} />
    </UserTimeZoneProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("alert", vi.fn());
});

describe("NoteCard timestamp", () => {
  test("shows when the note was CREATED, in the viewer's profile zone", () => {
    // 17:42Z on Mar 5 2024 = 10:42 AM MST. The card must not show an
    // updatedAt-derived time (pinning bumps updatedAt).
    renderCard(note(), FULL);
    expect(screen.getByText("Mar 5, 2024, 10:42 AM")).toBeInTheDocument();
  });
});

describe("NoteCard gating", () => {
  test("a viewer with no permissions sees no pin, reply, or actions menu on someone else's note", () => {
    renderCard(note({ authorId: "someone-else" }), {
      ...NO_NOTE_ACCESS,
      userId: "me",
    });
    expect(screen.queryByRole("button", { name: /pin note/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reply$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /note actions/i })).toBeNull();
  });

  test("a pinned note still reads as pinned for a viewer who cannot toggle it", () => {
    renderCard(note({ isPinned: true, authorId: "x" }), {
      ...NO_NOTE_ACCESS,
      userId: "me",
    });
    expect(screen.getByRole("img", { name: "Pinned" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unpin note/i })).toBeNull();
  });

  test("notes.pin holders get the toggle, and it calls the action", async () => {
    const user = userEvent.setup();
    renderCard(note(), FULL);
    await user.click(screen.getByRole("button", { name: /pin note/i }));
    expect(toggleNotePin).toHaveBeenCalledWith("n1");
  });

  test("the author can delete their own note without notes.delete_any", async () => {
    const user = userEvent.setup();
    renderCard(note({ authorId: "me" }), {
      ...NO_NOTE_ACCESS,
      userId: "me",
    });
    await user.click(screen.getByRole("button", { name: /note actions/i }));
    await user.click(await screen.findByText("Delete note"));
    expect(deleteNote).toHaveBeenCalledWith("n1");
  });

  test("someone else's note is deletable only with notes.delete_any", async () => {
    const user = userEvent.setup();
    // Can create tasks (so the menu exists) but not delete others' notes.
    renderCard(note({ authorId: "other" }), {
      ...NO_NOTE_ACCESS,
      userId: "me",
      canCreateTask: true,
    });
    await user.click(screen.getByRole("button", { name: /note actions/i }));
    expect(await screen.findByText("Convert to task")).toBeInTheDocument();
    expect(screen.queryByText("Delete note")).toBeNull();
  });

  test("Reply needs notes.create", () => {
    const { unmount } = renderCard(note(), FULL);
    expect(screen.getByRole("button", { name: /^reply$/i })).toBeInTheDocument();
    unmount();
    renderCard(note(), { ...FULL, canCreateNote: false });
    expect(screen.queryByRole("button", { name: /^reply$/i })).toBeNull();
  });
});

describe("NoteCard on an intake (lead) note", () => {
  test("hides the matter-only features: attachments and Convert to task", async () => {
    const user = userEvent.setup();
    renderCard(note(), FULL, { kind: "lead", leadId: "l1" });
    expect(screen.queryByTestId("attachments")).toBeNull();
    expect(screen.queryByTestId("convert")).toBeNull();
    await user.click(screen.getByRole("button", { name: /note actions/i }));
    expect(await screen.findByText("Edit note")).toBeInTheDocument();
    expect(screen.queryByText("Convert to task")).toBeNull();
    // Pin and reply still work on intake notes.
    expect(screen.getByRole("button", { name: /pin note/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reply$/i })).toBeInTheDocument();
  });

  test("a viewer whose only extra key is tasks.create gets no menu on someone else's lead note", () => {
    renderCard(
      note({ authorId: "other" }),
      { ...NO_NOTE_ACCESS, userId: "me", canCreateTask: true },
      { kind: "lead", leadId: "l1" }
    );
    expect(screen.queryByRole("button", { name: /note actions/i })).toBeNull();
  });
});

describe("Convert-to-task prefill", () => {
  test("entities are decoded: '&amp;' is '&', '&lt;' is '<'", () => {
    renderCard(
      note({
        content: "<p>Call Smith &amp; Jones re: &lt;redacted&gt; exhibit</p>",
      }),
      FULL
    );
    const convert = screen.getByTestId("convert");
    expect(convert.dataset.title).toBe(
      "Call Smith & Jones re: <redacted> exhibit"
    );
    expect(convert.dataset.description).toBe(
      "Call Smith & Jones re: <redacted> exhibit"
    );
  });
});

describe("NoteCard — Edit note", () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: /note actions/i }));

  test("the author can edit their own note without notes.edit_any", async () => {
    const user = userEvent.setup();
    renderCard(note({ authorId: "me" }), { ...NO_NOTE_ACCESS, userId: "me" });
    await openMenu(user);
    expect(await screen.findByText("Edit note")).toBeInTheDocument();
  });

  test("someone else's note: Edit only with notes.edit_any", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard(note({ authorId: "other" }), {
      ...NO_NOTE_ACCESS,
      userId: "me",
      canCreateTask: true, // keeps the kebab present
    });
    await openMenu(user);
    await screen.findByText("Convert to task");
    expect(screen.queryByText("Edit note")).toBeNull();
    unmount();

    renderCard(note({ authorId: "other" }), { ...NO_NOTE_ACCESS, userId: "me", canEditAnyNote: true });
    await openMenu(user);
    expect(await screen.findByText("Edit note")).toBeInTheDocument();
  });

  test("saving posts the note's content and chosen type to updateNote", async () => {
    const user = userEvent.setup();
    renderCard(note({ authorId: "me", type: "note", content: "<p>Body</p>" }), { ...NO_NOTE_ACCESS, userId: "me" });
    await openMenu(user);
    await user.click(await screen.findByText("Edit note"));
    await user.click(await screen.findByRole("button", { name: "Strategy" }));
    await user.click(screen.getByRole("button", { name: /save note/i }));
    const [noteId, , fd] = vi.mocked(updateNote).mock.calls[0];
    expect(noteId).toBe("n1");
    expect((fd as FormData).get("type")).toBe("strategy");
    expect((fd as FormData).get("content")).toContain("Body");
  });
});
