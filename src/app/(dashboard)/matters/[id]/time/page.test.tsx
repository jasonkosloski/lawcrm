/**
 * /matters/[id]/time — permission gates on the expense section and
 * the time-entry UI.
 *
 * This page is the enforcement point for `matters.expense.view`:
 * getMatterExpenses does no permission check of its own, so if the
 * page renders ExpensesSection unconditionally, every viewer with
 * access to the matter sees amounts, categories and receipts. These
 * tests pin the gate on both sides — no section AND no expense
 * fetch without the key; section + fetch with it.
 *
 * The expense actions' own create/edit/delete gates live with the
 * action tests — only the page's read-side plumbing is covered here.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  ExpenseSummary,
  MatterTimeSummary,
  TimeEntryRow,
} from "@/lib/queries/matter-detail";

// Page auth guard (src/lib/current-user.ts) — session exists here.
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/queries/matter-detail", () => ({
  getMatterExpenses: vi.fn(),
  getMatterTimeEntries: vi.fn(),
  getMatterTimeSummary: vi.fn(),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: { findMany: vi.fn() },
    timeEntry: { count: vi.fn() },
  },
}));

// Leaf components — the tests only care whether the expense section
// (and the composer inside it) mounted, not their markup.
vi.mock("@/components/matters/captures/time-composer", () => ({
  TimeComposer: () => <div data-testid="time-composer" />,
}));
vi.mock("@/components/time-entries/time-entry-row-actions", () => ({
  // Surface the capability props so tests can assert what the page
  // computed for each row.
  TimeEntryRowMenu: ({
    canEdit,
    canDelete,
  }: {
    canEdit?: boolean;
    canDelete?: boolean;
  }) => (
    <div
      data-testid="time-entry-menu"
      data-can-edit={String(canEdit)}
      data-can-delete={String(canDelete)}
    />
  ),
}));
vi.mock("@/components/matters/entity-source-chip", () => ({
  EntitySourceChip: () => <div data-testid="source-chip" />,
}));
vi.mock("@/components/matters/row-attached-notes", () => ({
  RowAttachedNotes: () => <div data-testid="row-notes" />,
}));
vi.mock("@/components/matters/expenses/expense-composer", () => ({
  ExpenseComposer: () => <div data-testid="expense-composer" />,
}));
vi.mock("@/components/matters/expenses/expense-row-actions", () => ({
  ExpenseRowActions: () => <div data-testid="expense-row-actions" />,
}));

import {
  getMatterExpenses,
  getMatterTimeEntries,
  getMatterTimeSummary,
} from "@/lib/queries/matter-detail";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import MatterTimePage from "./page";

const mockedExpenses = vi.mocked(getMatterExpenses);
const mockedTimeEntries = vi.mocked(getMatterTimeEntries);
const mockedTimeSummary = vi.mocked(getMatterTimeSummary);
const mockedHasPermission = vi.mocked(currentUserHasPermission);
const mockedFindDocuments = vi.mocked(prisma.document.findMany);
const mockedCount = vi.mocked(prisma.timeEntry.count);

const props = (id = "matter_1") =>
  ({ params: Promise.resolve({ id }) }) as Parameters<
    typeof MatterTimePage
  >[0];

const emptySummary: MatterTimeSummary = {
  totalHours: 0,
  billableHours: 0,
  unbilledAmount: 0,
  billedAmount: 0,
};

const emptyExpenses: ExpenseSummary = {
  rows: [],
  totalAmount: 0,
  billableUnbilledAmount: 0,
};

/** Minimal billable entry — enough to exercise the non-empty render
 *  branch, which carries its own ExpensesSection call site. */
const timeEntry = (): TimeEntryRow => ({
  id: "te_1",
  date: new Date("2026-07-01T12:00:00Z"),
  hours: 1.5,
  activity: "Draft motion",
  narrative: null,
  utbmsCode: null,
  rate: 250,
  amount: 375,
  billable: true,
  noCharge: false,
  privileged: false,
  source: "manual",
  status: "draft",
  userId: "user_1",
  userName: "Jason Kosloski",
  userInitials: "JK",
  invoiceId: null,
  spawnedFrom: null,
  attachedNotes: [],
});

/** Grant every expense key except the ones listed. */
const grantAllExcept = (...denied: string[]) => {
  mockedHasPermission.mockImplementation(async (key: string) =>
    denied.includes(key) ? false : true
  );
};

