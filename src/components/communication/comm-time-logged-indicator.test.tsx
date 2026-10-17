/**
 * Tests for CommTimeLoggedIndicator.
 *
 *  - Date-only TimeEntry.date renders on its own calendar day (the
 *    old zone-less formatDate in a client component showed Oct 15 for
 *    an Oct 16 entry west of UTC).
 *  - Hours keep quarter-hour precision (0.25h is not "0.3h").
 *  - Two users sharing initials are not merged into one.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { parseDateOnly } from "@/lib/format-date";
import {
  aggregateByUser,
  CommTimeLoggedIndicator,
  formatHours,
  type CommTimeEntryView,
} from "./comm-time-logged-indicator";

function entry(overrides: Partial<CommTimeEntryView>): CommTimeEntryView {
  return {
    id: "e1",
    hours: 0.5,
    date: parseDateOnly("2026-10-16")!,
    activity: "Reviewed email",
    userName: "Jason Kosloski",
    userInitials: "JK",
    billable: true,
    ...overrides,
  };
}

describe("formatHours", () => {
  test("keeps quarter-hour precision, at least one decimal", () => {
    expect(formatHours(0.25)).toBe("0.25");
    expect(formatHours(0.75)).toBe("0.75");
    expect(formatHours(0.5)).toBe("0.5");
    expect(formatHours(1)).toBe("1.0");
    expect(formatHours(1.25)).toBe("1.25");
    expect(formatHours(0)).toBe("0.0");
  });
});

describe("chip totals", () => {
  test("two quarter-hour entries read 0.5h with parts that sum", () => {
    render(
      <CommTimeLoggedIndicator
        entries={[
          entry({ id: "a", hours: 0.25 }),
          entry({
            id: "b",
            hours: 0.25,
            userName: "Riley King",
            userInitials: "RK",
          }),
        ]}
      />
    );
    const chip = screen.getByRole("button");
    expect(chip).toHaveTextContent("0.5h");
    expect(chip).toHaveTextContent("JK 0.25h");
    expect(chip).toHaveTextContent("RK 0.25h");
  });
});

describe("date-only entry dates", () => {
  test("an Oct 16 entry lists as Oct 16 (not a day early in US zones)", async () => {
    const user = userEvent.setup();
    render(
      <CommTimeLoggedIndicator
        entries={[entry({ date: parseDateOnly("2026-10-16")! })]}
      />
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Oct 16")).toBeInTheDocument();
  });
});

describe("aggregateByUser", () => {
  test("users who share initials stay separate", () => {
    const rows = aggregateByUser([
      entry({ id: "a", hours: 0.4 }),
      entry({
        id: "b",
        hours: 0.2,
        userName: "Jessica King",
        userInitials: "JK",
      }),
      entry({ id: "c", hours: 0.25 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Jason Kosloski", hours: 0.65 });
    expect(rows[1]).toMatchObject({ name: "Jessica King", hours: 0.2 });
  });

  test("same-initials users get the per-user breakdown and a Total row", async () => {
    const user = userEvent.setup();
    render(
      <CommTimeLoggedIndicator
        entries={[
          entry({ id: "a", hours: 0.4 }),
          entry({
            id: "b",
            hours: 0.2,
            userName: "Jessica King",
            userInitials: "JK",
          }),
        ]}
      />
    );
    await user.click(screen.getByRole("button", { name: /0\.6h/ }));
    expect(screen.getByText("Total")).toBeInTheDocument();
  });
});
