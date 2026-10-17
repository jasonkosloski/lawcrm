/**
 * Tests for the conflict-flag dialog.
 *
 * Pins: the controls have accessible names (the field primitives
 * render none), a justification is required before the action is
 * called, a save sends status + trimmed-by-server justification and
 * closes, a server error stays visible, and every open starts from the
 * contact's CURRENT status with a blank justification.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/contacts", () => ({
  setContactConflictStatus: vi.fn(),
}));

import { setContactConflictStatus } from "@/app/actions/contacts";
import { ConflictStatusControl } from "./conflict-status-control";

const mockedSet = vi.mocked(setContactConflictStatus);
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  mockedSet.mockResolvedValue({ ok: true });
});

describe("ConflictStatusControl", () => {
  test("opens with named controls preset to the current status", async () => {
    const user = setupUser();
    render(<ConflictStatusControl contactId="c1" currentStatus="flagged" />);

    await user.click(screen.getByRole("button", { name: /update/i }));

    const select = await screen.findByRole("combobox", {
      name: /conflict status/i,
    });
    expect(select).toHaveValue("flagged");
    expect(screen.getByRole("textbox", { name: /justification/i })).toHaveValue("");
  });

  test("a blank justification is rejected client-side without calling the action", async () => {
    const user = setupUser();
    render(<ConflictStatusControl contactId="c1" currentStatus="clear" />);

    await user.click(screen.getByRole("button", { name: /update/i }));
    await user.click(await screen.findByRole("button", { name: "Save status" }));

    expect(
      screen.getByText(/a short justification is required/i)
    ).toBeInTheDocument();
    expect(mockedSet).not.toHaveBeenCalled();
  });

  test("saves the chosen status with the justification and closes", async () => {
    const user = setupUser();
    render(<ConflictStatusControl contactId="c1" currentStatus="clear" />);

    await user.click(screen.getByRole("button", { name: /update/i }));
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /conflict status/i }),
      "override"
    );
    await user.type(
      screen.getByRole("textbox", { name: /justification/i }),
      "Waiver signed 3/12"
    );
    await user.click(screen.getByRole("button", { name: "Save status" }));

    await waitFor(() =>
      expect(mockedSet).toHaveBeenCalledWith("c1", "override", "Waiver signed 3/12")
    );
    await waitFor(() =>
      expect(screen.queryByText("Update conflict status")).not.toBeInTheDocument()
    );
  });

  test("a server error stays on screen and the dialog stays open", async () => {
    mockedSet.mockResolvedValue({ ok: false, error: "Contact not found" });
    const user = setupUser();
    render(<ConflictStatusControl contactId="c1" currentStatus="clear" />);

    await user.click(screen.getByRole("button", { name: /update/i }));
    await user.type(
      await screen.findByRole("textbox", { name: /justification/i }),
      "because"
    );
    await user.click(screen.getByRole("button", { name: "Save status" }));

    expect(await screen.findByText("Contact not found")).toBeInTheDocument();
    expect(screen.getByText("Update conflict status")).toBeInTheDocument();
  });

  test("reopening resets the status, the justification and any old error", async () => {
    const user = setupUser();
    render(<ConflictStatusControl contactId="c1" currentStatus="clear" />);

    await user.click(screen.getByRole("button", { name: /update/i }));
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /conflict status/i }),
      "flagged"
    );
    await user.type(
      screen.getByRole("textbox", { name: /justification/i }),
      "draft text"
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText("Update conflict status")).not.toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /update/i }));

    expect(
      await screen.findByRole("combobox", { name: /conflict status/i })
    ).toHaveValue("clear");
    expect(screen.getByRole("textbox", { name: /justification/i })).toHaveValue("");
  });
});
