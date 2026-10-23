/**
 * Matter Overview tab — what the page feeds its cards.
 *
 * Pins: live WIP (not the never-written Matter.wipAmount column),
 * calendar-day deadline/task labels ("today", never "0d late"),
 * date-only facts that don't shift a day, the notes section's wiring, the
 * viewer's zone, and the narrow preview queries (no whole-matter
 * loads to render a handful of rows).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    matterContact: { findMany: vi.fn(async () => []) },
    matterStage: { findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => [{ id: "d1", name: "fee.pdf" }]) },
    user: {
      findUnique: vi.fn(async () => ({ firm: { requireOriginatingDoc: true } })),
    },
  },
}));
vi.mock("@/app/actions/billing/helpers", () => ({
  todayDateOnly: vi.fn(async () => new Date("2026-10-20T00:00:00Z")),
}));
vi.mock("@/components/matters/agreement-card", () => ({
  AgreementCard: (p: Record<string, unknown>) => (
    <div data-testid="agreement-card" data-props={JSON.stringify(p)} />
  ),
}));
vi.mock("@/lib/queries/portal-access", () => ({
  getPortalCardData: vi.fn(async () => ({
    rows: [],
    contacts: [],
    portalEnabled: true,
  })),
}));
vi.mock("@/components/matters/portal-card", () => ({
  PortalCard: () => <div data-testid="portal-card" />,
}));
vi.mock("@/lib/queries/document-requests", () => ({
  getDocumentRequestsForMatter: vi.fn(async () => ({ requests: [], hasLiveAccess: true })),
}));
vi.mock("@/components/matters/client-requests-card", () => ({
  ClientRequestsCard: () => <div data-testid="client-requests-card" />,
}));
vi.mock("@/lib/queries/portal-status", () => ({
  getClientStatusCardData: vi.fn(async () => ({ updates: [], hasLiveAccess: true })),
}));
vi.mock("@/components/matters/client-status-card", () => ({
  ClientStatusCard: () => <div data-testid="client-status-card" />,
}));
vi.mock("@/lib/queries/matters", () => ({ getMatterById: vi.fn() }));
vi.mock("@/lib/queries/matter-detail", () => ({
  getMatterDeadlines: vi.fn(async () => []),
  getMatterTasks: vi.fn(async () => []),
  getMatterNotes: vi.fn(async () => []),
  getMatterTimeSummary: vi.fn(async () => ({
    totalHours: 0,
    billableHours: 0,
    unbilledAmount: 0,
    billedAmount: 0,
  })),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/components/matters/stage-changer", () => ({
  StageChanger: () => null,
}));
vi.mock("@/components/matters/statute-of-limitations-card", () => ({
  StatuteOfLimitationsCard: () => null,
}));
vi.mock("@/components/ui/email-link", () => ({ EmailLink: () => null }));
// The notes section reuses the Notes-tab components (their own suites
// cover rendering); here we only check what the page hands them.
vi.mock("@/lib/note-access", () => ({ getNoteAccess: vi.fn() }));
vi.mock("@/components/matters/notes/note-composer", () => ({
  NoteComposer: () => <div data-testid="note-composer" />,
}));
vi.mock("@/components/matters/notes/notes-tab-body", () => ({
  NotesTabBody: vi.fn(() => <div data-testid="notes-body" />),
}));

import { getMatterById } from "@/lib/queries/matters";
import {
  getMatterDeadlines,
  getMatterNotes,
  getMatterTasks,
  getMatterTimeSummary,
} from "@/lib/queries/matter-detail";
import type { DeadlineRow, NoteRow, TaskRow } from "@/lib/queries/matter-detail";
import { getNoteAccess } from "@/lib/note-access";
import { NotesTabBody } from "@/components/matters/notes/notes-tab-body";
import { NO_NOTE_ACCESS } from "@/lib/note-constants";
import MatterOverviewPage from "./page";

const matter = {
  id: "m1",
  name: "Smith v. Jones",
  practiceAreaId: "pa1",
  practiceAreaHasStatuteOfLimitations: false,
  clientId: null,
  court: "D. Colo.",
  caseNumber: "26-cv-1",
  // Date-only values (UTC midnight).
  filedDate: new Date("2026-04-15T00:00:00Z"),
  trialDate: new Date("2027-01-05T00:00:00Z"),
  opposingParty: null,
  opposingFirm: null,
  trustBalance: 1234.5,
  // The never-written column — must NOT be what the page shows.
  wipAmount: 99999,
  description: null,
  teamMembers: [],
} as unknown as NonNullable<Awaited<ReturnType<typeof getMatterById>>>;

const deadline = (over: Partial<DeadlineRow>): DeadlineRow => ({
  id: "d",
  title: "Deadline",
  dueDate: new Date("2026-04-27T00:00:00Z"),
  daysUntil: 0,
  isOverdue: false,
  kind: "manual",
  sourceType: null,
  sourceRef: null,
  description: null,
  status: "open",
  ownerName: null,
  ownerInitials: null,
  spawnedFrom: null,
  attachedNotes: [],
  ...over,
});

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: "t",
  title: "Task",
  description: null,
  priority: "normal",
  status: "open",
  dueDate: null,
  daysUntilDue: null,
  ownerId: null,
  ownerName: null,
  ownerInitials: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  spawnedFrom: null,
  attachedNotes: [],
  ...over,
});

const renderPage = async () =>
  render(
    await MatterOverviewPage({
      params: Promise.resolve({ id: "m1" }),
    } as Parameters<typeof MatterOverviewPage>[0]),
  );

beforeEach(() => {
  vi.mocked(getMatterById).mockResolvedValue(matter);
  vi.mocked(getMatterDeadlines).mockResolvedValue([]);
  vi.mocked(getMatterTasks).mockResolvedValue([]);
  vi.mocked(getMatterNotes).mockResolvedValue([]);
  vi.mocked(getNoteAccess).mockResolvedValue({
    ...NO_NOTE_ACCESS,
    userId: "u1",
    canCreateNote: true,
  });
  vi.mocked(getMatterTimeSummary).mockResolvedValue({
    totalHours: 0,
    billableHours: 0,
    unbilledAmount: 0,
    billedAmount: 0,
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("MatterOverviewPage", () => {
  test("shows the venue with its address in Case facts, and no Venue row without one", async () => {
    vi.mocked(getMatterById).mockResolvedValue({
      ...matter,
      venue: {
        name: "Denver District Court",
        addressLine1: "1437 Bannock St",
        addressLine2: null,
        city: "Denver",
        state: "CO",
        zip: "80202",
      },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getMatterById>>>);
    const caseFacts = () =>
      within(screen.getByText("Case facts").closest<HTMLElement>('[data-slot="card"]')!);
    const { unmount } = await renderPage();
    const venue = caseFacts().getByText("Venue").parentElement!;
    expect(within(venue).getByText("Denver District Court", { exact: false })).toBeTruthy();
    expect(within(venue).getByText("1437 Bannock St")).toBeTruthy();
    expect(within(venue).getByText("Denver, CO 80202")).toBeTruthy();
    unmount();
    vi.mocked(getMatterById).mockResolvedValue(matter);
    await renderPage();
    expect(caseFacts().queryByText("Venue")).toBeNull();
  });

  test("wires the agreement card from the matter load and its area label", async () => {
    vi.mocked(getMatterById).mockResolvedValue({
      ...matter,
      practiceAreaOriginatingDocLabel: "Retainer",
      agreement: {
        status: "signed",
        signedDate: new Date("2026-10-12T00:00:00Z"),
        document: { id: "d1", name: "fee.pdf" },
      },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getMatterById>>>);
    await renderPage();
    const props = JSON.parse(screen.getByTestId("agreement-card").getAttribute("data-props")!);
    expect(props.label).toBe("Retainer");
    expect(props.agreement.signedDate).toBe("2026-10-12");
    expect(props.canEdit).toBe(true);
    expect(props.required).toBe(true);
    expect(props.documents).toEqual([{ id: "d1", name: "fee.pdf" }]);
  });

  test("loads the picker documents only for matters.agreement.edit holders", async () => {
    const { currentUserHasPermission } = await import("@/lib/permission-check");
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.agreement.edit",
    );
    vi.mocked(prisma.document.findMany).mockClear();
    await renderPage();
    expect(prisma.document.findMany).not.toHaveBeenCalled();
    vi.mocked(currentUserHasPermission).mockImplementation(async () => true);
  });

  test("renders the Portal card only for portal.view holders, and skips the loader otherwise", async () => {
    const { currentUserHasPermission } = await import("@/lib/permission-check");
    const { getPortalCardData } = await import("@/lib/queries/portal-access");
    await renderPage();
    expect(screen.getByTestId("portal-card")).toBeTruthy();
    expect(screen.getByTestId("client-requests-card")).toBeTruthy();
    expect(screen.getByTestId("client-status-card")).toBeTruthy();

    vi.mocked(getPortalCardData).mockClear();
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "portal.view",
    );
    document.body.innerHTML = "";
    await renderPage();
    expect(screen.queryByTestId("portal-card")).toBeNull();
    expect(screen.queryByTestId("client-requests-card")).toBeNull();
    expect(screen.queryByTestId("client-status-card")).toBeNull();
    expect(getPortalCardData).not.toHaveBeenCalled();
    vi.mocked(currentUserHasPermission).mockImplementation(async () => true);
  });

  test("WIP is the live unbilled figure, in dollars and cents", async () => {
    vi.mocked(getMatterTimeSummary).mockResolvedValue({
      totalHours: 10,
      billableHours: 10,
      unbilledAmount: 12000.5,
      billedAmount: 0,
    });
    await renderPage();
    expect(screen.getByText("$12,000.50")).toBeTruthy();
    expect(screen.queryByText(/99,999/)).toBeNull();
    // Trust balance keeps its cents too (was "$1,234.5").
    expect(screen.getByText("$1,234.50")).toBeTruthy();
  });

  test("date-only facts show the stored calendar day", async () => {
    await renderPage();
    expect(screen.getByText("Apr 15, 2026")).toBeTruthy();
    expect(screen.getByText("Jan 5, 2027")).toBeTruthy();
  });

  test("deadlines due today read 'today', not '0d late'; overdue and future keep their counts", async () => {
    vi.mocked(getMatterDeadlines).mockResolvedValue([
      deadline({ id: "a", title: "Due today", daysUntil: 0 }),
      deadline({ id: "b", title: "Missed", daysUntil: -2, isOverdue: true }),
      deadline({ id: "c", title: "Later", daysUntil: 5 }),
    ]);
    await renderPage();
    expect(screen.getByText("today")).toBeTruthy();
    expect(screen.getByText("2d late")).toBeTruthy();
    expect(screen.getByText("5d")).toBeTruthy();
    expect(screen.queryByText("0d late")).toBeNull();
  });

  test("tasks due today read 'today'; far-off tasks show a short date", async () => {
    vi.mocked(getMatterTasks).mockResolvedValue([
      task({
        id: "a",
        title: "Due today",
        dueDate: new Date("2026-04-27T00:00:00Z"),
        daysUntilDue: 0,
      }),
      task({
        id: "b",
        title: "Far off",
        dueDate: new Date("2026-06-15T00:00:00Z"),
        daysUntilDue: 49,
      }),
    ]);
    await renderPage();
    expect(screen.getByText("today")).toBeTruthy();
    // Date-only: Jun 15 in every zone (a local formatter west of UTC
    // would print Jun 14).
    expect(screen.getByText("Jun 15")).toBeTruthy();
  });

  test("shows the full notes list (same as the Notes tab) with the viewer's access", async () => {
    const notes = [
      { id: "n1", isPinned: true, content: "<p>Pinned</p>" },
      { id: "n2", isPinned: false, content: "<p>Regular</p>" },
    ] as unknown as NoteRow[];
    vi.mocked(getMatterNotes).mockResolvedValue(notes);
    await renderPage();
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.getByTestId("notes-body")).toBeTruthy();
    const props = vi.mocked(NotesTabBody).mock.calls.at(-1)![0];
    expect(props.notes).toBe(notes);
    expect(props.scope).toEqual({ kind: "matter", matterId: "m1" });
    expect(props.access).toMatchObject({ userId: "u1", canCreateNote: true });
  });

  test("the composer shows only for viewers who can write notes", async () => {
    await renderPage();
    expect(screen.getByTestId("note-composer")).toBeTruthy();

    vi.mocked(getNoteAccess).mockResolvedValue({ ...NO_NOTE_ACCESS, userId: "u1" });
    document.body.innerHTML = "";
    await renderPage();
    expect(screen.queryByTestId("note-composer")).toBeNull();
    expect(screen.getByTestId("notes-body")).toBeTruthy();
  });

  test("loads only what the cards render (open + limited previews; every note)", async () => {
    await renderPage();
    expect(getMatterDeadlines).toHaveBeenCalledWith("m1", {
      tz: "America/Denver",
      openOnly: true,
      limit: 4,
    });
    expect(getMatterTasks).toHaveBeenCalledWith("m1", {
      tz: "America/Denver",
      openOnly: true,
      limit: 5,
    });
    expect(getMatterNotes).toHaveBeenCalledWith("m1");
  });

  test("a missing matter 404s", async () => {
    vi.mocked(getMatterById).mockResolvedValue(null as never);
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
