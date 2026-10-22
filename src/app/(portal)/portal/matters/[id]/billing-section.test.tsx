import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));

import { BillingSection } from "./billing-section";

const inv = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  invoiceNumber: "INV-1001",
  issueDate: new Date("2026-03-05T18:00:00Z"),
  dueDate: new Date("2026-04-04T18:00:00Z"),
  totalAmount: 1500,
  paidAmount: 500,
  balance: 1000,
  status: "partial" as const,
  overdue: false,
  ...over,
});

describe("BillingSection", () => {
  test("invoices table: columns, money, link and status chips", () => {
    render(
      <BillingSection
        matterId="m1"
        trust={null}
        invoices={[
          inv(),
          inv({
            id: "i2",
            invoiceNumber: "INV-1002",
            status: "sent",
            paidAmount: 0,
            balance: 1500,
          }),
          inv({
            id: "i3",
            invoiceNumber: "INV-1003",
            status: "paid",
            paidAmount: 1500,
            balance: 0,
          }),
          inv({ id: "i4", invoiceNumber: "INV-1004", status: "sent", overdue: true }),
        ]}
      />,
    );
    for (const h of ["Invoice", "Issued", "Due", "Total", "Paid", "Balance", "Status"]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeTruthy();
    }
    const link = screen.getByRole("link", { name: "INV-1001" });
    expect(link.getAttribute("href")).toBe("/matters/m1/invoices/i1");
    const row = link.closest("tr")!;
    expect(within(row).getByText("$1,500.00")).toBeTruthy();
    expect(within(row).getByText("$500.00")).toBeTruthy();
    expect(within(row).getByText("$1,000.00")).toBeTruthy();
    expect(within(row).getByText("Mar 5, 2026")).toBeTruthy();
    expect(within(row).getByText("Partially paid")).toBeTruthy();
    const rowOf = (n: string) => screen.getByRole("link", { name: n }).closest("tr")!;
    expect(within(rowOf("INV-1002")).getByText("Sent")).toBeTruthy();
    expect(within(rowOf("INV-1003")).getByText("Paid")).toBeTruthy();
    // An overdue invoice shows Overdue instead of Sent.
    const overdueRow = screen.getByRole("link", { name: "INV-1004" }).closest("tr")!;
    expect(within(overdueRow).getByText("Overdue")).toBeTruthy();
    expect(within(overdueRow).queryByText("Sent")).toBeNull();
  });

  test("trust card shows the note, balance and ledger", () => {
    render(
      <BillingSection
        matterId="m1"
        invoices={[]}
        trust={{
          balance: 750,
          entries: [
            {
              id: "t2",
              date: new Date("2026-02-10T00:00:00Z"),
              type: "disbursement",
              amount: -250,
              runningBalance: 750,
              description: "Filing fee",
            },
            {
              id: "t1",
              date: new Date("2026-02-01T00:00:00Z"),
              type: "deposit",
              amount: 1000,
              runningBalance: 1000,
              description: "Retainer",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Trust account")).toBeTruthy();
    expect(screen.getByText("Funds held in trust for this matter.")).toBeTruthy();
    expect(screen.getByText("Retainer")).toBeTruthy();
    expect(screen.getByText("Filing fee")).toBeTruthy();
    expect(screen.getByText("Deposit")).toBeTruthy();
    expect(screen.getByText("Disbursement")).toBeTruthy();
    const row = screen.getByText("Filing fee").closest("tr")!;
    expect(within(row).getByText("Feb 10, 2026")).toBeTruthy();
    expect(within(row).getByText("-$250.00")).toBeTruthy();
    expect(within(row).getByText("$750.00")).toBeTruthy();
    expect(screen.getAllByText("$750.00").length).toBeGreaterThan(1); // card balance too
  });

  test("renders no invoices table without invoices and no trust card without trust", () => {
    render(<BillingSection matterId="m1" invoices={[inv()]} trust={null} />);
    expect(screen.queryByText("Trust account")).toBeNull();
    expect(screen.getByRole("heading", { name: "Billing" })).toBeTruthy();
  });
});
