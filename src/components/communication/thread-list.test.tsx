/**
 * ThreadList (server component, no hooks - rendered directly) tests:
 * row hrefs must preserve the active filter (All mail used to reset
 * to Inbox on click), the header count must not lie past the query
 * cap, and the follow-up chip compares calendar DAYS in the viewer's
 * zone (not an instant against Date.now()).
 *
 * Client/async children are stubbed; they have their own tests.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./mailbox-drawer", () => ({ MailboxDrawerTrigger: () => null }));
vi.mock("./compose-email-launcher", () => ({ ComposeEmailLauncher: () => null }));
vi.mock("./thread-row-actions", () => ({ ThreadRowActions: () => null }));
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

import type { ThreadListRow } from "@/lib/queries/communication";
import { rowHref, ThreadList, THREAD_LIST_CAP } from "./thread-list";

function row(over: Partial<ThreadListRow> = {}): ThreadListRow {
  return {
    id: "t1",
    subject: "Discovery",
    snippet: "snip",
    isRead: true,
    isStarred: false,
    isArchived: false,
    hasAttachments: false,
    messageCount: 1,
    lastMessageAt: new Date("2026-04-01T10:00:00Z"),
    followUpAt: null,
    fromDisplay: "Alice",
    matter: null,
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("rowHref", () => {
  test("All mail keeps ?filter=all (the page default is inbox)", () => {
    expect(rowHref("t1", "all", null)).toBe("/communication?filter=all&thread=t1");
  });

  test("Inbox omits the filter (it is the default)", () => {
    expect(rowHref("t1", "inbox", null)).toBe("/communication?thread=t1");
  });

  test.each(["unread", "starred", "archived", "unfiled", "filed", "untimed"] as const)(
    "%s is preserved",
    (filter) => {
      expect(rowHref("t1", filter, null)).toBe(
        `/communication?filter=${filter}&thread=t1`
      );
    }
  );

  test("matter drill-down is preserved alongside the filter", () => {
    expect(rowHref("t1", "all", "m1")).toBe(
      "/communication?filter=all&matter=m1&thread=t1"
    );
  });

  test("rendered rows link with the active filter", () => {
    render(
      <ThreadList
        threads={[row({ id: "a" }), row({ id: "b" })]}
        filter="all"
        selectedThreadId={null}
      />
    );
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/communication?filter=all&thread=a",
      "/communication?filter=all&thread=b",
    ]);
  });
});

describe("header count", () => {
  test("exact below the cap", () => {
    render(
      <ThreadList threads={[row(), row({ id: "t2" })]} filter="inbox" selectedThreadId={null} />
    );
    expect(screen.getByText("2 threads")).toBeInTheDocument();
  });

  test("shows N+ at the query cap (the list is truncated)", () => {
    const many = Array.from({ length: THREAD_LIST_CAP }, (_, i) =>
      row({ id: `t${i}` })
    );
    render(<ThreadList threads={many} filter="all" selectedThreadId={null} />);
    expect(screen.getByText(`${THREAD_LIST_CAP}+ threads`)).toBeInTheDocument();
  });
});

describe("follow-up chip", () => {
  // 2026-04-28T02:00Z = Apr 27, 8 PM in Denver.
  const setNow = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
  };
  const chip = (followUpAt: Date) => {
    render(
      <ThreadList
        threads={[row({ followUpAt })]}
        filter="inbox"
        selectedThreadId={null}
        tz="America/Denver"
      />
    );
    return screen.getByTitle(/Follow up by/);
  };

  test("due today (evening in Denver) is not overdue", () => {
    setNow();
    const el = chip(new Date(Date.UTC(2026, 3, 27, 23, 59, 59, 999)));
    expect(el).toHaveTextContent("Apr 27");
    expect(el.className).toContain("text-brand-700");
    expect(el.className).not.toContain("text-warn");
  });

  test("due yesterday is overdue (warn) but not yet Late", () => {
    setNow();
    const el = chip(new Date(Date.UTC(2026, 3, 26, 23, 59, 59, 999)));
    expect(el.className).toContain("text-warn");
    expect(el).toHaveTextContent("Apr 26");
  });

  test("two days behind reads Late", () => {
    setNow();
    const el = chip(new Date(Date.UTC(2026, 3, 25, 23, 59, 59, 999)));
    expect(el.className).toContain("text-warn");
    expect(el).toHaveTextContent("Late");
  });
});
