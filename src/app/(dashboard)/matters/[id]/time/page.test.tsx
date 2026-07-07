/**
 * /matters/[id]/time — matters.expense.view gate on the expense
 * section.
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

vi.mock("@/lib/queries/matter-detail", () => ({
  getMatterExpenses: vi.fn(),
  getMatterTimeEntries: vi.fn(),
  getMatterTimeSummary: vi.fn(),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { document: { findMany: vi.fn() } },
}));

// Leaf components — the tests only care whether the expense section
// (and the composer inside it) mounted, not their markup.
vi.mock("@/components/matters/captures/time-composer", () => ({
  TimeComposer: () => <div data-testid="time-composer" />,
}));
vi.mock("@/components/time-entries/time-entry-row-actions", () => ({
  TimeEntryRowMenu: () => <div data-testid="time-entry-menu" />,
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

const arrange = ({ entries = [] as TimeEntryRow[] } = {}) => {
  mockedTimeEntries.mockResolvedValue(entries);
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
