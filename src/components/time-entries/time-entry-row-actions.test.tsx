/**
 * Tests for TimeEntryRowMenu.
 *
 * Pins:
 *   - a refused status change surfaces the server's error (the radio
 *     group is controlled by entry.status, so a refusal otherwise just
 *     snaps back with no explanation);
 *   - "Billed" is never selectable by hand - invoice generation owns it;
 *   - billed entries are locked (edit / delete / status all disabled);
 *   - the page-supplied canEdit / canDelete decide what renders, and a
 *     viewer who can do neither gets no menu at all.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("@/app/actions/time-entries", () => ({
  deleteTimeEntry: vi.fn(),
  setTimeEntryStatus: vi.fn(),
  updateTimeEntry: vi.fn(),
}));

import { deleteTimeEntry, setTimeEntryStatus } from "@/app/actions/time-entries";
import { confirmAction, notifyError } from "@/lib/feedback";
import { parseDateOnly } from "@/lib/format-date";
import { TimeEntryRowMenu } from "./time-entry-row-actions";
import type { EditableTimeEntry } from "./edit-time-entry-dialog";

const entry: EditableTimeEntry = {
  id: "te1",
  date: parseDateOnly("2026-07-01")!,
  hours: 0.25,
  activity: "Review email",
  narrative: null,
  utbmsCode: null,
  billable: true,
  noCharge: false,
  privileged: false,
  status: "draft",
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });
const openMenu = async (user: ReturnType<typeof setupUser>) =>
  user.click(screen.getByRole("button", { name: /time entry actions/i }));

beforeEach(() => {
  vi.mocked(deleteTimeEntry).mockReset();
  vi.mocked(setTimeEntryStatus).mockReset();
  vi.mocked(confirmAction).mockResolvedValue(true);
  vi.mocked(notifyError).mockClear();
});

describe("TimeEntryRowMenu - server refusals are surfaced", () => {
  test("a refused status change toasts the server's message", async () => {
    vi.mocked(setTimeEntryStatus).mockResolvedValue({
      ok: false,
      error: "This entry changed while you were editing it.",
    });
    const user = setupUser();
    render(<TimeEntryRowMenu entry={entry} />);
    await openMenu(user);
    await user.click(await screen.findByText("Submitted"));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("This entry changed while you were editing it."),
    );
  });

  test("a refused delete toasts the server's message", async () => {
    vi.mocked(deleteTimeEntry).mockResolvedValue({
      ok: false,
      error: "Entry is already billed.",
    });
    const user = setupUser();
    render(<TimeEntryRowMenu entry={entry} />);
    await openMenu(user);
    await user.click(await screen.findByText("Delete"));

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Entry is already billed."));
  });

  test("the delete confirmation shows quarter hours exactly (0.25, not 0.3)", async () => {
    vi.mocked(deleteTimeEntry).mockResolvedValue({ ok: true });
    const user = setupUser();
    render(<TimeEntryRowMenu entry={entry} />);
    await openMenu(user);
    await user.click(await screen.findByText("Delete"));

    await waitFor(() =>
      expect(confirmAction).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringContaining("0.25h") }),
      ),
    );
  });
});

describe("TimeEntryRowMenu - Billed is not hand-selectable", () => {
  test("the Billed radio is disabled on an unbilled entry and never fires the action", async () => {
    const user = setupUser();
    render(<TimeEntryRowMenu entry={entry} />);
    await openMenu(user);

    const billed = await screen.findByRole("menuitemradio", { name: "Billed" });
    expect(billed).toHaveAttribute("aria-disabled", "true");
    await user.click(billed);
    expect(setTimeEntryStatus).not.toHaveBeenCalled();
  });

  test("other statuses stay selectable", async () => {
    vi.mocked(setTimeEntryStatus).mockResolvedValue({ ok: true });
    const user = setupUser();
    render(<TimeEntryRowMenu entry={entry} />);
    await openMenu(user);
    await user.click(await screen.findByText("Written off"));

    await waitFor(() => expect(setTimeEntryStatus).toHaveBeenCalledWith("te1", "written_off"));
  });

  test("a billed entry is locked: edit, delete and every status are disabled", async () => {
    const user = setupUser();
    render(<TimeEntryRowMenu entry={{ ...entry, status: "billed" }} />);
    await openMenu(user);

    const edit = await screen.findByRole("menuitem", { name: "Edit" });
    expect(edit).toHaveAttribute("aria-disabled", "true");
    const del = screen.getByRole("menuitem", { name: "Delete" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    for (const radio of screen.getAllByRole("menuitemradio")) {
      expect(radio).toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("TimeEntryRowMenu - capability props", () => {
  test("renders no menu when the viewer can neither edit nor delete", () => {
    render(<TimeEntryRowMenu entry={entry} canEdit={false} canDelete={false} />);
    expect(screen.queryByRole("button", { name: /time entry actions/i })).toBeNull();
  });

  test("canDelete only: Delete is offered, Edit and Set status are not", async () => {
    const user = setupUser();
    render(<TimeEntryRowMenu entry={entry} canEdit={false} canDelete />);
    await openMenu(user);

    await screen.findByText("Delete");
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Set status")).toBeNull();
  });

  test("canEdit only: Edit and Set status are offered, Delete is not", async () => {
    const user = setupUser();
    render(<TimeEntryRowMenu entry={entry} canEdit canDelete={false} />);
    await openMenu(user);

    await screen.findByText("Edit");
    expect(screen.getByText("Set status")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});
