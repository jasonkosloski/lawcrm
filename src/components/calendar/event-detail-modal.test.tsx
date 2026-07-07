/**
 * Tests for EventDetailModal.
 *
 * Two regressions worth pinning:
 *
 * 1. Escape inside an inline editor used to bubble to the modal's
 *    window-level keydown handler and close the whole modal — a
 *    user cancelling a title edit lost the modal (and any other
 *    in-progress context). Each editor's Escape must cancel only
 *    the edit; a bare Escape (no editor open) must still close.
 *
 * 2. `committed` state used to re-seed only when `event.id`
 *    changed, so the refreshed prop after a save (same id, fresh
 *    server data) was ignored: picker-added attendees stayed
 *    kind:"new"/attendeeId:null forever and every whole-row commit
 *    re-sent them down the create-Contact path. A fresh `event`
 *    prop must re-seed committed state — except mid-save, where a
 *    stale refresh must not clobber the optimistic merge.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replaceMock, refreshMock, searchParams } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  // Stable instance — a fresh URLSearchParams each render would
  // churn the `close` callback (and its window listener) on every
  // render for no reason.
  searchParams: new URLSearchParams("event=e1"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
  usePathname: () => "/calendar",
  useSearchParams: () => searchParams,
}));

vi.mock("@/app/actions/calendar-events", () => ({
  updateCalendarEvent: vi.fn(async () => ({ status: "ok" as const })),
  deleteCalendarEventAndRedirect: vi.fn(),
}));

vi.mock("@/app/actions/attendee-search", () => ({
  searchAttendeesAction: vi.fn(async () => []),
}));

// The notes / time-entry sections pull their own server actions —
// out of scope here, so stub them to nothing.
vi.mock("./event-notes-section", () => ({
  EventNotesSection: () => null,
}));
vi.mock("./event-time-entries-section", () => ({
  EventTimeEntriesSection: () => null,
}));

import { updateCalendarEvent } from "@/app/actions/calendar-events";
import type { CalendarEventDetail } from "@/lib/queries/calendar";
import { EventDetailModal } from "./event-detail-modal";

const updateMock = vi.mocked(updateCalendarEvent);

function makeEvent(
  overrides: Partial<CalendarEventDetail> = {}
): CalendarEventDetail {
  return {
    id: "e1",
    title: "Deposition prep",
    type: "meeting",
    startTime: new Date("2026-07-06T09:00:00"),
    endTime: new Date("2026-07-06T10:00:00"),
    isAllDay: false,
    location: "Conference room",
    description: "Bring exhibits",
    zoomUrl: null,
    color: "#336699",
    matter: null,
    attendees: [],
    viewerCanSeeDetails: true,
    visibility: "default",
    ...overrides,
  };
}

/** An attendee row as the server returns it after a save — has a
 *  real row id + contact linkage (the shape a picker-added "new"
 *  entry acquires once the action created its Contact). */
const savedContactAttendee = {
  id: "att1",
  name: "Bob Witness",
  email: "bob@example.com",
  status: "pending",
  userId: null,
  userInitials: null,
  userJobTitle: null,
  contactId: "c1",
  contactType: "witness",
  contactOrganization: null,
};

function renderModal(event = makeEvent()) {
  return render(
    <EventDetailModal event={event} notes={[]} timeEntries={[]} canEdit />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMock.mockResolvedValue({ status: "ok" });
});

