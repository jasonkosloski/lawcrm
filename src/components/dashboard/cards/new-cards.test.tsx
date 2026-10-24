import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";

import { PinnedCard } from "./pinned";
import { SolsCard } from "./sols";
import { TimeWeekCard } from "./time-week";
import { NewLeadsCard } from "./new-leads";
import { UnbilledCard } from "./unbilled";

const day = (key: string) => new Date(`${key}T00:00:00Z`);

describe("PinnedCard", () => {
  test("links to the matter and shows the next deadline", () => {
    render(
      <PinnedCard
        items={[
          {
            id: "m1",
            name: "Smith v. Jones",
            color: "#123456",
            stageName: "Discovery",
            nextDeadline: { title: "Disclosures", dueDate: day("2026-10-25"), days: 2 },
          },
        ]}
      />,
    );
    expect(screen.getByText("Smith v. Jones").closest("a")?.getAttribute("href")).toBe(
      "/matters/m1",
    );
    expect(screen.getByText("Discovery · Disclosures")).toBeTruthy();
  });

  test("empty state", () => {
    render(<PinnedCard items={[]} />);
    expect(screen.getByText("Pin a matter from its page to keep it here.")).toBeTruthy();
  });
});

describe("SolsCard", () => {
  test("flags lapsed SOLs and shows +N more", () => {
    render(
      <SolsCard
        data={{
          items: [
            { matterId: "m1", matterName: "Lapsed", solDate: day("2026-10-01"), days: -22 },
            { matterId: "m2", matterName: "Soon", solDate: day("2026-10-30"), days: 7 },
          ],
          hidden: 3,
          lapsed: 4,
        }}
      />,
    );
    expect(screen.getByText("4 lapsed")).toBeTruthy();
    expect(screen.getByText("22d late")).toBeTruthy();
    expect(screen.getByText("+3 more")).toBeTruthy();
  });

  test("empty state names the window", () => {
    render(<SolsCard data={{ items: [], hidden: 0, lapsed: 0 }} />);
    expect(screen.getByText("No open SOLs in the next 90 days.")).toBeTruthy();
  });
});

describe("TimeWeekCard", () => {
  test("renders totals, the goal line and a labelled bar per day", () => {
    const keys = ["18", "19", "20", "21", "22", "23", "24"].map((d) => `2026-10-${d}`);
    render(
      <TimeWeekCard
        data={{
          days: keys.map((dayKey, i) => ({
            dayKey,
            totalHours: i === 1 ? 2.5 : 0,
            billableHours: i === 1 ? 2 : 0,
            segments: [],
          })),
          totalHours: 2.5,
          billableHours: 2,
          dailyGoal: 6,
          todayKey: "2026-10-19",
        }}
      />,
    );
    expect(screen.getByText("2.5h")).toBeTruthy();
    expect(screen.getByText("2.0h billable")).toBeTruthy();
    expect(screen.getByText("Goal 6.0h")).toBeTruthy();
    expect(screen.getByLabelText("Mon, Oct 19: 2.5 hours")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });
});

describe("NewLeadsCard", () => {
  test("labels stage and source and links to the lead", () => {
    render(
      <NewLeadsCard
        data={{
          items: [
            {
              id: "l1",
              name: "Pat Doe",
              source: "web",
              stage: "new",
              createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
            },
          ],
          hidden: 0,
        }}
      />,
    );
    expect(screen.getByText("Pat Doe").closest("a")?.getAttribute("href")).toBe("/intake/l1");
    expect(screen.getByText(/Web form/)).toBeTruthy();
    expect(screen.getByText("2h ago")).toBeTruthy();
  });
});

describe("UnbilledCard", () => {
  test("shows the total and links each matter to its billing tab", () => {
    render(
      <UnbilledCard
        data={{
          items: [{ matterId: "m1", matterName: "Big", hours: 5, amount: 1500 }],
          hidden: 2,
          totalHours: 6,
          totalAmount: 1700,
        }}
      />,
    );
    expect(screen.getByText("$1,700")).toBeTruthy();
    expect(screen.getByText("Big").closest("a")?.getAttribute("href")).toBe("/matters/m1/billing");
    expect(screen.getByText("+2 more matters")).toBeTruthy();
  });
});
