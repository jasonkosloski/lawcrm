/**
 * Matters table + kanban rendering: money formatting (F317), the
 * stretched row link (F780), no phantom empty columns (F779) and the
 * mobile gutter (F778). Plus the entity source chip hrefs (F777).
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

import type { MatterListRow } from "@/lib/queries/matters";
import { MattersTable } from "./matters-table";
import { MattersKanban } from "./matters-kanban";
import { EntitySourceChip } from "./entity-source-chip";

function row(over: Partial<MatterListRow> = {}): MatterListRow {
  return {
    id: "m1",
    name: "Alvarez v. City",
    caseNumber: "26-cv-100",
    area: "§1983",
    stage: "Discovery",
    stageOrder: 3,
    stageIsTerminal: false,
    billingType: "contingent",
    trustBalance: 0,
    color: "#123456",
    leadInitials: "PL",
    leadName: "Pat Lee",
    nextDeadlineDays: 4,
    nextDeadlineDate: null,
    isPinned: false,
    isArchived: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("MattersTable", () => {
  test("shows the billing type label, Court-appointed included", () => {
    render(
      <MattersTable
        matters={[row({ billingType: "court_appointed" })]}
        showTrust
      />
    );
    expect(screen.getByText("Court-appointed")).toBeTruthy();
  });

  test("trust balances show two decimals, thousands separators and a leading minus", () => {
    render(
      <MattersTable
        matters={[
          row({ id: "a", name: "A", trustBalance: 1234.5 }),
          row({ id: "b", name: "B", trustBalance: 0.5 }),
          row({ id: "c", name: "C", trustBalance: -500.25 }),
          row({ id: "d", name: "D", trustBalance: 0 }),
        ]}
      />
    );
    // Rendered twice (mobile cards + desktop table).
    expect(screen.getAllByText("$1,234.50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-$500.25").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("$1,234.5")).toBeNull();
    expect(screen.queryByText("$-500.25")).toBeNull();
  });

  test("the name link is stretched over the whole row that advertises a pointer", () => {
    render(<MattersTable matters={[row()]} />);
    const link = screen
      .getAllByRole("link")
      .find((l) => l.className.includes("after:absolute"));
    expect(link).toBeDefined();
    expect(link!.className).toContain("after:inset-0");
    const tr = link!.closest("tr")!;
    expect(tr.className).toContain("relative");
    expect(tr.className).toContain("cursor-pointer");
  });
});

describe("MattersKanban", () => {
  test("card label shows Court-appointed for a court_voucher matter", () => {
    render(<MattersKanban matters={[row({ billingType: "court_appointed" })]} />);
    expect(screen.getByText("Court-appointed")).toBeTruthy();
  });

  test("trust uses the shared two-decimal formatter", () => {
    render(<MattersKanban matters={[row({ trustBalance: 1234.5 })]} />);
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
  });

  test("one column per stage present, in stage order", () => {
    render(
      <MattersKanban
        matters={[
          row({ id: "a", stage: "Trial", stageOrder: 5 }),
          row({ id: "b", stage: "Intake", stageOrder: 1 }),
          row({ id: "c", stage: "Trial", stageOrder: 5 }),
        ]}
      />
    );
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["Intake", "Trial"]);
    expect(screen.queryByText("No matters")).toBeNull();
  });

  test("bleeds by the page's mobile gutter (-mx-3), not 20px, below sm", () => {
    const { container } = render(<MattersKanban matters={[row()]} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("-mx-3");
    expect(root.className).toContain("px-3");
    expect(root.className).toContain("sm:-mx-6");
    expect(root.className).not.toMatch(/(^|\s)-mx-5(\s|$)/);
  });
});

describe("EntitySourceChip", () => {
  test("message sources link to the matter's phone channel, not the firm-wide inbox", () => {
    render(
      <EntitySourceChip
        matterId="m1"
        source={{ kind: "message", id: "t1", label: "Call from Pat" }}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/matters/m1/communication?channel=phone"
    );
  });

  test("note and email sources keep their matter-scoped hrefs", () => {
    const { rerender } = render(
      <EntitySourceChip
        matterId="m1"
        source={{ kind: "note", id: "n1", label: "x" }}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/matters/m1/notes#note-n1"
    );
    rerender(
      <EntitySourceChip
        matterId="m1"
        source={{ kind: "email", id: "e1", label: "Re: settlement" }}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/matters/m1/communication?thread=e1"
    );
  });
});
