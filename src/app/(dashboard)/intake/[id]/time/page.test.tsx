/**
 * /intake/[id]/time - time_entries.* gating and display.
 *
 * Mirrors the matter Time tab: the composer and per-row menu are shown
 * only to viewers the server would accept (otherwise the action
 * redirects to '/' and the typed input is lost), hours keep
 * quarter-hour precision, and entry dates read as the stored calendar
 * day in any zone.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LeadTimeEntryRow } from "@/lib/queries/lead-time";

// Lead wall (ADR-049) is unit-tested in src/lib/lead-access.test.ts;
// pages are pinned to call it by src/app/page-guards.test.ts.
vi.mock("@/lib/lead-access", () => ({
  assertLeadAccess: vi.fn(async () => "u1"),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/queries/lead-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/lead-time")>();
  return { ...actual, getLeadTimeEntries: vi.fn() };
});
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findUnique: vi.fn() } },
}));
vi.mock("@/components/intake/lead-time-composer", () => ({
  LeadTimeComposer: () => <div data-testid="lead-time-composer" />,
}));
vi.mock("@/components/time-entries/time-entry-row-actions", () => ({
  TimeEntryRowMenu: ({ canEdit, canDelete }: { canEdit?: boolean; canDelete?: boolean }) => (
    <div
      data-testid="time-entry-menu"
      data-can-edit={String(canEdit)}
      data-can-delete={String(canDelete)}
    />
  ),
}));

import { getLeadTimeEntries } from "@/lib/queries/lead-time";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import LeadTimePage from "./page";

const mockedEntries = vi.mocked(getLeadTimeEntries);
const mockedHasPermission = vi.mocked(currentUserHasPermission);
const mockedFindLead = vi.mocked(prisma.lead.findUnique);

const props = (id = "lead_1") =>
  ({ params: Promise.resolve({ id }) }) as Parameters<typeof LeadTimePage>[0];

const row = (over: Partial<LeadTimeEntryRow> = {}): LeadTimeEntryRow => ({
  id: "te_1",
  date: new Date("2026-07-01T00:00:00Z"),
  hours: 0.25,
  activity: "Intake call",
  narrative: null,
  utbmsCode: null,
  billable: true,
  noCharge: false,
  privileged: false,
  source: "manual",
  status: "draft",
  userId: "user_1",
  userName: "Jason Kosloski",
  userInitials: "JK",
  ...over,
});

const grantAllExcept = (...denied: string[]) =>
  mockedHasPermission.mockImplementation(async (key: string) => !denied.includes(key));

const arrange = (entries: LeadTimeEntryRow[] = [], stage = "new") => {
  mockedEntries.mockResolvedValue(entries);
  mockedFindLead.mockResolvedValue({
    stage,
    convertedMatterId: null,
  } as never);
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("LeadTimePage - gates", () => {
  test("composer is hidden without time_entries.create", async () => {
    arrange([row()]);
    grantAllExcept("time_entries.create");
    render(await LeadTimePage(props()));
    expect(screen.queryByTestId("lead-time-composer")).toBeNull();
  });

  test("composer renders with time_entries.create", async () => {
    arrange([row()]);
    grantAllExcept();
    render(await LeadTimePage(props()));
    expect(screen.getByTestId("lead-time-composer")).toBeInTheDocument();
  });

  test("a converted lead never shows the composer, whatever the viewer holds", async () => {
    arrange([], "converted");
    grantAllExcept();
    render(await LeadTimePage(props()));
    expect(screen.queryByTestId("lead-time-composer")).toBeNull();
  });

  test("a non-author without the _any keys gets no edit/delete", async () => {
    arrange([row({ userId: "someone_else" })]);
    grantAllExcept("time_entries.edit_any", "time_entries.delete_any");
    render(await LeadTimePage(props()));
    const menu = screen.getByTestId("time-entry-menu");
    expect(menu).toHaveAttribute("data-can-edit", "false");
    expect(menu).toHaveAttribute("data-can-delete", "false");
  });

  test("the author keeps edit/delete on their own entry", async () => {
    arrange([row()]);
    grantAllExcept("time_entries.edit_any", "time_entries.delete_any");
    render(await LeadTimePage(props()));
    const menu = screen.getByTestId("time-entry-menu");
    expect(menu).toHaveAttribute("data-can-edit", "true");
    expect(menu).toHaveAttribute("data-can-delete", "true");
  });

  test("delete_any alone lets a non-author delete but not edit", async () => {
    arrange([row({ userId: "someone_else" })]);
    grantAllExcept("time_entries.edit_any");
    render(await LeadTimePage(props()));
    const menu = screen.getByTestId("time-entry-menu");
    expect(menu).toHaveAttribute("data-can-edit", "false");
    expect(menu).toHaveAttribute("data-can-delete", "true");
  });
});

describe("LeadTimePage - display", () => {
  test("quarter hours show two decimals; source uses the shared label", async () => {
    arrange([row({ hours: 0.25, source: "calendar" })]);
    grantAllExcept();
    render(await LeadTimePage(props()));
    expect(screen.getAllByText("0.25").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.3")).toBeNull();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
  });

  test("the entry date is the stored calendar day in any zone", async () => {
    arrange([row({ date: new Date("2026-07-01T00:00:00Z") })]);
    grantAllExcept();
    render(await LeadTimePage(props()));
    expect(screen.getByText("Jul 1, 2026")).toBeInTheDocument();
  });

  test("empty state omits 'add an entry above' when the viewer cannot create", async () => {
    arrange([]);
    grantAllExcept("time_entries.create");
    render(await LeadTimePage(props()));
    expect(screen.getByText("No intake time logged yet.")).toBeInTheDocument();
  });
});
