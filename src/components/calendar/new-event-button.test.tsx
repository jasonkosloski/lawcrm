import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));

vi.mock("@/components/create-stack/create-stack-provider", () => ({
  useCreateStack: () => ({ open: openMock }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { NewEventButton } from "./new-event-button";

describe("NewEventButton", () => {
  test("offers the full-page and quick-composer entry points", () => {
    render(<NewEventButton />);
    expect(screen.getByRole("link", { name: /new event/i })).toHaveAttribute(
      "href",
      "/calendar/events/new"
    );
    fireEvent.click(screen.getByRole("button", { name: "Quick event" }));
    expect(openMock).toHaveBeenCalledWith("event");
  });

  test("renders nothing for a viewer without events.create", () => {
    const { container } = render(<NewEventButton canCreate={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
