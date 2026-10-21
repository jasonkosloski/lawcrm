/**
 * /matters/[id]/communication — single-wave fetch orchestration.
 *
 * The page fires every URL-derived fetch in one Promise.all (the
 * reader is URL-driven, so the whole page re-runs on each thread
 * click — a per-stage waterfall multiplies that latency). That
 * makes two behaviors worth pinning:
 *
 *   1. `getThreadById` now runs eagerly, BEFORE the "is this thread
 *      on this matter?" membership check — so the check moved from
 *      gating the fetch to discarding its result. A regression here
 *      lets a pasted `?thread=` id surface another matter's mail
 *      inside this matter's tab.
 *   2. The contact-picker fetch is chained onto the
 *      `communication.log_call` permission check — no key, no
 *      contact query at all.
 *
 * Plus channel plumbing: each channel only issues its own fetches.
 */

import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ThreadDetail, ThreadListRow } from "@/lib/queries/communication";
import type { ContactPickerOption } from "@/lib/queries/contacts";

// Page auth guard (src/lib/current-user.ts) — session exists here.
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/queries/communication", () => ({
  getFilingMatterOptions: vi.fn(),
  getFilingLeadOptions: vi.fn(async () => []),
  getThreadById: vi.fn(),
  listThreadsForMatter: vi.fn(),
}));
vi.mock("@/lib/queries/messenger", () => ({
  listMessengerItemsForMatter: vi.fn(),
}));
vi.mock("@/lib/queries/contacts", () => ({
  listContactPickerOptions: vi.fn(),
}));
vi.mock("@/lib/queries/portal-messages", () => ({
  getPortalConversation: vi.fn(),
}));
vi.mock("@/components/communication/portal-conversation", () => ({
  PortalConversation: (props: { canSend: boolean; tz: string }) => (
    <div
      data-testid="portal-conversation"
      data-can-send={String(props.canSend)}
      data-tz={props.tz}
    />
  ),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { matter: { findUnique: vi.fn() } },
}));
// The page threads the viewer's TZ into the embedded inbox (message
// timestamps are instants, ADR-012); the real getter pulls in
// `server-only` + Prisma.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));

// Leaf components — the tests only care which props the page hands
// them (selected thread id, log-call button presence), not markup.
vi.mock("@/components/communication/embedded-inbox", () => ({
  EmbeddedInbox: (props: {
    threads: Array<{ id: string }>;
    selectedThread: { id: string } | null;
  }) => (
    <div
      data-testid="embedded-inbox"
      data-selected={props.selectedThread?.id ?? ""}
      data-thread-count={props.threads.length}
    />
  ),
}));
vi.mock("@/components/communication/matter-phone-log", () => ({
  MatterPhoneLog: (props: { tz?: string | null }) => (
    <div data-testid="phone-log" data-tz={props.tz ?? ""} />
  ),
}));
vi.mock("@/components/communication/log-call-button", () => ({
  LogCallButton: () => <div data-testid="log-call-button" />,
}));
vi.mock("@/components/communication/compose-email-launcher", () => ({
  ComposeEmailLauncher: (props: { initialScope?: { kind: string; matterId?: string } }) => (
    <div
      data-testid="compose-launcher"
      data-scope={JSON.stringify(props.initialScope)}
    />
  ),
}));
vi.mock("@/components/communication/channel-toggle", () => ({
  ChannelToggle: (props: { showPortal?: boolean }) => (
    <div data-testid="channel-toggle" data-show-portal={String(!!props.showPortal)} />
  ),
}));

import {
  getFilingMatterOptions,
  getThreadById,
  listThreadsForMatter,
} from "@/lib/queries/communication";
import { listMessengerItemsForMatter } from "@/lib/queries/messenger";
import { getPortalConversation } from "@/lib/queries/portal-messages";
import { listContactPickerOptions } from "@/lib/queries/contacts";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import MatterCommunicationPage from "./page";

