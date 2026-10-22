/**
 * /intake/[id]/communication — the email half lists threads FILED to
 * the lead (listThreadsForLead), whether or not the contact has an
 * email address, and only opens a `?thread=` that is filed to this
 * lead (the thread fetch is eager; the membership check discards it).
 */

import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ThreadDetail, ThreadListRow } from "@/lib/queries/communication";

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/lead-access", () => ({
  assertLeadAccess: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/queries/communication", () => ({
  getFilingMatterOptions: vi.fn(async () => []),
  getFilingLeadOptions: vi.fn(async () => []),
  getThreadById: vi.fn(),
  listThreadsForLead: vi.fn(),
}));
vi.mock("@/lib/queries/messenger", () => ({
  listMessengerThreadsForLead: vi.fn(async () => []),
}));
vi.mock("@/lib/queries/leads", () => ({ getLeadById: vi.fn() }));
vi.mock("@/lib/queries/contacts", () => ({
  listContactPickerOptions: vi.fn(async () => []),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => false),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/components/communication/embedded-inbox", () => ({
  EmbeddedInbox: (props: {
    threads: Array<{ id: string }>;
    selectedThread: { id: string } | null;
    emptyLabel: string;
  }) => (
    <div
      data-testid="embedded-inbox"
      data-selected={props.selectedThread?.id ?? ""}
      data-thread-count={props.threads.length}
      data-empty-label={props.emptyLabel}
    />
  ),
}));
vi.mock("@/components/communication/log-call-button", () => ({
  LogCallButton: () => <div data-testid="log-call-button" />,
}));
vi.mock("@/components/communication/compose-email-launcher", () => ({
  ComposeEmailLauncher: (props: { initialScope?: unknown }) => (
    <div data-testid="compose-launcher" data-scope={JSON.stringify(props.initialScope)} />
  ),
}));

import { getLeadById } from "@/lib/queries/leads";
import { getThreadById, listThreadsForLead } from "@/lib/queries/communication";
import LeadCommunicationPage from "./page";

const mockedLead = vi.mocked(getLeadById);
const mockedList = vi.mocked(listThreadsForLead);
const mockedThreadById = vi.mocked(getThreadById);

const props = (sp: Record<string, string | string[]> = {}) =>
  ({
    params: Promise.resolve({ id: "lead_1" }),
    searchParams: Promise.resolve(sp),
  }) as Parameters<typeof LeadCommunicationPage>[0];

const pageOf = (ids: string[], page = 1) => ({
  rows: ids.map((id) => ({ id }) as ThreadListRow),
  page,
  pageCount: 1,
  total: ids.length,
  pageSize: 100,
});
const detail = (id: string, leadId: string | null) =>
  ({ id, lead: leadId ? { id: leadId, name: "L" } : null }) as ThreadDetail;

beforeEach(() => {
  vi.clearAllMocks();
  // No email, no phone: the email section must still render.
  mockedLead.mockResolvedValue({
    id: "lead_1",
    stage: "new",
    displayEmail: null,
    displayPhone: null,
    contact: null,
  } as unknown as Awaited<ReturnType<typeof getLeadById>>);
  mockedList.mockResolvedValue(pageOf([]));
  mockedThreadById.mockResolvedValue(null);
});

describe("lead communication tab email list", () => {
  test("lists threads filed to the lead even with no contact email", async () => {
    mockedList.mockResolvedValue(pageOf(["t1", "t2"]));

    render(await LeadCommunicationPage(props({ page: "2" })));

    expect(mockedList).toHaveBeenCalledWith("lead_1", 2);
    const inbox = screen.getByTestId("embedded-inbox");
    expect(inbox.dataset.threadCount).toBe("2");
    expect(inbox.dataset.emptyLabel).toBe("No emails filed to this lead yet");
    expect(screen.getByTestId("compose-launcher").dataset.scope).toBe(
      JSON.stringify({ kind: "lead", leadId: "lead_1" }),
    );
  });

  test("opens a thread filed to this lead", async () => {
    mockedList.mockResolvedValue(pageOf(["t1"]));
    mockedThreadById.mockResolvedValue(detail("t9", "lead_1"));

    render(await LeadCommunicationPage(props({ thread: "t9" })));

    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("t9");
  });

  test("discards a thread filed elsewhere or unfiled", async () => {
    mockedThreadById.mockResolvedValue(detail("t2", "lead_other"));
    render(await LeadCommunicationPage(props({ thread: "t2" })));
    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("");
  });

  test("discards an unfiled thread", async () => {
    mockedThreadById.mockResolvedValue(detail("t3", null));
    render(await LeadCommunicationPage(props({ thread: "t3" })));
    expect(screen.getByTestId("embedded-inbox").dataset.selected).toBe("");
  });

  test("hides compose for a converted lead", async () => {
    mockedLead.mockResolvedValue({
      id: "lead_1",
      stage: "converted",
      displayEmail: null,
      displayPhone: null,
      contact: null,
    } as unknown as Awaited<ReturnType<typeof getLeadById>>);

    render(await LeadCommunicationPage(props()));

    expect(screen.queryByTestId("compose-launcher")).not.toBeInTheDocument();
  });
});
