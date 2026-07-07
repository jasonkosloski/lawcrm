/**
 * Tests for the shared EmptyState. Worth pinning down:
 *   - title always renders; description and CTA only when given
 *   - the icon is decorative (aria-hidden) so screen readers hear
 *     the title, not "svg image"
 *   - `framed` toggles the standalone dashed-card treatment
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  test("renders title alone", () => {
    render(<EmptyState title="No matters yet" />);
    expect(screen.getByText("No matters yet")).toBeTruthy();
  });

  test("renders description and CTA slot when provided", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No notifications yet"
        description="Deadlines and task assignments land here."
      >
        <button type="button">Create one</button>
      </EmptyState>
    );
    expect(screen.getByText("No notifications yet")).toBeTruthy();
    expect(
      screen.getByText("Deadlines and task assignments land here.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create one" })).toBeTruthy();
  });

  test("icon is decorative (aria-hidden)", () => {
    const { container } = render(<EmptyState icon={Inbox} title="Empty" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  test("framed adds the dashed-card treatment, default doesn't", () => {
    const { container: framed } = render(
      <EmptyState title="Empty" framed />
    );
    expect(framed.firstElementChild?.className).toContain("border-dashed");

    const { container: plain } = render(<EmptyState title="Empty" />);
    expect(plain.firstElementChild?.className).not.toContain("border-dashed");
  });
});
