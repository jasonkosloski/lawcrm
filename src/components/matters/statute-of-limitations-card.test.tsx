/**
 * Tests for StatuteOfLimitationsCard — the timezone handling of the
 * deadline countdown and date rendering.
 *
 * SOL / incident dates are date-only values stored as UTC midnight.
 * The card reads them on the UTC day grid (ADR-012); the old local-time
 * floor made a stored 2026-07-10T00:00Z render as "Jul 9" for anyone
 * west of UTC. "Today" is the viewer's calendar day in their PROFILE
 * zone (the dashboard's UserTimeZoneProvider), not the runtime's zone,
 * so the server render (UTC) and the hydrated client agree. These tests
 * pin the runtime to America/Denver (UTC-6 in July) and vary the
 * provider zone to prove the profile zone wins.
 */

// Must be set before anything touches Date — V8 caches the zone.
process.env.TZ = "America/Denver";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/feedback", () => ({
  confirmAction: vi.fn(async () => true),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("@/app/actions/matters", () => ({
  setMatterSolSatisfied: vi.fn(),
}));

import { setMatterSolSatisfied } from "@/app/actions/matters";
import { notifyError } from "@/lib/feedback";
import { UserTimeZoneProvider } from "@/components/user-time-zone";
import {
  StatuteOfLimitationsCard,
  formatCalendarDate,
} from "./statute-of-limitations-card";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const baseProps = {
  matterId: "m1",
  satisfied: false,
  satisfiedAt: null,
  notes: null,
  canEdit: true,
};

describe("formatCalendarDate — UTC day grid", () => {
  test("renders the stored calendar day, not the local-shifted one", () => {
    // In America/Denver this instant is Jul 9, 6pm — the old
    // formatter showed "Jul 9, 2026".
    expect(formatCalendarDate(new Date("2026-07-10T00:00:00Z"))).toBe(
      "Fri, Jul 10, 2026"
    );
    // Also across a DST boundary (MST, UTC-7).
    expect(formatCalendarDate(new Date("2026-03-14T00:00:00Z"))).toBe(
      "Sat, Mar 14, 2026"
    );
  });
});

describe("StatuteOfLimitationsCard — rendered countdown", () => {
  test("shows the UTC deadline date and correct days remaining", () => {
    vi.setSystemTime(new Date("2026-07-06T02:00:00Z")); // Jul 5, 8pm MDT
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-10T00:00:00Z")}
      />
    );
    expect(screen.getByText("5 days remaining")).toBeInTheDocument();
    expect(screen.getByText("Fri, Jul 10, 2026")).toBeInTheDocument();
  });

  test("shows 'Due today' through the whole local deadline day", () => {
    vi.setSystemTime(new Date("2026-07-11T03:00:00Z")); // Jul 10, 9pm MDT
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-10T00:00:00Z")}
      />
    );
    expect(screen.getByText("Due today")).toBeInTheDocument();
  });

  test("shows overdue count once the local day has passed", () => {
    vi.setSystemTime(new Date("2026-07-06T18:00:00Z")); // Jul 6 local
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-01T00:00:00Z")}
      />
    );
    expect(screen.getByText("5 days overdue")).toBeInTheDocument();
  });

  test("incident date renders on the UTC day grid too", () => {
    vi.setSystemTime(new Date("2026-07-06T18:00:00Z"));
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-09-01T00:00:00Z")}
        incidentDate={new Date("2026-07-01T00:00:00Z")}
      />
    );
    expect(screen.getByText("Wed, Jul 1, 2026")).toBeInTheDocument();
  });
});

describe("StatuteOfLimitationsCard — profile zone, not runtime zone (F319/F685/F727)", () => {
  const date = new Date("2026-07-10T00:00:00Z");

  test("'today' follows the profile zone: Auckland is already Jul 6 while Denver is still Jul 5", () => {
    // 02:00Z Jul 6 = Jul 5 8pm in Denver (the runtime zone here) but
    // Jul 6 2pm in Auckland. The old runtime-zone code said 5 days.
    vi.setSystemTime(new Date("2026-07-06T02:00:00Z"));
    render(
      <UserTimeZoneProvider timeZone="Pacific/Auckland">
        <StatuteOfLimitationsCard {...baseProps} date={date} />
      </UserTimeZoneProvider>
    );
    expect(screen.getByText("4 days remaining")).toBeInTheDocument();
  });

  test("the same instant is 'Due today' for a Denver profile but overdue for a UTC profile", () => {
    // Jul 10 9pm in Denver = Jul 11 03:00Z.
    vi.setSystemTime(new Date("2026-07-11T03:00:00Z"));
    const { unmount } = render(
      <UserTimeZoneProvider timeZone="America/Denver">
        <StatuteOfLimitationsCard {...baseProps} date={date} />
      </UserTimeZoneProvider>
    );
    expect(screen.getByText("Due today")).toBeInTheDocument();
    unmount();
    render(
      <UserTimeZoneProvider timeZone="UTC">
        <StatuteOfLimitationsCard {...baseProps} date={date} />
      </UserTimeZoneProvider>
    );
    expect(screen.getByText("1 day overdue")).toBeInTheDocument();
  });

  test("'Marked satisfied' formats the timestamp in the profile zone", () => {
    vi.setSystemTime(new Date("2026-07-06T18:00:00Z"));
    render(
      <UserTimeZoneProvider timeZone="Pacific/Auckland">
        <StatuteOfLimitationsCard
          {...baseProps}
          date={date}
          satisfied
          // Jul 5 8pm Denver / Jul 6 2pm Auckland
          satisfiedAt={new Date("2026-07-06T02:00:00Z")}
        />
      </UserTimeZoneProvider>
    );
    expect(
      screen.getByText("Marked satisfied Mon, Jul 6, 2026")
    ).toBeInTheDocument();
  });
});

