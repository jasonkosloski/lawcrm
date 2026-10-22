/**
 * Tests for LeadTimeComposer.
 *
 * Pins: the date prefills with the viewer's PROFILE-zone calendar day
 * (not the browser's), a server error keeps the typed fields, and a
 * successful save resets + collapses the composer.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/time-entries", () => ({
  createLeadTimeEntry: vi.fn(),
}));

import { createLeadTimeEntry } from "@/app/actions/time-entries";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { LeadTimeComposer } from "./lead-time-composer";

const mockedCreate = vi.mocked(createLeadTimeEntry);

function renderComposer(tz = "America/Denver") {
  return render(
    <UserTimeZoneProvider timeZone={tz}>
      <LeadTimeComposer leadId="lead1" />
    </UserTimeZoneProvider>,
  );
}

const expand = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /log intake time/i }));

beforeEach(() => {
  mockedCreate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LeadTimeComposer", () => {
  test("the date prefills with today in the PROFILE zone, not the browser's", async () => {
    // 2026-04-27 20:00Z is Apr 28 in Auckland whatever zone the test
    // runner (Denver or UTC) is in.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-27T20:00:00Z"));
    const user = userEvent.setup({ advanceTimers: () => {} });
    renderComposer("Pacific/Auckland");
    await expand(user);
    expect(screen.getByLabelText("Date")).toHaveValue("2026-04-28");
  });

  test("a server error keeps what was typed", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue({
      status: "error",
      errors: { hours: ["Hours must be positive"] },
    });
    renderComposer();
    await expand(user);
    const activity = screen.getByPlaceholderText(/activity/i);
    await user.type(activity, "Intake call");
    const hours = document.querySelector('input[name="hours"]') as HTMLInputElement;
    await user.type(hours, "0");
    await user.click(screen.getByRole("button", { name: /save time entry/i }));
    expect(await screen.findByText("Hours must be positive")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/activity/i)).toHaveValue("Intake call");
    expect((document.querySelector('input[name="hours"]') as HTMLInputElement).value).toBe("0");
  });

  test("a successful save collapses the composer and clears the fields", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue({ status: "ok" });
    renderComposer();
    await expand(user);
    await user.type(screen.getByPlaceholderText(/activity/i), "Intake call");
    await user.type(document.querySelector('input[name="hours"]') as HTMLInputElement, "0.5");
    await user.click(screen.getByRole("button", { name: /save time entry/i }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/activity/i)).not.toBeInTheDocument());
    expect(mockedCreate.mock.calls[0][0]).toBe("lead1");

    await expand(user);
    expect(screen.getByPlaceholderText(/activity/i)).toHaveValue("");
  });
});
