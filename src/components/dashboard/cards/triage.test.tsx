import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";

import { TriageCard } from "./triage";
import type { TriageGroup } from "@/lib/queries/dashboard-triage";

const group = (over: Partial<TriageGroup> = {}): TriageGroup => ({
  key: "deadlines",
  label: "Deadlines",
  total: 1,
  hidden: 0,
  rows: [
    {
      id: "d1",
      title: "File answer",
      context: "Smith v. Jones",
      href: "/matters/m1/deadlines",
      dueDate: new Date("2026-06-10T00:00:00Z"),
      days: -5,
    },
  ],
  ...over,
});

describe("TriageCard", () => {
  test("empty state is a short line, not an empty card", () => {
    render(<TriageCard data={{ groups: [] }} />);
    expect(screen.getByText("Needs me now")).toBeTruthy();
    expect(screen.getByText("Nothing needs you right now.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("renders a linked row with its matter and a due label", () => {
    render(<TriageCard data={{ groups: [group()] }} />);
    expect(screen.getByText("File answer").closest("a")?.getAttribute("href")).toBe(
      "/matters/m1/deadlines",
    );
    expect(screen.getByText("Smith v. Jones")).toBeTruthy();
    expect(screen.getByText(/5d late/)).toBeTruthy();
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  test("shows +N more when a group is capped", () => {
    render(<TriageCard data={{ groups: [group({ total: 9, hidden: 8 })] }} />);
    expect(screen.getByText("+8 more")).toBeTruthy();
  });

  test("rows without a due date and without a link render plain", () => {
    render(
      <TriageCard
        data={{
          groups: [
            group({
              key: "tasks",
              label: "Your tasks",
              rows: [
                {
                  id: "t1",
                  title: "Call back",
                  context: null,
                  href: null,
                  dueDate: null,
                  days: null,
                },
              ],
            }),
          ],
        }}
      />,
    );
    expect(screen.getByText("Call back").closest("a")).toBeNull();
  });
});