describe("StatuteOfLimitationsCard — singular day labels (F787)", () => {
  test("1 day remaining", () => {
    vi.setSystemTime(new Date("2026-07-09T18:00:00Z")); // Jul 9 local
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-10T00:00:00Z")}
      />
    );
    expect(screen.getByText("1 day remaining")).toBeInTheDocument();
  });

  test("1 day overdue", () => {
    vi.setSystemTime(new Date("2026-07-11T18:00:00Z")); // Jul 11 local
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-10T00:00:00Z")}
      />
    );
    expect(screen.getByText("1 day overdue")).toBeInTheDocument();
  });
});

describe("StatuteOfLimitationsCard — provenance line (F013)", () => {
  test("a date that is incident + period is described as 'from incident'", () => {
    vi.setSystemTime(new Date("2026-07-06T18:00:00Z"));
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-01T00:00:00Z")}
        incidentDate={new Date("2024-07-01T00:00:00Z")}
        statutePeriod={{ amount: 730, unit: "DAYS" }}
      />
    );
    expect(screen.getByText(/from incident/i)).toBeInTheDocument();
    expect(screen.queryByText(/manual date/i)).toBeNull();
  });

  test("a date that is NOT incident + period is flagged manual instead of implying it derives from the incident", () => {
    vi.setSystemTime(new Date("2026-07-06T18:00:00Z"));
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2027-01-15T00:00:00Z")}
        incidentDate={new Date("2024-07-01T00:00:00Z")}
        statutePeriod={{ amount: 730, unit: "DAYS" }}
      />
    );
    expect(screen.getByText(/manual date/i)).toBeInTheDocument();
    expect(screen.queryByText(/^from incident/i)).toBeNull();
  });
});

describe("StatuteOfLimitationsCard — matters.edit gating", () => {
  const date = new Date("2026-09-01T00:00:00Z");

  test("editors get the Mark satisfied toggle", () => {
    render(<StatuteOfLimitationsCard {...baseProps} date={date} />);
    expect(
      screen.getByRole("button", { name: /mark satisfied/i })
    ).toBeInTheDocument();
  });

  test("non-editors get no toggle while unsatisfied", () => {
    render(
      <StatuteOfLimitationsCard {...baseProps} date={date} canEdit={false} />
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/mark satisfied/i)).not.toBeInTheDocument();
  });

  test("non-editors still see the satisfied status, without a toggle", () => {
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={date}
        satisfied
        canEdit={false}
      />
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Satisfied")).toBeInTheDocument();
  });
});

describe("StatuteOfLimitationsCard — satisfied toggle (F785)", () => {
  const date = new Date("2026-09-01T00:00:00Z");

  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(setMatterSolSatisfied).mockReset();
  });

  test("clicking Mark satisfied calls the action with the new state", async () => {
    vi.mocked(setMatterSolSatisfied).mockResolvedValue({ ok: true });
    render(<StatuteOfLimitationsCard {...baseProps} date={date} />);
    fireEvent.click(screen.getByRole("button", { name: /mark satisfied/i }));
    await waitFor(() =>
      expect(setMatterSolSatisfied).toHaveBeenCalledWith("m1", true)
    );
  });

  test("a refused toggle toasts the error and the card goes back to unsatisfied", async () => {
    vi.mocked(setMatterSolSatisfied).mockResolvedValue({
      ok: false,
      error: "You don't have permission to edit matters.",
    });
    render(<StatuteOfLimitationsCard {...baseProps} date={date} />);
    fireEvent.click(screen.getByRole("button", { name: /mark satisfied/i }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        "You don't have permission to edit matters."
      )
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /mark satisfied/i })
      ).toBeInTheDocument()
    );
  });
});
