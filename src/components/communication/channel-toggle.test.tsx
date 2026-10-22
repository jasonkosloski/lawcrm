import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChannelToggle } from "./channel-toggle";

describe("ChannelToggle", () => {
  test("Portal option is hidden by default", () => {
    render(<ChannelToggle basePath="/matters/m1/communication" active="email" />);
    expect(screen.queryByRole("link", { name: /Portal/ })).not.toBeInTheDocument();
  });

  test("Portal option links to ?channel=portal when allowed", () => {
    render(<ChannelToggle basePath="/matters/m1/communication" active="portal" showPortal />);
    const link = screen.getByRole("link", { name: /Portal/ });
    expect(link).toHaveAttribute("href", "/matters/m1/communication?channel=portal");
    expect(link).toHaveAttribute("aria-current", "page");
  });
});
