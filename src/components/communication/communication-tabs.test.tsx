/**
 * CommunicationTabs: the active tab is exposed to assistive tech with
 * aria-current, and switching view drops the per-view `thread` param.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/communication",
  useSearchParams: () => new URLSearchParams("view=email&thread=t1&filter=sent"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CommunicationTabs } from "./communication-tabs";

describe("CommunicationTabs", () => {
  test("only the active tab carries aria-current", () => {
    render(<CommunicationTabs view="email" emailUnread={2} messengerUnread={0} />);
    expect(screen.getByRole("link", { name: /Email/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Messages/ })).not.toHaveAttribute("aria-current");
  });

  test("switching view keeps other params but releases the selected thread", () => {
    render(<CommunicationTabs view="email" emailUnread={0} messengerUnread={0} />);
    const href = screen.getByRole("link", { name: /Messages/ }).getAttribute("href")!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("view")).toBe("messages");
    expect(params.get("filter")).toBe("sent");
    expect(params.has("thread")).toBe(false);
  });

  test("Client portal tab only with showPortal, and it links view=portal", () => {
    const { rerender } = render(
      <CommunicationTabs view="email" emailUnread={0} messengerUnread={0} />,
    );
    expect(screen.queryByRole("link", { name: /Client portal/ })).toBeNull();
    rerender(<CommunicationTabs view="portal" emailUnread={0} messengerUnread={0} showPortal />);
    const link = screen.getByRole("link", { name: /Client portal/ });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(new URLSearchParams(link.getAttribute("href")!.split("?")[1]).get("view")).toBe(
      "portal",
    );
  });
});