const mockedFindMatter = vi.mocked(prisma.matter.findUnique);
const mockedHasPermission = vi.mocked(currentUserHasPermission);
const mockedContacts = vi.mocked(listContactPickerOptions);
const mockedThreads = vi.mocked(listThreadsForMatter);
const mockedFiling = vi.mocked(getFilingMatterOptions);
const mockedThreadById = vi.mocked(getThreadById);
const mockedPhoneItems = vi.mocked(listMessengerItemsForMatter);

const props = (sp: Record<string, string | string[]> = {}, id = "matter_1") =>
  ({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(sp),
  }) as Parameters<typeof MatterCommunicationPage>[0];

const listRow = (id: string) => ({ id }) as ThreadListRow;
const detail = (id: string, matterId: string | null = "matter_1") =>
  ({ id, matter: matterId ? { id: matterId } : null }) as ThreadDetail;
const pageOf = (rows: ThreadListRow[], page = 1, total = rows.length) => ({
  rows,
  page,
  pageCount: Math.max(1, Math.ceil(total / 100)),
  total,
  pageSize: 100,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Baseline: matter exists, permission granted, everything empty.
  // The page selects only { id, name }; cast past the full-payload
  // type the un-`select`ed mock signature expects.
  mockedFindMatter.mockResolvedValue({
    id: "matter_1",
    name: "Smith v. Jones",
  } as Awaited<ReturnType<typeof prisma.matter.findUnique>>);
  mockedHasPermission.mockResolvedValue(true);
  mockedContacts.mockResolvedValue([{ id: "c1" } as ContactPickerOption]);
  mockedThreads.mockResolvedValue(pageOf([]));
  mockedFiling.mockResolvedValue([]);
  mockedThreadById.mockResolvedValue(null);
  mockedPhoneItems.mockResolvedValue([]);
});

describe("thread membership check (eager fetch, discard on miss)", () => {
  test("discards a fetched thread whose id is not on this matter", async () => {
    // Thread t2 exists and is readable by this user (it resolved),
    // but it is filed to some OTHER matter — the reader must stay
    // empty rather than surface it under matter_1.
    mockedThreads.mockResolvedValue(pageOf([listRow("t1")]));
    mockedThreadById.mockResolvedValue(detail("t2", "matter_other"));

    render(await MatterCommunicationPage(props({ thread: "t2" })));

    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("");
  });

  test("passes the fetched thread through when it belongs to the matter", async () => {
    mockedThreads.mockResolvedValue(pageOf([listRow("t1"), listRow("t2")]));
    mockedThreadById.mockResolvedValue(detail("t2"));

    render(await MatterCommunicationPage(props({ thread: "t2" })));

    expect(mockedThreadById).toHaveBeenCalledWith("t2");
    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("t2");
  });

  test("opens a thread on this matter even when it is off the current page", async () => {
    // Page 2 of the list doesn't hold t9, but t9 is filed here.
    mockedThreads.mockResolvedValue(pageOf([listRow("t1")], 2, 150));
    mockedThreadById.mockResolvedValue(detail("t9"));

    render(await MatterCommunicationPage(props({ thread: "t9", page: "2" })));

    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("t9");
  });

  test("discards an unfiled thread", async () => {
    mockedThreadById.mockResolvedValue(detail("t3", null));

    render(await MatterCommunicationPage(props({ thread: "t3" })));

    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("");
  });

  test("skips the thread fetch entirely when no ?thread is requested", async () => {
    render(await MatterCommunicationPage(props()));

    expect(mockedThreadById).not.toHaveBeenCalled();
    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("");
  });
});

describe("log-call gate", () => {
  test("without communication.log_call: no contact fetch, no button", async () => {
    mockedHasPermission.mockResolvedValue(false);

    render(await MatterCommunicationPage(props()));

    expect(mockedContacts).not.toHaveBeenCalled();
    expect(screen.queryByTestId("log-call-button")).not.toBeInTheDocument();
  });

  test("with the key: contacts fetched matter-first, button rendered", async () => {
    render(await MatterCommunicationPage(props()));

    expect(mockedContacts).toHaveBeenCalledWith({ priorityMatterId: "matter_1" });
    expect(screen.getByTestId("log-call-button")).toBeInTheDocument();
  });
});

