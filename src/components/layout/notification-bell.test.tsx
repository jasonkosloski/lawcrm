/**
 * Tests for NotificationBell + NotificationBellProvider.
 *
 * Regressions pinned:
 *   - linked rows render through `next/link` (a raw `<a>` caused a
 *     full-document navigation that could abort the in-flight
 *     `markNotificationRead` action)
 *   - opening the dropdown re-fetches, outside the setOpen updater
 *   - a mark-read that races an in-flight fetch isn't overwritten by
 *     the stale (pre-mark) response
 *   - a rejected / `{ ok: false }` mark-read shows an inline error and
 *     never throws into an error boundary
 *   - the bell state lives in the provider, so remounting the bell (a
 *     navigation to a page with its own TopBar) doesn't refetch
 *   - hidden tabs don't poll; becoming visible fetches immediately
 *   - a11y: labelled dialog (not `menu`), aria-expanded, linkless
 *     unread rows are focusable buttons, unread is announced
 *
 * Reads go through `fetch("/api/notifications/bell")` (stubbed), not a
 * Server Action; mutations are the mocked server actions.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Anchor stand-in tagged so tests can tell it apart from a raw <a>.
// preventDefault keeps happy-dom from attempting a real navigation;
// the caller's own onClick (e.g. the footer's close-popover handler)
// still runs first, like the real next/link.
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: React.ComponentProps<"a"> & { href: string }) => (
    <a
      href={href}
      data-nextjs-link=""
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

// Mock the server actions BEFORE importing the component so its
// imports resolve to the mocks.
vi.mock("@/app/actions/notifications", () => ({
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

import { markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications";
import { NotificationBell } from "./notification-bell";
import { BELL_MUTATION_ERROR, NotificationBellProvider } from "./notification-bell-provider";

const mockedMarkOne = vi.mocked(markNotificationRead);
const mockedMarkAll = vi.mocked(markAllNotificationsRead);

type WireRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  matterId: string | null;
  matterName: string | null;
  isRead: boolean;
  createdAt: string;
};

const row = (over: Partial<WireRow> = {}): WireRow => ({
  id: "n_1",
  type: "task_assigned",
  title: "You were assigned a task",
  body: null,
  link: "/matters/m_1?tab=tasks",
  matterId: "m_1",
  matterName: "Smith v. Jones",
  isRead: false,
  createdAt: new Date().toISOString(),
  ...over,
});

const bellJson = (recent: WireRow[]) => ({
  unreadCount: recent.filter((r) => !r.isRead).length,
  recent,
});

const defaultRows = () => [
  row(),
  row({ id: "n_2", type: "generic", title: "Linkless heads-up", link: null }),
];

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

const fetchMock = vi.fn();

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setVisibility("visible");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockReset();
  // Fresh object per call, like a real network response.
  fetchMock.mockImplementation(async () => jsonResponse(bellJson(defaultRows())));
  vi.stubGlobal("fetch", fetchMock);
  mockedMarkOne.mockResolvedValue({ ok: true });
  mockedMarkAll.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderBell = () =>
  render(
    <NotificationBellProvider>
      <NotificationBell />
    </NotificationBellProvider>,
  );

/** Render, wait for the initial fetch, and open the dropdown. */
async function openBell(user: ReturnType<typeof userEvent.setup>) {
  renderBell();
  const trigger = await screen.findByRole("button", {
    name: /notifications \(2 unread\)/i,
  });
  await user.click(trigger);
  await screen.findByText("You were assigned a task");
}

