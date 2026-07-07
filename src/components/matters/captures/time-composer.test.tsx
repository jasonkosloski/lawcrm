/**
 * Tests for the TimeComposer v2 fields.
 *
 * What matters here:
 *   - the UTBMS picker posts its selection as `utbmsCode`
 *   - the start–end duration mode computes decimal hours client-side
 *     and posts them through the SAME `hours` field the action
 *     already validates (the range never reaches the server)
 *   - an invalid/incomplete range clears hours, which keeps the Save
 *     button gated (hasContent) so nothing unparseable can post
 *
 * Querying trap (see docs/TESTING.md): form helpers here don't wire
 * <label htmlFor>, so inputs are grabbed by placeholder / aria-label
 * / [name] instead of getByLabelText.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TimeComposer } from "./time-composer";
import type { CaptureFormState } from "@/lib/capture-schemas";

const mockedCreate = vi.hoisted(() =>
  vi.fn<
    (
      matterId: string,
      prev: CaptureFormState,
      formData: FormData
    ) => Promise<CaptureFormState>
  >()
);

vi.mock("@/app/actions/captures", () => ({
  createTimeEntryWithCaptures: mockedCreate,
}));

beforeEach(() => {
  mockedCreate.mockReset();
  // Fresh object per call — mirrors real server actions (never
  // reference-equal across submissions).
  mockedCreate.mockImplementation(async () => ({ status: "ok" as const }));
});

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /log time/i }));
}

/** The FormData the (mocked) action received on its last call. */
function postedForm(): FormData {
  const call = mockedCreate.mock.calls.at(-1);
  expect(call).toBeTruthy();
  return call![2];
}

describe("TimeComposer — UTBMS picker", () => {
  test("selection posts as utbmsCode", async () => {
    const user = userEvent.setup();
    const { container } = render(<TimeComposer matterId="m1" />);
    await expand(user);

    await user.type(screen.getByPlaceholderText("Hrs"), "1.5");
    await user.type(
      screen.getByPlaceholderText(/^Activity/),
      "Draft motion"
    );
    const select = container.querySelector(
      'select[name="utbmsCode"]'
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    await user.selectOptions(select, "A103");

    await user.click(
      screen.getByRole("button", { name: /save time entry/i })
    );

    const fd = postedForm();
    expect(fd.get("utbmsCode")).toBe("A103");
    expect(fd.get("hours")).toBe("1.5");
    expect(fd.get("activity")).toBe("Draft motion");
  });

  test("unset picker posts empty string (server normalizes to null)", async () => {
    const user = userEvent.setup();
    render(<TimeComposer matterId="m1" />);
    await expand(user);

    await user.type(screen.getByPlaceholderText("Hrs"), "0.5");
    await user.type(screen.getByPlaceholderText(/^Activity/), "Call");
    await user.click(
      screen.getByRole("button", { name: /save time entry/i })
    );

    expect(postedForm().get("utbmsCode")).toBe("");
  });
});

describe("TimeComposer — start–end duration mode", () => {
  test("computes decimal hours from the range and posts them as `hours`", async () => {
    const user = userEvent.setup();
    render(<TimeComposer matterId="m1" />);
    await expand(user);

    await user.click(screen.getByRole("button", { name: "start–end" }));
    // Range mode replaces the visible hours input with time inputs.
    expect(screen.queryByPlaceholderText("Hrs")).toBeNull();

    // userEvent's per-keystroke typing into <input type="time"> is
    // unreliable under happy-dom — set the whole value via a change
    // event, which is what the browser delivers anyway.
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "10:30" },
    });

    expect(
      screen.getByTestId("range-computed-hours").textContent
    ).toContain("1.5");

    await user.type(screen.getByPlaceholderText(/^Activity/), "Hearing");
    await user.click(
      screen.getByRole("button", { name: /save time entry/i })
    );

    expect(postedForm().get("hours")).toBe("1.5");
  });

  test("incomplete range clears hours and keeps Save disabled", async () => {
    const user = userEvent.setup();
    render(<TimeComposer matterId="m1" />);
    await expand(user);

    // Type hours first, then switch modes — the stale decimal value
    // must not survive into an empty range.
    await user.type(screen.getByPlaceholderText("Hrs"), "2");
    await user.click(screen.getByRole("button", { name: "start–end" }));
    await user.type(screen.getByPlaceholderText(/^Activity/), "Work");

    expect(
      screen.getByRole("button", { name: /save time entry/i })
    ).toBeDisabled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
