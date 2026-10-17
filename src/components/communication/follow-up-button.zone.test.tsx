/**
 * FollowUpButton - viewer-zone semantics (ADR-012).
 *
 * followUpAt is an instant (end of the chosen day). The chip's
 * "Today" / "Tomorrow" / overdue state and the popover's presets must
 * follow the viewer's PROFILE zone, not the runtime's (server UTC on
 * SSR, browser zone on hydrate - which flipped Today/Tomorrow and
 * caused hydration mismatches in US evenings).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { FollowUpButton, type FollowUpAction } from "./follow-up-button";

const TZ = "America/Los_Angeles";
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderButton(
  followUpAt: Date | null,
  action: FollowUpAction = vi.fn(async () => ({ ok: true as const }))
) {
  return render(
    <UserTimeZoneProvider timeZone={TZ}>
      <FollowUpButton threadId="t1" followUpAt={followUpAt} action={action} />
    </UserTimeZoneProvider>
  );
}

const chip = () => screen.getByTitle(/follow.?up/i);

describe("evening in the viewer's zone", () => {
  beforeEach(() => {
    // Apr 27, 7:00 PM PDT - already Apr 28 in UTC and (west of UTC)
    // in some runner zones, but still Apr 27 for this viewer.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  test("a follow-up for the viewer's today reads 'Today', not 'Tomorrow'", () => {
    // End of Apr 27 PDT (23:59:59.999 PDT) = 06:59:59.999Z on Apr 28.
    renderButton(new Date("2026-04-28T06:59:59.999Z"));
    expect(chip()).toHaveTextContent("Today");
    // Not overdue: end of today has not passed.
    expect(chip().className).not.toContain("text-warn");
  });

  test("the day after reads 'Tomorrow'", () => {
    renderButton(new Date("2026-04-29T06:59:59.999Z"));
    expect(chip()).toHaveTextContent("Tomorrow");
  });

  test("yesterday is overdue (warn styling)", () => {
    renderButton(new Date("2026-04-27T06:59:59.999Z")); // end of Apr 26 PDT
    expect(chip().className).toContain("text-warn");
  });

  test("the popover input and presets use the viewer's calendar day", async () => {
    const user = setupUser();
    const action = vi.fn(async () => ({ ok: true as const }));
    renderButton(new Date("2026-04-28T06:59:59.999Z"), action);

    await user.click(chip());
    await screen.findByText(/follow up by/i);
    const input = document.querySelector(
      'input[type="date"]'
    ) as HTMLInputElement;
    // The stored instant is Apr 28 in UTC but Apr 27 for the viewer.
    expect(input.value).toBe("2026-04-27");
    expect(input.min).toBe("2026-04-27");

    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("t1", "2026-04-28"));
  });

  test("'Next Mon' and 'In a week' count from the viewer's today", async () => {
    const user = setupUser();
    const action = vi.fn(async () => ({ ok: true as const }));
    renderButton(null, action);

    await user.click(chip());
    await screen.findByText(/follow up by/i);
    // Apr 27, 2026 is a Monday -> next Monday is a full week later.
    await user.click(screen.getByRole("button", { name: "Next Mon" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("t1", "2026-05-04"));
  });
});

describe("a thrown action does not escape the transition", () => {
  test("alerts instead of bubbling to the error boundary", async () => {
    const user = setupUser();
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const action = vi.fn(async () => {
      throw new Error("db down");
    });
    renderButton(null, action);

    await user.click(chip());
    await screen.findByText(/follow up by/i);
    await user.click(screen.getByRole("button", { name: "Today" }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0]![0]).toMatch(/try again/i);
    vi.unstubAllGlobals();
  });
});
