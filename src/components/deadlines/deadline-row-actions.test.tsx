/**
 * Tests for DeadlineRowMenu.
 *
 * Pins: a refused action (e.g. delete / status on the auto-managed SOL
 * row) surfaces the server's error instead of failing silently, and
 * the SOL row has no Delete item at all.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/deadlines", () => ({
  deleteDeadline: vi.fn(),
  setDeadlineStatus: vi.fn(),
  updateDeadline: vi.fn(),
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
  dueDate: new Date(2026, 6, 20),
  status: "open",
};

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
    render(<DeadlineRowMenu deadline={base} />);
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
    render(<DeadlineRowMenu deadline={base} />);
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
      />
    );
    await user.click(screen.getByRole("button", { name: /deadline actions/i }));
    await screen.findByText("Edit");
    expect(screen.queryByText("Delete")).toBeNull();
  });
});
