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

vi.mock("@/lib/queries/communication", () => ({
  getFilingMatterOptions: vi.fn(),
  getThreadById: vi.fn(),
  listThreadsForMatter: vi.fn(),
}));
vi.mock("@/lib/queries/messenger", () => ({
  listMessengerItemsForMatter: vi.fn(),
}));
vi.mock("@/lib/queries/contacts", () => ({
  listContactPickerOptions: vi.fn(),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { matter: { findUnique: vi.fn() } },
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
  MatterPhoneLog: () => <div data-testid="phone-log" />,
}));
vi.mock("@/components/communication/log-call-button", () => ({
  LogCallButton: () => <div data-testid="log-call-button" />,
}));
vi.mock("@/components/communication/channel-toggle", () => ({
  ChannelToggle: () => <div data-testid="channel-toggle" />,
}));

import {
  getFilingMatterOptions,
  getThreadById,
  listThreadsForMatter,
} from "@/lib/queries/communication";
import { listMessengerItemsForMatter } from "@/lib/queries/messenger";
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
const detail = (id: string) => ({ id }) as ThreadDetail;

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
  mockedThreads.mockResolvedValue([]);
  mockedFiling.mockResolvedValue([]);
  mockedThreadById.mockResolvedValue(null);
  mockedPhoneItems.mockResolvedValue([]);
});

describe("thread membership check (eager fetch, discard on miss)", () => {
  test("discards a fetched thread whose id is not on this matter", async () => {
    // Thread t2 exists and is readable by this user (it resolved),
    // but it is filed to some OTHER matter — the reader must stay
    // empty rather than surface it under matter_1.
    mockedThreads.mockResolvedValue([listRow("t1")]);
    mockedThreadById.mockResolvedValue(detail("t2"));

    render(await MatterCommunicationPage(props({ thread: "t2" })));

    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("");
  });

  test("passes the fetched thread through when it belongs to the matter", async () => {
    mockedThreads.mockResolvedValue([listRow("t1"), listRow("t2")]);
    mockedThreadById.mockResolvedValue(detail("t2"));

    render(await MatterCommunicationPage(props({ thread: "t2" })));

    expect(mockedThreadById).toHaveBeenCalledWith("t2");
    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("t2");
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

describe("per-channel fetch plumbing", () => {
  test("email channel never issues the phone-log query", async () => {
    render(await MatterCommunicationPage(props()));

    expect(mockedPhoneItems).not.toHaveBeenCalled();
    expect(mockedThreads).toHaveBeenCalledWith("matter_1");
    expect(mockedFiling).toHaveBeenCalled();
  });

  test("phone channel never issues the email queries", async () => {
    render(await MatterCommunicationPage(props({ channel: "phone", thread: "t1" })));

    expect(screen.getByTestId("phone-log")).toBeInTheDocument();
    expect(mockedPhoneItems).toHaveBeenCalledWith("matter_1");
    expect(mockedThreads).not.toHaveBeenCalled();
    expect(mockedFiling).not.toHaveBeenCalled();
    // Even a pasted ?thread= id fetches nothing on the phone channel.
    expect(mockedThreadById).not.toHaveBeenCalled();
  });
});
