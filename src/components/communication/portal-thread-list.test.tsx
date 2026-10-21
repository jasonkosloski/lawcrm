/**
 * PortalThreadList: the firm-wide "Client portal" view rows.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/communication",
  useSearchParams: () => new URLSearchParams(),
}));

import { PortalThreadList } from "./portal-thread-list";

const row = (over: Partial<Parameters<typeof PortalThreadList>[0]["rows"][number]> = {}) => ({
  matterId: "m1",
  matterName: "Smith v. Jones",
  awaitingReply: false,
  unread: 0,
  snippet: "Hello there",
  lastMessageAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
  ...over,
});

const paging = { page: 1, pageCount: 1, total: 1, pageSize: 100 };

describe("PortalThreadList", () => {
  test("row shows matter, snippet, relative time and links to the Portal channel", () => {
    render(<PortalThreadList rows={[row()]} paging={paging} tz="America/Denver" />);
    const link = screen.getByRole("link", { name: /Smith v\. Jones/ });
    expect(link).toHaveAttribute("href", "/matters/m1/communication?channel=portal");
    expect(within(link).getByText("Hello there")).toBeInTheDocument();
    expect(within(link).getByText(/3h|3 h|hour/i)).toBeInTheDocument();
  });

  test("Awaiting reply chip only when awaiting", () => {
    render(
      <PortalThreadList
        rows={[
          row({ matterId: "a", matterName: "Alpha", awaitingReply: true }),
          row({ matterId: "b", matterName: "Beta" }),
        ]}
        paging={{ ...paging, total: 2 }}
      />
    );
    const alpha = screen.getByRole("link", { name: /Alpha/ });
    const beta = screen.getByRole("link", { name: /Beta/ });
    expect(within(alpha).getByText("Awaiting reply")).toBeInTheDocument();
    expect(within(beta).queryByText("Awaiting reply")).toBeNull();
  });

  test("unread badge is announced as 'N unread'", () => {
    render(
      <PortalThreadList rows={[row({ matterName: "Alpha", unread: 4 })]} paging={paging} />
    );
    expect(screen.getByRole("link", { name: /4 unread/ })).toBeInTheDocument();
  });

  test("unread count only when greater than zero", () => {
    render(
      <PortalThreadList
        rows={[
          row({ matterId: "a", matterName: "Alpha", unread: 4 }),
          row({ matterId: "b", matterName: "Beta", unread: 0 }),
        ]}
        paging={{ ...paging, total: 2 }}
      />
    );
    expect(within(screen.getByRole("link", { name: /Alpha/ })).getByText("4")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Beta/ })).queryByText("0")).toBeNull();
  });

  test("empty state", () => {
    render(
      <PortalThreadList
        rows={[]}
        paging={{ page: 1, pageCount: 1, total: 0, pageSize: 100 }}
      />
    );
    expect(screen.getByText("No client portal messages yet.")).toBeInTheDocument();
  });

  test("pager appears with more than one page and keeps view=portal", () => {
    render(
      <PortalThreadList
        rows={[row()]}
        paging={{ page: 1, pageCount: 2, total: 150, pageSize: 100 }}
      />
    );
    const next = screen.getByRole("link", { name: /Older/ });
    expect(next.getAttribute("href")).toContain("view=portal");
    expect(next.getAttribute("href")).toContain("page=2");
  });
});
