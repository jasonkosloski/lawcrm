import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageSkeleton } from "./page-skeleton";

describe("PageSkeleton", () => {
  test("draws the TopBar placeholder by default", () => {
    render(<PageSkeleton variant="table" />);
    expect(screen.getByTestId("skeleton-topbar")).toBeInTheDocument();
  });

  test("withTopBar={false} omits it, so a tab switch under the real TopBar shows no second header", () => {
    render(<PageSkeleton variant="detail" withTopBar={false} />);
    expect(screen.queryByTestId("skeleton-topbar")).toBeNull();
  });

  test("withTopBar={false} renders only the body: no nested scroll container, still has placeholders", () => {
    const { container } = render(<PageSkeleton variant="detail" withTopBar={false} />);
    expect(container.querySelector(".brand-gradient-line")).toBeNull();
    expect(container.querySelector(".overflow-y-auto")).toBeNull();
    expect(
      container.querySelectorAll(".animate-pulse, [data-slot='skeleton']").length,
    ).toBeGreaterThan(0);
  });
});
