/**
 * Tests for DeadlineRowMenu.
 *
 * Pins: a refused action (e.g. delete / status on the auto-managed SOL
 * row) surfaces the server's error instead of failing silently, the
 * SOL row has no Delete item at all, and each item is hidden from a
 * viewer who lacks its permission (a denied action would redirect to
 * `/` and discard their input).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/deadlines", () => ({
  deleteDeadline: vi.fn(),
  setDeadlineStatus: vi.fn(),
  updateDeadline: vi.fn(),
}));
vi.mock("@/app/actions/note-on-entity", () => ({
  addNoteToDeadline: vi.fn(),
}));
vi.mock("@/app/actions/time-on-entity", () => ({
  addTimeEntryToDeadline: vi.fn(),
}));

import { deleteDeadline, setDeadlineStatus } from "@/app/actions/deadlines";
import { DeadlineRowMenu } from "./deadline-row-actions";
import type { EditableDeadline } from "./edit-deadline-dialog";

const base: EditableDeadline = {
  id: "d1",
  title: "File answer",
  description: null,
  kind: "manual",
  sourceRef: null,
  dueDateKey: "2026-07-20",
  updatedAt: "2026-07-01T00:00:00.000Z",
  status: "open",
};

const all = { canEdit: true, canDelete: true, canLogTime: true, canAddNote: true };

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  vi.mocked(deleteDeadline).mockReset();
  vi.mocked(setDeadlineStatus).mockReset();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("DeadlineRowMenu", () => {
  test("shows the server error when a delete is refused", async () => {
    vi.mocked(deleteDeadline).mockResolvedValue({
      ok: false,
      error: "Deadline not found",
    });
    const user = setupUser();
    render(<DeadlineRowMenu deadline={base} {...all} />);
    await user.click(screen.getByRole("button", { name: /deadline actions/i }));
    await user.click(await screen.findByText("Delete"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Deadline not found")
    );
  });

  test("shows the server error when a status change is refused", async () => {
    vi.mocked(setDeadlineStatus).mockResolvedValue({
      ok: false,
      error: "Nope",
    });
    const user = setupUser();
    render(<DeadlineRowMenu deadline={base} {...all} />);
    await user.click(screen.getByRole("button", { name: /deadline actions/i }));
    await user.click(await screen.findByText("Completed"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Nope")
    );
  });

  test("the auto-managed SOL row has no Delete item", async () => {
    const user = setupUser();
    render(
      <DeadlineRowMenu
        deadline={{ ...base, sourceType: "statute_of_limitations" }}
        {...all}
      />
    );
    await user.click(screen.getByRole("button", { name: /deadline actions/i }));
    await screen.findByText("Edit");
    expect(screen.queryByText("Delete")).toBeNull();
  });
});

describe("DeadlineRowMenu - permission-gated items", () => {
  const open = async (user: ReturnType<typeof setupUser>) => {
    await user.click(screen.getByRole("button", { name: /deadline actions/i }));
  };

  test("a viewer with only deadlines.edit sees Edit and statuses, not Delete or Log time", async () => {
    const user = setupUser();
    render(
      <DeadlineRowMenu
        deadline={base}
        canEdit
        canDelete={false}
        canLogTime={false}
        canAddNote={false}
      />
    );
    await open(user);
    await screen.findByText("Edit");
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.queryByText(/log time/i)).toBeNull();
  });

  test("a viewer with only deadlines.delete sees Delete and nothing editable", async () => {
    const user = setupUser();
    render(
      <DeadlineRowMenu
        deadline={base}
        canEdit={false}
        canDelete
        canLogTime={false}
        canAddNote={false}
      />
    );
    await open(user);
    await screen.findByText("Delete");
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Set status")).toBeNull();
  });

  test("a viewer with no deadline permission gets no kebab at all", () => {
    render(
      <DeadlineRowMenu
        deadline={base}
        canEdit={false}
        canDelete={false}
        canLogTime={false}
        canAddNote={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: /deadline actions/i })
    ).toBeNull();
  });
});

describe("DeadlineRowMenu — Add note", () => {
  const openMenu = async (user: ReturnType<typeof setupUser>) =>
    user.click(screen.getByRole("button", { name: /deadline actions/i }));
  test("notes.create alone shows the kebab with just 'Add note', which opens the composer", async () => {
    const user = setupUser();
    render(
      <DeadlineRowMenu
        deadline={base}
        canEdit={false}
        canDelete={false}
        canLogTime={false}
        canAddNote
      />
    );
    await openMenu(user);
    await user.click(await screen.findByText("Add note on this deadline"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).toBeNull();
  });
});
