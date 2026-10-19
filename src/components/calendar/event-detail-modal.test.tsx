/**
 * Tests for EventDetailModal.
 *
 * Regressions worth pinning:
 *
 * 1. Escape inside an inline editor used to bubble to the modal's
 *    window-level keydown handler and close the whole modal — a
 *    user cancelling a title edit lost the modal (and any other
 *    in-progress context). Each editor's Escape must cancel only
 *    the edit; a bare Escape (no editor open) must still close.
 *
 * 2. `committed` state used to re-seed only when `event.id`
 *    changed, so the refreshed prop after a save (same id, fresh
 *    server data) was ignored. A fresh `event` prop must re-seed
 *    committed state, except mid-save, where a stale refresh must
 *    not clobber the optimistic merge.
 *
 * 3. Schedule round trip (ADR-012). Every commit re-posts the whole
 *    row, so the wire strings built from the event's instants must
 *    be the wall clock in the USER's profile zone (timed) or the
 *    date-only key (all-day). They used the browser's local getters,
 *    so on a production host a title-only edit shifted the event by
 *    a UTC offset and slid all-day events a day per save. The tests
 *    use a profile zone (Pacific/Auckland) that differs from the
 *    runner's zone in both the Denver and TZ=UTC suite runs.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replaceMock, pushMock, refreshMock, searchParams } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  // Stable instance — a fresh URLSearchParams each render would
  // churn the `close` callback (and its listener) on every
  // render for no reason.
  searchParams: new URLSearchParams("event=e1"),
}));

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
    refresh: refreshMock,
  }),
  usePathname: () => "/calendar",
  useSearchParams: () => searchParams,
}));

vi.mock("@/app/actions/calendar-events", () => ({
  updateCalendarEvent: vi.fn(async () => ({ status: "ok" as const })),
  deleteCalendarEvent: vi.fn(async () => ({
    ok: true as const,
    matterId: null as string | null,
  })),
}));

vi.mock("@/app/actions/attendee-search", () => ({
  searchAttendeesAction: vi.fn(async () => []),
}));

// The notes / time-entry sections pull their own server actions —
// out of scope here. The notes stub renders a textarea so the
// composer-Escape guard can be exercised.
vi.mock("./event-notes-section", () => ({
  EventNotesSection: () => (
    <textarea aria-label="Draft note" defaultValue="half typed" />
  ),
}));
vi.mock("./event-time-entries-section", () => ({
  EventTimeEntriesSection: () => null,
}));

import {
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/app/actions/calendar-events";
import { confirmAction } from "@/lib/feedback";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { parseDateOnly } from "@/lib/format-date";
import type { CalendarEventDetail } from "@/lib/queries/calendar";
import { EventDetailModal } from "./event-detail-modal";

const updateMock = vi.mocked(updateCalendarEvent);
const deleteMock = vi.mocked(deleteCalendarEvent);

/** Differs from the runner's zone in both America/Denver and TZ=UTC
 *  runs, so old browser-local code can't pass in either. */
const TZ = "Pacific/Auckland";

