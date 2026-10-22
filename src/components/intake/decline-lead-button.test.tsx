/**
 * Tests for DeclineLeadButton.
 *
 * Pins: the reason is cleared on every open; a server error keeps the
 * typed reason and shows the banner; a successful decline closes the
 * dialog — every time, not just the first.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/leads", () => ({
  declineLead: vi.fn(),
}));

import { declineLead } from "@/app/actions/leads";
import { DeclineLeadButton } from "./decline-lead-button";

const mockedDecline = vi.mocked(declineLead);

const REASON = /why declining/i;

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^decline$/i }));
}

beforeEach(() => {
  mockedDecline.mockReset();
});

describe("DeclineLeadButton", () => {
  test("the reason is cleared each time the dialog opens", async () => {
    const user = userEvent.setup();
    render(<DeclineLeadButton leadId="lead1" />);
    await open(user);
    await user.type(screen.getByPlaceholderText(REASON), "Out of statute");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await open(user);
    expect(screen.getByPlaceholderText(REASON)).toHaveValue("");
  });

  test("a server error shows the banner and keeps the typed reason", async () => {
    const user = userEvent.setup();
    mockedDecline.mockResolvedValue({
      status: "error",
      errors: { _form: ["Lead is already converted — can't decline a matter that exists."] },
    });
    render(<DeclineLeadButton leadId="lead1" />);
    await open(user);
    await user.type(screen.getByPlaceholderText(REASON), "Typed reason");
    await user.click(screen.getByRole("button", { name: /decline lead/i }));
    expect(await screen.findByText(/already converted/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(REASON)).toHaveValue("Typed reason");
    // The action got the leadId and the typed reason.
    const fd = mockedDecline.mock.calls[0][2] as FormData;
    expect(mockedDecline.mock.calls[0][0]).toBe("lead1");
    expect(fd.get("reason")).toBe("Typed reason");
  });

  test("a successful decline closes the dialog, and a second success closes it again", async () => {
    const user = userEvent.setup();
    mockedDecline.mockResolvedValue({ status: "ok" });
    render(<DeclineLeadButton leadId="lead1" />);

    for (let i = 0; i < 2; i++) {
      await open(user);
      await user.click(screen.getByRole("button", { name: /decline lead/i }));
      await waitFor(() => expect(screen.queryByPlaceholderText(REASON)).not.toBeInTheDocument());
    }
    expect(mockedDecline).toHaveBeenCalledTimes(2);
  });
});
