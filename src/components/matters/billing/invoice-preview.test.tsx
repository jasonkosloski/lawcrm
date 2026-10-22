/**
 * Tests for InvoicePreview.
 *
 *  - Editable gating: a line is editable only when the invoice is in
 *    an editable state (`editable`, never in print mode) AND the
 *    viewer authored the entry or holds time_entries.edit_any.
 *  - ADR-012 dates: date-only line / expense / payment dates show the
 *    stored day (no zone shift); issue / due instants show in the
 *    viewer's profile zone.
 *  - A voided invoice never prints a non-zero "Total due" / Balance.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The inline editor carries its own server-action wiring and is
// covered by its own test; here we only need to know which rows get it.
vi.mock("./editable-line-item-row", () => ({
  EditableLineItemRow: ({ timeEntryId }: { timeEntryId: string }) => (
    <tr data-testid={`editable-${timeEntryId}`}>
      <td>editable</td>
    </tr>
  ),
}));

import { InvoicePreview } from "./invoice-preview";
import type { InvoiceDetail } from "@/lib/queries/billing";
import type { FirmProfile } from "@/lib/firm";

const firm = {
  name: "Kosloski Law",
  addressLine1: "1 Main St",
  addressLine2: null,
  city: "Denver",
  state: "CO",
  zip: "80202",
  phone: null,
  email: null,
} as unknown as FirmProfile;

const invoice = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: "inv1",
  invoiceNumber: "2026-001",
  // Instants: 04:00Z on May 1 is still Apr 30 at 10 PM in Denver
  // (MDT) -> Apr 30; in UTC it is May 1.
  issueDate: new Date("2026-05-01T04:00:00Z"),
  dueDate: new Date("2026-05-31T04:00:00Z"),
  daysUntilDue: 10,
  subtotal: 450,
  taxAmount: 0,
  totalAmount: 450,
  paidAmount: 0,
  balance: 450,
  status: "draft",
  kind: "client",
  notes: null,
  lineItemCount: 2,
  matterId: "m1",
  matterName: "Doe v. City",
  clientName: "Jane Doe",
  clientEmail: "jane@example.com",
  clientAddress: null,
  lineItems: [
    {
      id: "te-mine",
      date: new Date("2026-04-15T00:00:00Z"),
      hours: 1,
      activity: "Research",
      narrative: null,
      rate: 300,
      amount: 300,
      userId: "u-me",
      userName: "Me",
      userJobTitle: "Attorney",
      userInitials: "ME",
    },
    {
      id: "te-theirs",
      date: new Date("2026-04-16T00:00:00Z"),
      hours: 0.5,
      activity: "Drafting",
      narrative: null,
      rate: 300,
      amount: 150,
      userId: "u-other",
      userName: "Other",
      userJobTitle: "Paralegal",
      userInitials: "OT",
    },
  ],
  expenseLineItems: [
    {
      id: "ex1",
      date: new Date("2026-04-20T00:00:00Z"),
      description: "Filing fee",
      category: "filing_fee",
      amount: 0,
      utbmsCode: null,
      notes: null,
    },
  ],
  payments: [
    {
      id: "p1",
      date: new Date("2026-04-25T00:00:00Z"),
      source: "check",
      description: null,
      reference: "1001",
      amount: 100,
    },
  ],
  paymentsRecordedTotal: 100,
  ...over,
});

const render_ = (
  props: Partial<React.ComponentProps<typeof InvoicePreview>> = {},
  inv: InvoiceDetail = invoice()
) =>
  render(
    <InvoicePreview
      invoice={inv}
      firm={firm}
      timeZone="America/Denver"
      {...props}
    />
  );

describe("InvoicePreview — editable gating", () => {
  test("not editable: every line is the static row", () => {
    render_({ editable: false, currentUserId: "u-me", canEditAnyTimeEntry: true });
    expect(screen.queryByTestId(/^editable-/)).toBeNull();
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Drafting")).toBeInTheDocument();
  });

  test("editable, author only: just the viewer's own entry is editable", () => {
    render_({ editable: true, currentUserId: "u-me", canEditAnyTimeEntry: false });
    expect(screen.getByTestId("editable-te-mine")).toBeInTheDocument();
    expect(screen.queryByTestId("editable-te-theirs")).toBeNull();
    expect(screen.getByText("Drafting")).toBeInTheDocument();
  });

  test("editable with time_entries.edit_any: every entry is editable", () => {
    render_({ editable: true, currentUserId: "u-me", canEditAnyTimeEntry: true });
    expect(screen.getByTestId("editable-te-mine")).toBeInTheDocument();
    expect(screen.getByTestId("editable-te-theirs")).toBeInTheDocument();
  });

  test("editable with neither authorship nor edit_any: nothing is editable", () => {
    render_({ editable: true, currentUserId: "u-nobody", canEditAnyTimeEntry: false });
    expect(screen.queryByTestId(/^editable-/)).toBeNull();
  });

  test("print mode never shows edit chrome, even for a privileged viewer", () => {
    render_({
      printMode: true,
      editable: true,
      currentUserId: "u-me",
      canEditAnyTimeEntry: true,
    });
    expect(screen.queryByTestId(/^editable-/)).toBeNull();
  });
});

describe("InvoicePreview — dates (ADR-012)", () => {
  test("date-only line / expense / payment dates show the stored day, not the previous local day", () => {
    render_();
    // Stored as UTC midnight; a Denver viewer must still see these days.
    expect(screen.getByText("Apr 15")).toBeInTheDocument();
    expect(screen.getByText("Apr 16")).toBeInTheDocument();
    expect(screen.getByText("Apr 20")).toBeInTheDocument();
    expect(screen.getByText("Apr 25")).toBeInTheDocument();
    expect(screen.queryByText("Apr 14")).toBeNull();
  });

  test("issue and due instants render in the viewer's profile zone", () => {
    const { unmount } = render_({ timeZone: "America/Denver" });
    expect(screen.getByText("April 30, 2026")).toBeInTheDocument();
    expect(screen.getByText("May 30, 2026")).toBeInTheDocument();
    unmount();

    render_({ timeZone: "UTC" });
    expect(screen.getByText("May 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("May 31, 2026")).toBeInTheDocument();
  });
});

describe("InvoicePreview — voided invoices", () => {
  test("a void invoice does not print a Total due / Balance equal to its total", () => {
    render_({}, invoice({ status: "void", balance: 450, paidAmount: 0 }));
    expect(screen.getByText("Void — nothing due")).toBeInTheDocument();
    // The $450 total still shows once (Subtotal/Total rows) but never as
    // a balance: no dd under "Balance" or "Total due" carries $450.00.
    const balanceLabel = screen.getByText("Balance");
    expect(balanceLabel.nextElementSibling).toHaveTextContent("—");
  });

  test("a void invoice carries the VOID watermark; an open one doesn't", () => {
    const { unmount } = render_({}, invoice({ status: "void", balance: 450, paidAmount: 0 }));
    expect(screen.getByTestId("void-watermark")).toHaveTextContent("VOID");
    unmount();
    render_({}, invoice({ status: "sent", balance: 450, paidAmount: 0 }));
    expect(screen.queryByTestId("void-watermark")).toBeNull();
  });

  test("an open invoice still shows its balance", () => {
    render_({}, invoice({ status: "sent", balance: 350, paidAmount: 100 }));
    expect(screen.getByText("Balance").nextElementSibling).toHaveTextContent(
      "$350.00"
    );
    expect(screen.getByText("Total due").nextElementSibling).toHaveTextContent(
      "$350.00"
    );
  });
});