const arrange = (
  opts: { entries?: TimeEntryRow[]; total?: number } = {}
) => {
  const entries = opts.entries ?? [];
  const total = opts.total ?? entries.length;
  mockedTimeEntries.mockResolvedValue(entries);
  mockedCount.mockResolvedValue(total);
  mockedTimeSummary.mockResolvedValue(emptySummary);
  mockedExpenses.mockResolvedValue(emptyExpenses);
  mockedFindDocuments.mockResolvedValue([]);
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("MatterTimePage — matters.expense.view gate", () => {
  test("without the view key the expense section is not rendered and no expense data is fetched", async () => {
    arrange();
    grantAllExcept("matters.expense.view");

    render(await MatterTimePage(props()));

    expect(screen.queryByText("Expenses")).toBeNull();
    // The gate must stop the fetches too, not just the markup —
    // amounts should never leave the database for this viewer.
    expect(mockedExpenses).not.toHaveBeenCalled();
    expect(mockedFindDocuments).not.toHaveBeenCalled();
  });

  test("view key hides expenses on the non-empty time-entries branch too", async () => {
    arrange({ entries: [timeEntry()] });
    grantAllExcept("matters.expense.view");

    render(await MatterTimePage(props()));

    expect(screen.getByText("Time entries")).toBeInTheDocument();
    expect(screen.queryByText("Expenses")).toBeNull();
    expect(mockedExpenses).not.toHaveBeenCalled();
  });

  test("with the view key the expense section renders from the fetched rows", async () => {
    arrange();
    grantAllExcept();

    render(await MatterTimePage(props("matter_9")));

    expect(screen.getByText("Expenses")).toBeInTheDocument();
    expect(mockedExpenses).toHaveBeenCalledWith("matter_9");
  });

  test("view without create shows the list but not the composer", async () => {
    arrange();
    grantAllExcept("matters.expense.create");

    render(await MatterTimePage(props()));

    expect(screen.getByText("Expenses")).toBeInTheDocument();
    expect(screen.queryByTestId("expense-composer")).toBeNull();
  });
});

describe("MatterTimePage — receipt picker documents", () => {
  test("documents are not fetched for a viewer who cannot create expenses", async () => {
    arrange();
    grantAllExcept("matters.expense.create");

    render(await MatterTimePage(props()));

    expect(mockedExpenses).toHaveBeenCalled();
    expect(mockedFindDocuments).not.toHaveBeenCalled();
  });

  test("the picker query is capped", async () => {
    arrange();
    grantAllExcept();

    render(await MatterTimePage(props()));

    expect(mockedFindDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 })
    );
  });
});

describe("MatterTimePage — time_entries.* gates", () => {
  test("composer is hidden without time_entries.create (typed input would be lost to a redirect)", async () => {
    arrange({ entries: [timeEntry()] });
    grantAllExcept("time_entries.create");

    render(await MatterTimePage(props()));

    expect(screen.queryByTestId("time-composer")).toBeNull();
  });

  test("composer renders with time_entries.create, on the empty branch too", async () => {
    arrange();
    grantAllExcept();

    render(await MatterTimePage(props()));

    expect(screen.getByTestId("time-composer")).toBeInTheDocument();
  });

  test("a non-author without the _any keys gets no edit/delete on someone else's entry", async () => {
    arrange({ entries: [{ ...timeEntry(), userId: "someone_else" }] });
    grantAllExcept("time_entries.edit_any", "time_entries.delete_any");

    render(await MatterTimePage(props()));

    const menu = screen.getByTestId("time-entry-menu");
    expect(menu).toHaveAttribute("data-can-edit", "false");
    expect(menu).toHaveAttribute("data-can-delete", "false");
  });

  test("the author keeps edit/delete on their own entry without the _any keys", async () => {
    arrange({ entries: [timeEntry()] });
    grantAllExcept("time_entries.edit_any", "time_entries.delete_any");

    render(await MatterTimePage(props()));

    const menu = screen.getByTestId("time-entry-menu");
    expect(menu).toHaveAttribute("data-can-edit", "true");
    expect(menu).toHaveAttribute("data-can-delete", "true");
  });

  test("edit_any alone lets a non-author edit but not delete", async () => {
    arrange({ entries: [{ ...timeEntry(), userId: "someone_else" }] });
    grantAllExcept("time_entries.delete_any");

    render(await MatterTimePage(props()));

    const menu = screen.getByTestId("time-entry-menu");
    expect(menu).toHaveAttribute("data-can-edit", "true");
    expect(menu).toHaveAttribute("data-can-delete", "false");
  });
});

describe("MatterTimePage — list cap and hours format", () => {
  test("header says 'latest N of M' when the list is capped", async () => {
    arrange({ entries: [timeEntry()], total: 450 });
    grantAllExcept();

    render(await MatterTimePage(props()));

    expect(screen.getByText("latest 1 of 450")).toBeInTheDocument();
  });

  test("header is the plain count when nothing is cut off", async () => {
    arrange({ entries: [timeEntry()], total: 1 });
    grantAllExcept();

    render(await MatterTimePage(props()));

    expect(screen.queryByText(/latest/)).toBeNull();
  });

  test("quarter-hour entries show two decimals (0.25 is not 0.3)", async () => {
    arrange({ entries: [{ ...timeEntry(), hours: 0.25 }] });
    mockedTimeSummary.mockResolvedValue({
      ...emptySummary,
      totalHours: 0.75,
      billableHours: 0.25,
    });
    grantAllExcept();

    render(await MatterTimePage(props()));

    // Row cell + summary cards.
    expect(screen.getAllByText("0.25").length).toBeGreaterThan(0);
    expect(screen.getByText("0.75")).toBeInTheDocument();
    expect(screen.queryByText("0.3")).toBeNull();
    expect(screen.queryByText("0.8")).toBeNull();
  });

  test("entry dates render as the stored calendar day in any zone", async () => {
    // Stored UTC midnight of Jul 1 reads Jun 30 with local getters
    // west of UTC (the suite also runs under America/Denver).
    arrange({
      entries: [{ ...timeEntry(), date: new Date("2026-07-01T00:00:00Z") }],
    });
    grantAllExcept();

    render(await MatterTimePage(props()));

    expect(screen.getByText("Jul 1, 2026")).toBeInTheDocument();
  });
});
