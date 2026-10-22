/**
 * The notes / time-entry sections and composers shared by the event
 * modal and the matter Events tab.
 *
 * Pins: instants render in the viewer's PROFILE zone and date-only
 * entry dates in UTC (both fail on the old browser-zone formatting in
 * one of the two suite zones); quarter hours aren't rounded; pin /
 * delete buttons the server would refuse (a redirect to "/") are
 * hidden; the composers reset on Cancel and on success, and the time
 * composer defaults to the event's date.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EventNote, EventTimeEntry } from "@/lib/queries/calendar";
import { parseDateOnly } from "@/lib/format-date";

const { createNote, createTimeEntry } = vi.hoisted(() => ({
  createNote: vi.fn(),
  createTimeEntry: vi.fn(),
}));

vi.mock("@/app/actions/notes", () => ({
  createNote,
  deleteNote: vi.fn(async () => ({ ok: true })),
  toggleNotePin: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/time-entries", () => ({
  createTimeEntry,
  deleteTimeEntry: vi.fn(async () => ({ ok: true })),
}));
// Tiptap is heavy and irrelevant here: a button that "types" a note.
vi.mock("@/components/matters/notes/note-editor", () => ({
  NoteEditor: ({ onChange }: { onChange: (html: string) => void }) => (
    <button type="button" onClick={() => onChange("<p>Court note</p>")}>
      type-note
    </button>
  ),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { EventAttachmentsProvider } from "./event-attachments-context";
import { EventNotesSection } from "./event-notes-section";
import { EventTimeEntriesSection } from "./event-time-entries-section";
import { EventNoteComposer } from "./event-note-composer";
import { EventTimeEntryComposer } from "./event-time-entry-composer";

const note = (over: Partial<EventNote> = {}): EventNote => ({
  id: "n1",
  type: "note",
  content: "<p>Hello</p>",
  isPinned: false,
  authorId: "u_author",
  authorName: "Ann Author",
  authorInitials: "AA",
  createdAt: new Date("2026-07-07T03:30:00.000Z"),
  matterId: "m1",
  ...over,
});

const entry = (over: Partial<EventTimeEntry> = {}): EventTimeEntry => ({
  id: "t1",
  date: parseDateOnly("2026-10-16")!,
  hours: 0.25,
  activity: "Hearing attendance",
  narrative: null,
  billable: true,
  noCharge: false,
  privileged: false,
  status: "draft",
  userId: "u_author",
  userName: "Ann Author",
  userInitials: "AA",
  matterId: "m1",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  createNote.mockReset();
  createTimeEntry.mockReset();
});

describe("EventNotesSection", () => {
  test("shows the note timestamp in the viewer's profile zone", () => {
    // 2026-07-07T03:30Z: Jul 6, 9:30 PM in Denver; Jul 7, 12:30 PM in
    // Tokyo. Neither matches the browser zone of both suite runs.
    const { unmount } = render(
      <UserTimeZoneProvider timeZone="America/Denver">
        <EventNotesSection eventId="e1" matterId="m1" matterName="Smith" notes={[note()]} />
      </UserTimeZoneProvider>,
    );
    expect(screen.getByText("Jul 6, 9:30 PM")).toBeTruthy();
    unmount();

    render(
      <UserTimeZoneProvider timeZone="Asia/Tokyo">
        <EventNotesSection eventId="e1" matterId="m1" matterName="Smith" notes={[note()]} />
      </UserTimeZoneProvider>,
    );
    expect(screen.getByText("Jul 7, 12:30 PM")).toBeTruthy();
  });

  test("without a provider every control shows (server stays the authority)", () => {
    render(<EventNotesSection eventId="e1" matterId="m1" matterName="Smith" notes={[note()]} />);
    expect(screen.getByLabelText("Pin note")).toBeTruthy();
    expect(screen.getByLabelText("Delete note")).toBeTruthy();
  });

  test("hides Pin without notes.pin", () => {
    render(
      <EventAttachmentsProvider viewerId="u_me" canPinNotes={false}>
        <EventNotesSection eventId="e1" matterId="m1" matterName="Smith" notes={[note()]} />
      </EventAttachmentsProvider>,
    );
    expect(screen.queryByLabelText("Pin note")).toBeNull();
  });

  test("hides Delete on a colleague's note without notes.delete_any", () => {
    render(
      <EventAttachmentsProvider viewerId="u_me" canDeleteAnyNote={false}>
        <EventNotesSection
          eventId="e1"
          matterId="m1"
          matterName="Smith"
          notes={[note({ authorId: "u_other" })]}
        />
      </EventAttachmentsProvider>,
    );
    expect(screen.queryByLabelText("Delete note")).toBeNull();
  });

  test("keeps Delete on the viewer's own note even without notes.delete_any", () => {
    render(
      <EventAttachmentsProvider viewerId="u_me" canDeleteAnyNote={false}>
        <EventNotesSection
          eventId="e1"
          matterId="m1"
          matterName="Smith"
          notes={[note({ authorId: "u_me" })]}
        />
      </EventAttachmentsProvider>,
    );
    expect(screen.getByLabelText("Delete note")).toBeTruthy();
  });

  test("keeps Delete on any note for a notes.delete_any holder", () => {
    render(
      <EventAttachmentsProvider viewerId="u_me" canDeleteAnyNote>
        <EventNotesSection
          eventId="e1"
          matterId="m1"
          matterName="Smith"
          notes={[note({ authorId: "u_other" })]}
        />
      </EventAttachmentsProvider>,
    );
    expect(screen.getByLabelText("Delete note")).toBeTruthy();
  });
});

describe("EventTimeEntriesSection", () => {
  test("a date-only entry shows the day it was saved on, not the day before", () => {
    // Stored 2026-10-16T00:00Z. A browser-zone format in Denver says
    // Oct 15 (and the SSR text, rendered in UTC, said Oct 16).
    render(<EventTimeEntriesSection eventId="e1" matterId="m1" entries={[entry()]} />);
    expect(screen.getByText("Oct 16")).toBeTruthy();
    expect(screen.queryByText("Oct 15")).toBeNull();
  });

  test("quarter hours and totals aren't rounded to a tenth", () => {
    render(
      <EventTimeEntriesSection
        eventId="e1"
        matterId="m1"
        entries={[
          entry({ id: "a", hours: 0.25 }),
          entry({ id: "b", hours: 0.75, billable: false }),
        ]}
      />,
    );
    expect(screen.getByText("0.25h")).toBeTruthy();
    expect(screen.getByText("0.75h")).toBeTruthy();
    expect(screen.getByText(/1\.0h total/)).toBeTruthy();
    expect(screen.getByText(/0\.25h billable/)).toBeTruthy();
  });

  test("hides Delete on a colleague's entry without time_entries.delete_any", () => {
    render(
      <EventAttachmentsProvider viewerId="u_me" canDeleteAnyTimeEntry={false}>
        <EventTimeEntriesSection
          eventId="e1"
          matterId="m1"
          entries={[
            entry({ id: "theirs", userId: "u_other" }),
            entry({ id: "mine", userId: "u_me", activity: "My work" }),
          ]}
        />
      </EventAttachmentsProvider>,
    );
    // Only the viewer's own entry keeps a Delete button.
    expect(screen.getAllByLabelText("Delete time entry")).toHaveLength(1);
  });
});

describe("EventNoteComposer", () => {
  test("Cancel discards the type and pin selection, not just the text", async () => {
    const user = userEvent.setup();
    render(<EventNoteComposer matterId="m1" eventId="e1" />);

    await user.click(screen.getByText("Add a note about this event…"));
    await user.click(screen.getByRole("button", { name: "Strategy" }));
    await user.click(screen.getByRole("button", { name: /Pin/ }));
    expect(screen.getByRole("button", { name: /Pin/ }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByText("Add a note about this event…"));

    // Back to a plain, unpinned "Note".
    expect(screen.getByRole("button", { name: /Pin/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Note" }).className).toContain("bg-white");
    expect(screen.getByRole("button", { name: "Strategy" }).className).not.toContain("bg-white");
  });

  test("a saved note collapses the composer and resets it", async () => {
    createNote.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(<EventNoteComposer matterId="m1" eventId="e1" />);

    await user.click(screen.getByText("Add a note about this event…"));
    await user.click(screen.getByRole("button", { name: "Strategy" }));
    await user.click(screen.getByText("type-note"));
    await act(async () => {
      fireEvent.submit(screen.getByText("Save note").closest("form")!);
    });

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Add a note about this event…")).toBeTruthy();

    // Reopened: the previous draft's type is gone.
    await user.click(screen.getByText("Add a note about this event…"));
    expect(screen.getByRole("button", { name: "Note" }).className).toContain("bg-white");
  });
});

describe("EventTimeEntryComposer", () => {
  const dateInput = () => screen.getByLabelText("Date") as HTMLInputElement;

  test("defaults to the event's date, not today", async () => {
    const user = userEvent.setup();
    render(
      <EventAttachmentsProvider defaultTimeEntryDate="2026-10-06">
        <EventTimeEntryComposer matterId="m1" eventId="e1" />
      </EventAttachmentsProvider>,
    );
    await user.click(screen.getByText("Log time for this event…"));
    expect(dateInput().value).toBe("2026-10-06");
  });

  test("with no event date it falls back to today in the viewer's zone", async () => {
    // 2026-04-28T02:00Z is Apr 27, 8 PM in Denver: "today" is the
    // 27th there, but the 28th in a UTC runtime.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T02:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <UserTimeZoneProvider timeZone="America/Denver">
        <EventTimeEntryComposer matterId="m1" eventId="e1" />
      </UserTimeZoneProvider>,
    );
    await user.click(screen.getByText("Log time for this event…"));
    expect(dateInput().value).toBe("2026-04-27");
  });

  test("reopening re-seeds the date instead of keeping the last edit", async () => {
    const user = userEvent.setup();
    render(
      <EventAttachmentsProvider defaultTimeEntryDate="2026-10-06">
        <EventTimeEntryComposer matterId="m1" eventId="e1" />
      </EventAttachmentsProvider>,
    );
    await user.click(screen.getByText("Log time for this event…"));
    fireEvent.change(dateInput(), { target: { value: "2026-01-01" } });
    expect(dateInput().value).toBe("2026-01-01");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByText("Log time for this event…"));
    expect(dateInput().value).toBe("2026-10-06");
  });

  test("a logged entry collapses the composer", async () => {
    createTimeEntry.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    const { container } = render(<EventTimeEntryComposer matterId="m1" eventId="e1" />);
    await user.click(screen.getByText("Log time for this event…"));
    await user.type(screen.getByPlaceholderText("Hrs"), "1.5");
    await user.type(screen.getByPlaceholderText(/Activity/), "Hearing attendance");
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });

    expect(createTimeEntry).toHaveBeenCalledTimes(1);
    expect(await within(container).findByText("Log time for this event…")).toBeTruthy();
  });
});