describe("compose launcher", () => {
  test("email channel mounts Compose prefilled with the matter", async () => {
    render(await MatterCommunicationPage(props()));
    expect(screen.getByTestId("compose-launcher").dataset.scope).toBe(
      JSON.stringify({ kind: "matter", matterId: "matter_1" }),
    );
  });
});

describe("per-channel fetch plumbing", () => {
  test("email channel never issues the phone-log query", async () => {
    render(await MatterCommunicationPage(props()));

    expect(mockedPhoneItems).not.toHaveBeenCalled();
    expect(mockedThreads).toHaveBeenCalledWith("matter_1", 1);
    expect(mockedFiling).toHaveBeenCalled();
  });

  test("?page= reaches the thread query", async () => {
    render(await MatterCommunicationPage(props({ page: "3" })));

    expect(mockedThreads).toHaveBeenCalledWith("matter_1", 3);
  });

  test("phone channel never issues the email queries", async () => {
    render(await MatterCommunicationPage(props({ channel: "phone", thread: "t1" })));

    expect(screen.getByTestId("phone-log")).toBeInTheDocument();
    // Call / SMS / voicemail times are instants: the log must format
    // them in the viewer's profile zone, not the server's.
    expect(screen.getByTestId("phone-log")).toHaveAttribute(
      "data-tz",
      "America/Denver"
    );
    expect(mockedPhoneItems).toHaveBeenCalledWith("matter_1");
    expect(mockedThreads).not.toHaveBeenCalled();
    // Even a pasted ?thread= id fetches nothing on the phone channel.
    expect(mockedThreadById).not.toHaveBeenCalled();
  });

  test("phone channel fetches filing options only for call editors", async () => {
    // Filing options feed the edit dialog's re-file select on the
    // phone channel — chained on communication.edit_call.
    render(await MatterCommunicationPage(props({ channel: "phone" })));
    expect(mockedFiling).toHaveBeenCalled();

    vi.clearAllMocks();
    mockedFindMatter.mockResolvedValue({
      id: "matter_1",
      name: "Smith v. Jones",
    } as Awaited<ReturnType<typeof prisma.matter.findUnique>>);
    mockedPhoneItems.mockResolvedValue([]);
    mockedHasPermission.mockResolvedValue(false);

    render(await MatterCommunicationPage(props({ channel: "phone" })));
    expect(mockedFiling).not.toHaveBeenCalled();
  });
});

describe("portal channel", () => {
  const convo = { messages: [], hasLiveAccess: true, unread: 0 };

  test("loads the conversation only on ?channel=portal and passes send gate and tz", async () => {
    vi.mocked(getPortalConversation).mockResolvedValue(convo);
    mockedHasPermission.mockImplementation(
      async (k: string) => k !== "portal.send_messages"
    );

    render(await MatterCommunicationPage(props({ channel: "portal" })));

    expect(getPortalConversation).toHaveBeenCalledWith("matter_1");
    const el = screen.getByTestId("portal-conversation");
    expect(el.dataset.canSend).toBe("false");
    expect(el.dataset.tz).toBe("America/Denver");
    expect(mockedThreads).not.toHaveBeenCalled();
    expect(mockedPhoneItems).not.toHaveBeenCalled();
  });

  test("email channel never loads the portal conversation", async () => {
    render(await MatterCommunicationPage(props()));
    expect(getPortalConversation).not.toHaveBeenCalled();
    expect(screen.getByTestId("channel-toggle").dataset.showPortal).toBe("true");
  });

  test("without portal.view_messages ?channel=portal falls back to email and hides the option", async () => {
    mockedHasPermission.mockImplementation(
      async (k: string) => k !== "portal.view_messages"
    );

    render(await MatterCommunicationPage(props({ channel: "portal" })));

    expect(getPortalConversation).not.toHaveBeenCalled();
    expect(screen.getByTestId("embedded-inbox")).toBeInTheDocument();
    expect(screen.getByTestId("channel-toggle").dataset.showPortal).toBe("false");
  });
});
