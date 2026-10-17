import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { PageSkeleton } from "@/components/layout/page-skeleton";

describe("PageSkeleton", () => {
  test("renders its own TopBar skeleton and scroll body by default", () => {
    const { container } = render(<PageSkeleton variant="detail" />);
    expect(container.querySelector(".brand-gradient-line")).not.toBeNull();
    expect(container.querySelector(".overflow-y-auto")).not.toBeNull();
  });

  test("withTopBar={false} renders only the body (for use under a real header)", () => {
    const { container } = render(
      <PageSkeleton variant="detail" withTopBar={false} />
    );
    // No fake header, no nested scroll container.
    expect(container.querySelector(".brand-gradient-line")).toBeNull();
    expect(container.querySelector(".overflow-y-auto")).toBeNull();
    // Still shows placeholder content.
    expect(container.querySelectorAll("[data-slot='skeleton'], .animate-pulse").length).toBeGreaterThan(0);
  });
});
