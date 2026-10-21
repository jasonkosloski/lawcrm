/**
 * DueLabel: the date leads unless the countdown already says it, and
 * colour appears only when the date needs attention.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { DueLabel, dueText, dueTone } from "./due-label";

const OCT_25 = new Date(Date.UTC(2026, 9, 25));

describe("dueText / dueTone", () => {
  test("names today, tomorrow, a countdown and a lapse", () => {
    expect(dueText(0)).toBe("Today");
    expect(dueText(1)).toBe("Tomorrow");
    expect(dueText(5)).toBe("5d");
    expect(dueText(-3)).toBe("3d late");
  });

  test("overdue is danger, two days or less is warn, the rest muted", () => {
    expect(dueTone(-1)).toBe("danger");
    expect(dueTone(0)).toBe("warn");
    expect(dueTone(2)).toBe("warn");
    expect(dueTone(3)).toBe("muted");
  });
});

describe("DueLabel", () => {
  test("leads with the calendar date (read in UTC) for a countdown", () => {
    render(<DueLabel dueDate={OCT_25} days={5} />);
    expect(screen.getByText(/Oct 25/)).toBeInTheDocument();
    expect(screen.getByText(/5d/)).toBeInTheDocument();
  });

  test("drops the date when the word already says it", () => {
    const { container } = render(<DueLabel dueDate={OCT_25} days={1} />);
    expect(container.textContent).toBe("Tomorrow");
  });

  test("colours a lapse as danger", () => {
    const { container } = render(<DueLabel dueDate={OCT_25} days={-2} />);
    expect(container.firstElementChild).toHaveClass("text-danger");
    expect(container.textContent).toContain("2d late");
  });

  test("works without a date", () => {
    const { container } = render(<DueLabel days={4} />);
    expect(container.textContent).toBe("4d");
  });
});