describe("Escape handling — inline editors cancel without closing the modal", () => {
  test("bare Escape (no editor open) closes the modal", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.keyboard("{Escape}");
    expect(replaceMock).toHaveBeenCalledWith("/calendar", { scroll: false });
  });

  test("Escape in the title editor cancels the edit, keeps the modal", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("Deposition prep"));
    const input = screen.getByRole("textbox", { name: "Event title" });
    await user.clear(input);
    await user.type(input, "abandoned edit");
    await user.keyboard("{Escape}");

    // Edit cancelled: input gone, original value back, no commit.
    expect(
      screen.queryByRole("textbox", { name: "Event title" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Deposition prep")).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
    // Modal still open.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("Escape in the description textarea keeps the modal", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("Bring exhibits"));
    screen.getByRole("textbox", { name: "Description" });
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("textbox", { name: "Description" })
    ).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("Escape in the type select keeps the modal", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: "Edit Event type" }));
    screen.getByRole("combobox", { name: "Event type" });
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("combobox", { name: "Event type" })
    ).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("Escape closes the attendee dropdown first, then the modal", async () => {
    const user = userEvent.setup();
    renderModal();

    // Typing a non-matching name opens the dropdown (the
    // "Add as new contact" row shows even with zero results).
    await user.type(
      screen.getByRole("textbox", { name: "Search attendees" }),
      "Bob"
    );
    await screen.findByRole("listbox", { name: "Attendee suggestions" });

    // First Escape: dropdown dismissed, modal stays.
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("listbox", { name: "Attendee suggestions" })
    ).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();

    // Second Escape (dropdown already closed): modal closes.
    await user.keyboard("{Escape}");
    expect(replaceMock).toHaveBeenCalledWith("/calendar", { scroll: false });
  });
});

describe("committed state re-seeds from a refreshed event prop", () => {
  test("post-save refresh (same id) re-seeds; next commit sends server truth", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal(makeEvent());

    // Commit a title edit — save resolves, refresh is requested.
    await user.click(screen.getByText("Deposition prep"));
    const input = screen.getByRole("textbox", { name: "Event title" });
    await user.clear(input);
    await user.type(input, "Prep session{Enter}");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());

    // The refresh delivers the committed row back: same event id,
    // and the attendee the server persisted now carries its row
    // id + contact linkage.
    rerender(
      <EventDetailModal
        event={makeEvent({
          title: "Prep session",
          attendees: [savedContactAttendee],
        })}
        notes={[]}
        timeEntries={[]}
        canEdit
      />
    );

    // Re-seeded state is visible immediately…
    expect(await screen.findByText("1 attendee")).toBeInTheDocument();

    // …and the next whole-row commit serializes the attendee as
    // the server knows it (kind:"contact" + contactId), not a
    // stale kind:"new" that would re-run contact creation.
    await user.click(
      screen.getByRole("checkbox", {
        name: /show details to everyone/i,
      })
    );
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
    const fd = updateMock.mock.calls[1]![2];
    expect(JSON.parse(fd.get("attendees") as string)).toEqual([
      {
        kind: "contact",
        userId: "",
        contactId: "c1",
        name: "Bob Witness",
        email: "bob@example.com",
      },
    ]);
  });

  test("a stale refresh mid-save does not clobber the optimistic merge", async () => {
    const user = userEvent.setup();
    let resolveSave!: (v: { status: "ok" }) => void;
    updateMock.mockImplementationOnce(
      () => new Promise((r) => (resolveSave = r))
    );
    const { rerender } = renderModal(makeEvent());

    await user.click(screen.getByText("Deposition prep"));
    const input = screen.getByRole("textbox", { name: "Event title" });
    await user.clear(input);
    await user.type(input, "Optimistic title{Enter}");
    expect(
      screen.getByRole("heading", { name: "Optimistic title" })
    ).toBeInTheDocument();

    // A refresh with pre-save data lands while the save is still
    // in flight — the optimistic title must survive.
    rerender(
      <EventDetailModal
        event={makeEvent()}
        notes={[]}
        timeEntries={[]}
        canEdit
      />
    );
    expect(
      screen.getByRole("heading", { name: "Optimistic title" })
    ).toBeInTheDocument();

    // The save settles and its refresh delivers the saved row —
    // committed re-seeds to server truth.
    rerender(
      <EventDetailModal
        event={makeEvent({ title: "Optimistic title" })}
        notes={[]}
        timeEntries={[]}
        canEdit
      />
    );
    resolveSave({ status: "ok" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(
      screen.getByRole("heading", { name: "Optimistic title" })
    ).toBeInTheDocument();
  });
});
