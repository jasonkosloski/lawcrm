/**
 * Tests for NotificationsFeed.
 *
 * Pins:
 *   - timestamps render in the viewer's PROFILE zone (prop `tz`), not
 *     the runtime's — the old zone-less formatDate rendered the
 *     server's UTC day on SSR and the browser's day after hydration;
 *   - link-less rows are real buttons (keyboard / screen reader can
 *     mark them read) while linked rows keep going through next/link;
 *   - a failed mark-read rolls the optimistic update back and shows a
 *     message instead of throwing into the error boundary;
 *   - "Mark all read" sends the server-supplied cutoff.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/app/actions/notifications", () => ({
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/actions/notifications";
import { NotificationsFeed } from "./notifications-feed";
import type { NotificationRow } from "@/lib/queries/notifications";

const mockedMarkOne = vi.mocked(markNotificationRead);
const mockedMarkAll = vi.mocked(markAllNotificationsRead);

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: "n_1",
  type: "generic",
  title: "Heads up",
  body: null,
  link: null,
  matterId: null,
  matterName: null,
  isRead: false,
  createdAt: new Date("2026-08-01T03:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedMarkOne.mockResolvedValue({ ok: true });
  mockedMarkAll.mockResolvedValue({ ok: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("NotificationsFeed — time zone", () => {
  test("the timestamp title uses the viewer's zone, not the runtime's", () => {
    // 03:00Z on Aug 1 is still Jul 31 evening in Denver, but Aug 1 in
    // UTC and Tokyo.
    const { rerender } = render(
      <NotificationsFeed
        initialRows={[row()]}
        initialUnreadCount={1}
        tz="America/Denver"
      />
    );
    expect(screen.getByTitle("Jul 31, 2026")).toBeInTheDocument();

    rerender(
      <NotificationsFeed
        initialRows={[row()]}
        initialUnreadCount={1}
        tz="Asia/Tokyo"
      />
    );
    expect(screen.getByTitle("Aug 1, 2026")).toBeInTheDocument();
  });
});

describe("NotificationsFeed — link-less rows are operable", () => {
  test("a link-less unread row is a button that marks it read", async () => {
    const user = userEvent.setup();
    render(
      <NotificationsFeed
        initialRows={[row({ title: "Plain notice" })]}
        initialUnreadCount={1}
        tz="UTC"
      />
    );

    const button = screen.getByRole("button", {
      name: /plain notice/i,
    });
    button.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(mockedMarkOne).toHaveBeenCalledWith("n_1"));
    expect(mockedMarkOne).toHaveBeenCalledTimes(1);
    expect(screen.getByText("All caught up")).toBeInTheDocument();
  });

  test("a linked row stays a link and still marks read on click", async () => {
    const user = userEvent.setup();
    render(
      <NotificationsFeed
        initialRows={[row({ link: "/matters/m_1", title: "Linked" })]}
        initialUnreadCount={1}
        tz="UTC"
      />
    );

    await user.click(screen.getByText("Linked"));
    await waitFor(() => expect(mockedMarkOne).toHaveBeenCalledWith("n_1"));
    expect(mockedMarkOne).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Linked").closest("a")).toHaveAttribute(
      "href",
      "/matters/m_1"
    );
  });
});

describe("NotificationsFeed — failures roll back", () => {
  test("a rejected mark-read restores the row and the counter, with a message", async () => {
    mockedMarkOne.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(
      <NotificationsFeed
        initialRows={[row({ title: "Plain notice" })]}
        initialUnreadCount={1}
        tz="UTC"
      />
    );

    await user.click(
      screen.getByRole("button", { name: /plain notice/i })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn.t update/i
    );
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    // Row is actionable again.
    expect(
      screen.getByRole("button", { name: /plain notice/i })
    ).toBeEnabled();
  });

  test("Mark all read sends the server cutoff and rolls back when refused", async () => {
    mockedMarkAll.mockResolvedValue({ ok: false });
    const asOf = new Date("2026-10-16T10:00:00Z");
    const user = userEvent.setup();
    render(
      <NotificationsFeed
        initialRows={[
          row({ id: "a", title: "A" }),
          row({ id: "b", title: "B", isRead: true }),
        ]}
        initialUnreadCount={1}
        tz="UTC"
        asOf={asOf}
      />
    );

    await user.click(screen.getByRole("button", { name: /mark all read/i }));

    await waitFor(() => expect(mockedMarkAll).toHaveBeenCalledWith(asOf));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("1 unread")).toBeInTheDocument();
  });
});
