/**
 * Tests for NotificationBell.
 *
 * The regression worth pinning: linked notification rows used to
 * render a raw `<a href>`, so clicking one triggered a full-document
 * navigation. The unload could abort the in-flight
 * `markNotificationRead` server action fired by the same click —
 * the badge decremented optimistically, then the row came back
 * unread after the reload. Linked rows must render through
 * `next/link` so navigation stays client-side and the mark-read
 * transition survives the route change.
 *
 * The next/link mock below tags its anchor with `data-nextjs-link`;
 * asserting on that marker is what distinguishes "went through
 * next/link" from "reverted to a raw <a>".
 *
 * Also pinned: opening the dropdown re-fetches bell state. The old
 * handleOpen fired that startTransition INSIDE the setOpen updater —
 * updaters run during render and must stay pure, so React threw
 * "Cannot call startTransition while rendering" and its updater
 * re-invocation could loop. The refetch now runs in the event
 * handler proper; every test here that opens the dropdown would
 * hang under the old code.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Anchor stand-in tagged so tests can tell it apart from a raw <a>.
// preventDefault keeps happy-dom from attempting a real navigation.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a
      href={href}
      data-nextjs-link=""
      {...rest}
      onClick={(e) => e.preventDefault()}
    >
      {children}
    </a>
  ),
}));

// Mock the server actions BEFORE importing the component so its
// imports resolve to the mocks.
vi.mock("@/app/actions/notifications", () => ({
  fetchBellState: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

import {
  fetchBellState,
  markNotificationRead,
} from "@/app/actions/notifications";
import { NotificationBell } from "./notification-bell";
import type {
  NotificationRow,
  NotificationsBell,
} from "@/lib/queries/notifications";

const mockedFetch = vi.mocked(fetchBellState);
const mockedMarkOne = vi.mocked(markNotificationRead);

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: "n_1",
  type: "task_assigned",
  title: "You were assigned a task",
  body: null,
  link: "/matters/m_1?tab=tasks",
  matterId: "m_1",
  matterName: "Smith v. Jones",
  isRead: false,
  createdAt: new Date(),
  ...over,
});

const bell = (recent: NotificationRow[]): NotificationsBell => ({
  unreadCount: recent.filter((r) => !r.isRead).length,
  recent,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Fresh object per call — mirrors real server actions, whose
  // return value is deserialized over the wire and never
  // reference-equal across calls.
  mockedFetch.mockImplementation(async () =>
    bell([
      row(),
      row({
        id: "n_2",
        type: "generic",
        title: "Linkless heads-up",
        link: null,
      }),
    ])
  );
  mockedMarkOne.mockResolvedValue({ ok: true });
});

/** Render, wait for the initial fetch, and open the dropdown. */
async function openBell(user: ReturnType<typeof userEvent.setup>) {
  render(<NotificationBell />);
  const trigger = await screen.findByRole("button", {
    name: /notifications \(2 unread\)/i,
  });
  await user.click(trigger);
  // Rows are in once the open-refetch lands.
  await screen.findByText("You were assigned a task");
}

describe("NotificationBell — linked rows navigate client-side", () => {
  test("a linked row renders through next/link, not a raw <a>", async () => {
    const user = userEvent.setup();
    await openBell(user);

    const link = screen
      .getByText("You were assigned a task")
      .closest("a");
    expect(link).toBeTruthy();
    expect(link).toHaveAttribute("href", "/matters/m_1?tab=tasks");
    // The marker only exists on the next/link mock — a raw <a>
    // (full-page navigation, aborts the mark-read action) fails here.
    expect(link).toHaveAttribute("data-nextjs-link");
  });

  test("a row without a link renders no anchor at all", async () => {
    const user = userEvent.setup();
    await openBell(user);

    expect(
      screen.getByText("Linkless heads-up").closest("a")
    ).toBeNull();
  });

  test("opening the dropdown re-fetches bell state (outside the setOpen updater)", async () => {
    const user = userEvent.setup();
    await openBell(user);

    // Once on mount + once on open. Under the old
    // startTransition-inside-updater code this point is never
    // reached — openBell hangs in React's updater re-invocation.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  test("clicking a linked row fires mark-read and closes the popover", async () => {
    const user = userEvent.setup();
    await openBell(user);

    await user.click(screen.getByText("You were assigned a task"));

    // The mark-read server action must have been dispatched — with
    // client navigation it survives; the whole point of the Link fix.
    await waitFor(() => expect(mockedMarkOne).toHaveBeenCalledWith("n_1"));
    // Linked rows close the dropdown so it isn't left floating over
    // the destination page.
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
