/**
 * /communication — a stale or deleted `?thread=` id must not be
 * handed to the list/rail as the "selected" thread. On mobile a
 * selected thread hides the list, so a dead id left the user on a
 * blank reader with no way back (F568).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
  getCurrentUserId: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/google/gmail-sync", () => ({
  maybeKickEmailSync: vi.fn(async () => {}),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => true),
}));
// The page schedules a background sync with after(); no request scope here.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/queries/communication", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/communication")>()),
  getCommunicationCounts: vi.fn(async () => ({ all: 0, unread: 0 })),
  getCommunicationPinnedMatters: vi.fn(async () => []),
  getEmailUnreadCount: vi.fn(async () => 0),
  getFilingMatterOptions: vi.fn(async () => []),
  getThreadById: vi.fn(),
  listThreads: vi.fn(async () => []),
}));
vi.mock("@/lib/queries/messenger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/messenger")>()),
  getMessengerUnreadCount: vi.fn(async () => 0),
  getMessengerMailboxCounts: vi.fn(async () => ({ all: 0, unread: 0 })),
  getMessengerThread: vi.fn(),
  listMessengerThreads: vi.fn(async () => []),
}));
vi.mock("@/lib/queries/contacts", () => ({
  listContactPickerOptions: vi.fn(async () => []),
}));

vi.mock("@/components/layout/topbar", () => ({ TopBar: () => null }));
vi.mock("@/components/communication/communication-tabs", () => ({
  CommunicationTabs: () => null,
}));
vi.mock("@/components/communication/mailbox-drawer", () => ({
  MailboxDrawer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MailboxDrawerProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/communication/sync-now-button", () => ({
  SyncNowButton: () => null,
}));
vi.mock("@/components/communication/log-call-button", () => ({
  LogCallButton: () => null,
}));

type SelProps = { selectedThreadId: string | null };
function sel(id: string) {
  function Stub(p: SelProps) {
    return <div data-testid={id} data-selected={p.selectedThreadId ?? ""} />;
  }
  return Stub;
}
vi.mock("@/components/communication/mailbox-rail", () => ({
  MailboxRail: sel("email-rail"),
}));
vi.mock("@/components/communication/thread-list", () => ({
  ThreadList: sel("email-list"),
}));
vi.mock("@/components/communication/thread-reader", () => ({
  ThreadReader: () => null,
}));
vi.mock("@/components/communication/messenger-mailbox-rail", () => ({
  MessengerMailboxRail: sel("msg-rail"),
}));
vi.mock("@/components/communication/messenger-thread-list", () => ({
  MessengerThreadList: sel("msg-list"),
}));
vi.mock("@/components/communication/messenger-thread-reader", () => ({
  MessengerThreadReader: () => null,
}));

import { getThreadById } from "@/lib/queries/communication";
import { getMessengerThread } from "@/lib/queries/messenger";
import CommunicationPage from "./page";

const props = (sp: Record<string, string>) =>
  ({ searchParams: Promise.resolve(sp) }) as Parameters<
    typeof CommunicationPage
  >[0];

beforeEach(() => {
  vi.mocked(getThreadById).mockReset();
  vi.mocked(getMessengerThread).mockReset();
});

describe("stale ?thread= id", () => {
  test("email view: unresolved thread -> no selection anywhere", async () => {
    vi.mocked(getThreadById).mockResolvedValue(null);
    render(await CommunicationPage(props({ thread: "gone" })));
    expect(screen.getByTestId("email-list").dataset.selected).toBe("");
    expect(screen.getByTestId("email-rail").dataset.selected).toBe("");
  });

  test("email view: a resolved thread is selected", async () => {
    vi.mocked(getThreadById).mockResolvedValue({
      id: "t1",
    } as Awaited<ReturnType<typeof getThreadById>>);
    render(await CommunicationPage(props({ thread: "t1" })));
    expect(screen.getByTestId("email-list").dataset.selected).toBe("t1");
    expect(screen.getByTestId("email-rail").dataset.selected).toBe("t1");
  });

  test("messages view: unresolved thread -> no selection anywhere", async () => {
    vi.mocked(getMessengerThread).mockResolvedValue(null);
    render(
      await CommunicationPage(props({ view: "messages", thread: "gone" }))
    );
    expect(screen.getByTestId("msg-list").dataset.selected).toBe("");
    expect(screen.getByTestId("msg-rail").dataset.selected).toBe("");
  });
});