describe("NotificationBell — linked rows navigate client-side", () => {
  test("a linked row renders through next/link, not a raw <a>", async () => {
    const user = userEvent.setup();
    await openBell(user);

    const link = screen.getByText("You were assigned a task").closest("a");
    expect(link).toBeTruthy();
    expect(link).toHaveAttribute("href", "/matters/m_1?tab=tasks");
    expect(link).toHaveAttribute("data-nextjs-link");
  });

  test("a read, linkless row renders no anchor and no button", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        bellJson([
          row({ id: "n_1", isRead: false }),
          row({
            id: "n_3",
            title: "Old news",
            link: null,
            isRead: true,
          }),
        ]),
      ),
    );
    const user = userEvent.setup();
    renderBell();
    await user.click(await screen.findByRole("button", { name: /notifications \(1 unread\)/i }));
    const old = await screen.findByText("Old news");
    expect(old.closest("a")).toBeNull();
    expect(old.closest("button")).toBeNull();
  });

  test("opening the dropdown re-fetches bell state (outside the setOpen updater)", async () => {
    const user = userEvent.setup();
    await openBell(user);
    // Once on mount + once on open.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  test("clicking a linked row fires mark-read and closes the popover", async () => {
    const user = userEvent.setup();
    await openBell(user);

    await user.click(screen.getByText("You were assigned a task"));

    await waitFor(() => expect(mockedMarkOne).toHaveBeenCalledWith("n_1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("NotificationBell — feed page footer", () => {
  test("dropdown footer links to /notifications through next/link and closes on click", async () => {
    const user = userEvent.setup();
    await openBell(user);

    const viewAll = screen.getByText(/view all notifications/i);
    const anchor = viewAll.closest("a");
    expect(anchor).toHaveAttribute("href", "/notifications");
    expect(anchor).toHaveAttribute("data-nextjs-link");

    await user.click(viewAll);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("footer renders even when the feed is empty (it's the discovery path)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(bellJson([])));
    const user = userEvent.setup();
    renderBell();
    await user.click(await screen.findByRole("button", { name: /^notifications$/i }));
    await screen.findByText(/no notifications yet/i);
    expect(screen.getByText(/view all notifications/i)).toBeInTheDocument();
  });
});

describe("NotificationBell — accessibility", () => {
  test("popover is a labelled dialog, not a menu; trigger reports expanded", async () => {
    const user = userEvent.setup();
    renderBell();
    const trigger = await screen.findByRole("button", {
      name: /notifications \(2 unread\)/i,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    await screen.findByText("You were assigned a task");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Notifications" });
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
  });

  test("a linkless unread row is a focusable button that marks it read, and unread is announced", async () => {
    const user = userEvent.setup();
    await openBell(user);

    const button = screen.getByText("Linkless heads-up").closest("button");
    expect(button).not.toBeNull();
    expect(screen.getAllByText("Unread").length).toBeGreaterThan(0);

    await user.click(button!);
    await waitFor(() => expect(mockedMarkOne).toHaveBeenCalledWith("n_2"));
  });

  test("Escape closes the popover and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    await openBell(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /notifications/i })).toHaveFocus();
  });
});

describe("NotificationBellProvider — fetch races and failures", () => {
  test("Mark all read isn't overwritten by a fetch that was already in flight", async () => {
    // First fetch (mount) resolves normally; the open-refetch is held
    // open so we can click Mark all while it is pending, then let it
    // resolve with the STALE pre-mark data.
    let releaseStale: (r: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce(async () => jsonResponse(bellJson(defaultRows())))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseStale = resolve;
          }),
      )
      // The post-mutation reconcile fetch sees the server truth.
      .mockImplementation(async () =>
        jsonResponse(bellJson(defaultRows().map((r) => ({ ...r, isRead: true })))),
      );

    const user = userEvent.setup();
    renderBell();
    const trigger = await screen.findByRole("button", {
      name: /notifications \(2 unread\)/i,
    });
    await user.click(trigger); // starts the held refetch
    await user.click(await screen.findByText("Mark all read"));

    // Stale response lands AFTER the optimistic clear.
    await act(async () => {
      releaseStale(jsonResponse(bellJson(defaultRows())));
    });

    await waitFor(() => expect(mockedMarkAll).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /\(2 unread\)/i })).toBeNull();
    expect(screen.queryByText(/2 unread/)).toBeNull();
  });

  test("a rejected mark-read shows an inline error instead of throwing, then reconciles", async () => {
    mockedMarkOne.mockRejectedValue(new Error("Server Action not found"));
    const user = userEvent.setup();
    await openBell(user);

    await user.click(screen.getByText("You were assigned a task"));

    // Linked row closed the popover; reopen to see the error.
    const trigger = await screen.findByRole("button", {
      name: /notifications/i,
    });
    await user.click(trigger);
    expect(await screen.findByRole("alert")).toHaveTextContent(BELL_MUTATION_ERROR);
    // Reconcile refetch rolled the optimistic decrement back.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /notifications \(2 unread\)/i }),
      ).toBeInTheDocument(),
    );
  });

  test("an { ok: false } result is treated as a failure too", async () => {
    mockedMarkAll.mockResolvedValue({ ok: false });
    const user = userEvent.setup();
    await openBell(user);
    await user.click(screen.getByText("Mark all read"));
    expect(await screen.findByRole("alert")).toHaveTextContent(BELL_MUTATION_ERROR);
  });

  test("a failed poll is swallowed (non-blocking)", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderBell();
    expect(await screen.findByRole("button", { name: /^notifications$/i })).toBeInTheDocument();
  });
});

describe("NotificationBellProvider — lives above the page", () => {
  test("remounting the bell (page navigation) neither refetches nor blinks the badge", async () => {
    function Harness({ page }: { page: number }) {
      // Each page renders its own TopBar -> its own bell instance.
      return (
        <NotificationBellProvider>
          <div key={page}>
            <NotificationBell />
          </div>
        </NotificationBellProvider>
      );
    }
    const { rerender } = render(<Harness page={1} />);
    await screen.findByRole("button", { name: /notifications \(2 unread\)/i });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<Harness page={2} />);
    // Badge is there immediately (no null-state flash) and no new fetch.
    expect(screen.getByRole("button", { name: /notifications \(2 unread\)/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a hidden tab doesn't fetch on mount; becoming visible fetches immediately", async () => {
    setVisibility("hidden");
    renderBell();
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: /notifications \(2 unread\)/i }),
    ).toBeInTheDocument();
  });

  test("the poll skips ticks while hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderBell();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      setVisibility("hidden");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      setVisibility("visible");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