function makeEvent(
  overrides: Partial<CalendarEventDetail> = {}
): CalendarEventDetail {
  return {
    id: "e1",
    title: "Deposition prep",
    type: "meeting",
    // 15:00Z = 03:00 next day in Auckland (NZST, UTC+12).
    startTime: new Date("2026-07-06T15:00:00.000Z"),
    endTime: new Date("2026-07-06T16:00:00.000Z"),
    isAllDay: false,
    location: "Conference room",
    description: "Bring exhibits",
    zoomUrl: null,
    color: "#336699",
    matter: null,
    lead: null,
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

type Props = Partial<React.ComponentProps<typeof EventDetailModal>>;

function ui(event: CalendarEventDetail, props: Props = {}) {
  return (
    <UserTimeZoneProvider timeZone={TZ}>
      <EventDetailModal
        event={event}
        notes={[]}
        timeEntries={[]}
        canEdit
        {...props}
      />
    </UserTimeZoneProvider>
  );
}

function renderModal(event = makeEvent(), props: Props = {}) {
  return render(ui(event, props));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  updateMock.mockReset();
  updateMock.mockResolvedValue({ status: "ok" });
  deleteMock.mockReset();
  deleteMock.mockResolvedValue({ ok: true, matterId: null });
});

async function editTitle(
  user: ReturnType<typeof userEvent.setup>,
  from: string,
  to: string
) {
  await user.click(screen.getByText(from));
  const input = screen.getByRole("textbox", { name: "Event title" });
  await user.clear(input);
  await user.type(input, `${to}{Enter}`);
}

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
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("Escape closes the attendee dropdown first, then the modal", async () => {
    const user = userEvent.setup();
    renderModal();

    // Typing a non-matching name opens the dropdown (the
    // "Add as new contact" row shows even with zero results).
    await user.type(
      screen.getByRole("combobox", { name: "Search attendees" }),
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

  test("Escape in the time editor cancels the edit only, dropping the draft", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: "Edit date and time" }));
    const starts = screen.getByLabelText("Starts");
    fireEvent.change(starts, { target: { value: "2026-07-08T10:00" } });
    starts.focus();
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("Starts")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();

    // Re-opening seeds from the committed schedule, not the draft.
    await user.click(screen.getByRole("button", { name: "Edit date and time" }));
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-07-07T03:00");
  });

  test("Escape in a note draft only blurs the field; the next Escape closes", async () => {
    const user = userEvent.setup();
    renderModal();

    const draft = screen.getByLabelText("Draft note");
    draft.focus();
    await user.keyboard("{Escape}");
    expect(replaceMock).not.toHaveBeenCalled();
    expect(draft).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(replaceMock).toHaveBeenCalledWith("/calendar", { scroll: false });
  });

  test("a handled Escape does not reach other window-level Escape handlers", async () => {
    const user = userEvent.setup();
    const dock = vi.fn();
    window.addEventListener("keydown", dock);
    try {
      renderModal();
      await user.keyboard("{Escape}");
      expect(replaceMock).toHaveBeenCalled();
      expect(dock).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", dock);
    }
  });

  test("an Escape aimed at a field outside the modal is left to that field", async () => {
    const user = userEvent.setup();
    renderModal();

    const outside = document.createElement("input");
    document.body.appendChild(outside);
    try {
      outside.focus();
      await user.keyboard("{Escape}");
      expect(replaceMock).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });
});

