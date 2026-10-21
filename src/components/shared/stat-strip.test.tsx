/**
 * StatStrip: label above value in a description list, columns that
 * match the item count, links only where a stat has somewhere to go,
 * and colour only on a stat that asks for it.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatStrip } from "./stat-strip";

describe("StatStrip", () => {
  test("renders each label and value", () => {
    render(
      <StatStrip
        stats={[
          { label: "Open matters", value: "10", detail: "+2 this week" },
          { label: "Hours today", value: "9.2" },
        ]}
      />
    );
    expect(screen.getByText("Open matters")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("+2 this week")).toBeInTheDocument();
    expect(screen.getByText("9.2")).toBeInTheDocument();
  });

  test("sets the column count from the number of stats", () => {
    const { container } = render(
      <StatStrip
        stats={[
          { label: "A", value: "1" },
          { label: "B", value: "2" },
          { label: "C", value: "3" },
        ]}
      />
    );
    expect(container.firstElementChild).toHaveClass("sm:grid-cols-3");
  });

  test("links a stat only when it has an href", () => {
    render(
      <StatStrip
        stats={[
          { label: "Unread email", value: "3", href: "/communication" },
          { label: "Trust balance", value: "$0.00" },
        ]}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/communication");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  test("colours a value only by its tone", () => {
    render(
      <StatStrip
        stats={[
          { label: "Overdue", value: "2", tone: "danger" },
          { label: "Open", value: "5" },
        ]}
      />
    );
    expect(screen.getByText("2")).toHaveClass("text-danger");
    expect(screen.getByText("5")).toHaveClass("text-ink");
  });

  test("renders nothing for no stats", () => {
    const { container } = render(<StatStrip stats={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