describe("committed state re-seeds from a refreshed event prop", () => {
  test("post-save refresh (same id) re-seeds; next commit sends server truth", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal(makeEvent());

    // Commit a title edit.
    await editTitle(user, "Deposition prep", "Prep session");
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));

    // The revalidation delivers the committed row back: same event
    // id, and the attendee the server persisted now carries its row
    // id + contact linkage.
    rerender(
      ui(
        makeEvent({
          title: "Prep session",
          attendees: [savedContactAttendee],
        })
      )
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

  test("a stale refresh mid-save does not clobber the optimistic merge, and the settled save re-seeds server truth", async () => {
    const user = userEvent.setup();
    let resolveSave!: (v: { status: "ok" }) => void;
    updateMock.mockImplementationOnce(
      () => new Promise((r) => (resolveSave = r))
    );
    const { rerender } = renderModal(makeEvent());

    await editTitle(user, "Deposition prep", "Optimistic title");
    expect(
      screen.getByRole("heading", { name: "Optimistic title" })
    ).toBeInTheDocument();

    // A refresh with pre-save data lands while the save is still
    // in flight — the optimistic title must survive.
    rerender(ui(makeEvent()));
    expect(
      screen.getByRole("heading", { name: "Optimistic title" })
    ).toBeInTheDocument();

    // The save settles; the row the server saved differs from the
    // optimistic text (it normalized the title). Committed state
    // must re-seed to that server truth.
    rerender(ui(makeEvent({ title: "Server title" })));
    resolveSave({ status: "ok" });
    expect(
      await screen.findByRole("heading", { name: "Server title" })
    ).toBeInTheDocument();
  });

  test("a failed save reverts the optimistic edit and shows the reason", async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValueOnce({
      status: "error",
      errors: { title: ["You don't have permission to edit this event."] },
    });
    renderModal(makeEvent());

    await editTitle(user, "Deposition prep", "Nope");

    expect(
      await screen.findByText("You don't have permission to edit this event.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Deposition prep" })
    ).toBeInTheDocument();
  });

  test("a save does not trigger a second router.refresh render", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await editTitle(user, "Deposition prep", "Prep session");
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("schedule round trip — ADR-012 wire format", () => {
  test("a title-only commit re-sends the timed schedule as the user-zone wall clock", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await editTitle(user, "Deposition prep", "Prep session");
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));

    const fd = updateMock.mock.calls[0]![2];
    // 15:00Z / 16:00Z in Pacific/Auckland. Not "…T15:00" (UTC
    // read) and not the runner's local reading.
    expect(fd.get("startTime")).toBe("2026-07-07T03:00");
    expect(fd.get("endTime")).toBe("2026-07-07T04:00");
    expect(fd.get("isAllDay")).toBeNull();
    expect(fd.get("title")).toBe("Prep session");
  });

  test("a title-only commit re-sends an all-day event as its own date-only key", async () => {
    const user = userEvent.setup();
    renderModal(
      makeEvent({
        isAllDay: true,
        startTime: parseDateOnly("2026-07-06")!,
        endTime: parseDateOnly("2026-07-08")!,
      })
    );

    await editTitle(user, "Deposition prep", "Trial");
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));

    const fd = updateMock.mock.calls[0]![2];
    // UTC midnight read in a west-of-UTC zone is the previous
    // day; the date-only value must come back unshifted.
    expect(fd.get("isAllDay")).toBe("on");
    expect(fd.get("startTime")).toBe("2026-07-06");
    expect(fd.get("endTime")).toBe("2026-07-08");
  });

  test("renders the schedule in the user's zone, all-day dates unshifted", () => {
    renderModal(makeEvent());
    // 03:00 Tuesday Jul 7 in Auckland.
    expect(
      screen.getByText("Tuesday, July 7, 2026")
    ).toBeInTheDocument();
    expect(screen.getByText(/3:00\s?AM\s?–\s?4:00\s?AM/)).toBeInTheDocument();
  });

  test("renders an all-day event on its own date with its span", () => {
    renderModal(
      makeEvent({
        isAllDay: true,
        startTime: parseDateOnly("2026-07-06")!,
        endTime: parseDateOnly("2026-07-08")!,
      })
    );
    expect(screen.getByText("Monday, July 6, 2026")).toBeInTheDocument();
    expect(
      screen.getByText("All day · through Jul 8, 2026")
    ).toBeInTheDocument();
  });

  test("saving the time editor posts the edited wall clock", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit date and time" }));
    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-07-08T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Ends"), {
      target: { value: "2026-07-08T11:30" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const fd = updateMock.mock.calls[0]![2];
    expect(fd.get("startTime")).toBe("2026-07-08T10:00");
    expect(fd.get("endTime")).toBe("2026-07-08T11:30");
  });

  test("saving the time editor without changes does not write", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit date and time" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByLabelText("Starts")).not.toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("Cancel closes the time editor without writing", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit date and time" }));
    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-07-09T08:00" },
    });
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Starts")).not.toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("toggling all-day on posts date-only keys from the typed times", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit date and time" }));
    await user.click(screen.getByRole("checkbox", { name: "All day" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const fd = updateMock.mock.calls[0]![2];
    expect(fd.get("isAllDay")).toBe("on");
    expect(fd.get("startTime")).toBe("2026-07-07");
    expect(fd.get("endTime")).toBe("2026-07-07");
  });
});

describe("opening a different event", () => {
  test("remounts: an open time-editor draft never carries onto the next event", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit date and time" }));
    expect(screen.getByLabelText("Starts")).toBeInTheDocument();

    rerender(ui(makeEvent({ id: "e2", title: "Other event" })));

    expect(screen.queryByLabelText("Starts")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Other event" })
    ).toBeInTheDocument();
  });
});

describe("Busy view and read-only mode", () => {
  test("a scrubbed event renders only the Busy dialog", () => {
    renderModal(
      makeEvent({
        title: "Busy",
        viewerCanSeeDetails: false,
        location: null,
        description: null,
      })
    );
    const dialog = screen.getByRole("dialog", { name: "Busy" });
    expect(dialog).toHaveTextContent("Unavailable");
    expect(dialog).toHaveTextContent(/don't have access/i);
    expect(
      screen.queryByRole("button", { name: "Edit Event title" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  test("canEdit=false shows static values with no editors or Delete", () => {
    renderModal(makeEvent(), { canEdit: false });
    expect(
      screen.getByRole("heading", { name: "Deposition prep" })
    ).toBeInTheDocument();
    expect(screen.getByText("Conference room")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit date and time" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /show details/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  test("canDelete=false hides Delete even for an editor", () => {
    renderModal(makeEvent(), { canDelete: false });
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit date and time" })
    ).toBeInTheDocument();
  });
});

describe("Delete", () => {
  test("a refused delete shows the reason instead of failing silently", async () => {
    const user = userEvent.setup();
    deleteMock.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to delete this event.",
      matterId: null,
    });
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: /Delete/ }));

    expect(
      await screen.findByText("You don't have permission to delete this event.")
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("a successful delete returns to the calendar", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: /Delete/ }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/calendar"));
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/^Delete ".+"\?$/), destructive: true })
    );
    expect(deleteMock).toHaveBeenCalledWith("e1");
  });

  test("deleting a matter event returns to that matter's events", async () => {
    const user = userEvent.setup();
    deleteMock.mockResolvedValueOnce({ ok: true, matterId: "m9" });
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: /Delete/ }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/matters/m9/events")
    );
  });

  test("Delete stays disabled after success while the redirect is in flight", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /Deleting/ })).toBeDisabled();
  });

  test("declining the confirm deletes nothing", async () => {
    const user = userEvent.setup();
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("video link", () => {
  test("a scheme-less link is normalized to https before it is saved", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit Video URL" }));
    await user.type(
      screen.getByRole("textbox", { name: "Video URL" }),
      "zoom.us/j/8123{Enter}"
    );

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![2].get("zoomUrl")).toBe(
      "https://zoom.us/j/8123"
    );
  });

  test("a non-link value is rejected with a message and never saved", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit Video URL" }));
    await user.type(
      screen.getByRole("textbox", { name: "Video URL" }),
      "javascript:alert(1){Enter}"
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/valid video link/i);
    expect(updateMock).not.toHaveBeenCalled();
    // The editor stays open with what was typed so it can be fixed.
    expect(screen.getByRole("textbox", { name: "Video URL" })).toHaveValue(
      "javascript:alert(1)"
    );
  });

  test("Enter on the Join link activates it instead of opening the URL editor", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent({ zoomUrl: "https://zoom.us/j/8123" }));

    const link = screen.getByRole("link", { name: "Join video call" });
    expect(link).toHaveAttribute("href", "https://zoom.us/j/8123");
    link.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.queryByRole("textbox", { name: "Video URL" })
    ).not.toBeInTheDocument();
  });

  test("a legacy non-URL value renders as text, not a relative link", () => {
    renderModal(makeEvent({ zoomUrl: "ask front desk" }));
    expect(
      screen.queryByRole("link", { name: "Join video call" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("ask front desk")).toBeInTheDocument();
  });
});

describe("type select", () => {
  test("a mouse pick commits immediately", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit Event type" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Event type" }),
      "hearing"
    );

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![2].get("type")).toBe("hearing");
  });

  test("arrowing through options does not save until Enter / blur", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent());

    await user.click(screen.getByRole("button", { name: "Edit Event type" }));
    const select = screen.getByRole("combobox", { name: "Event type" });

    // Browsers that fire change per arrow press must not save the
    // first neighbour.
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.change(select, { target: { value: "deposition" } });
    expect(updateMock).not.toHaveBeenCalled();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.change(select, { target: { value: "hearing" } });
    expect(updateMock).not.toHaveBeenCalled();

    fireEvent.keyDown(select, { key: "Enter" });
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![2].get("type")).toBe("hearing");
  });
});

describe("dialog focus management", () => {
  test("focus moves into the dialog on open and returns to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = renderModal();
    expect(screen.getByRole("dialog")).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  test("Tab wraps inside the dialog instead of escaping to the page", async () => {
    const user = userEvent.setup();
    renderModal(makeEvent(), { canEdit: false });

    const dialog = screen.getByRole("dialog");
    const buttons = dialog.querySelectorAll<HTMLElement>("button");
    const last = buttons[buttons.length - 1]!;
    last.focus();

    await user.tab();
    // Wrapped to the first focusable control inside the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });
});
