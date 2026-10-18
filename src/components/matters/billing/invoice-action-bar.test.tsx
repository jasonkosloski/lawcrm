/**
 * Tests for InvoiceActionBar.
 *
 * Two concerns:
 *  1. Permission gating (F163/F444). `requirePermission` answers a
 *     denied action with a silent redirect to "/", so the bar must
 *     not OFFER a button the viewer's keys can't back. Every flag
 *     defaults to false; Apply trust needs billing.apply_trust AND
 *     billing.record_payment (the server stacks both).
 *  2. The status x kind x balance matrix: which action each state
 *     offers, and that terminal / empty states render nothing.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/billing", () => ({
  approveInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  setInvoiceStatus: vi.fn(),
  recordInvoicePayment: vi.fn(),
  sendInvoice: vi.fn(),
}));

import { approveInvoice } from "@/app/actions/billing";
import { InvoiceActionBar } from "./invoice-action-bar";

const baseProps = {
  invoiceId: "inv1",
  invoiceNumber: "2026-001",
  currentStatus: "sent",
  invoiceBalance: 300,
  trustBalance: 1000,
  paidAmount: 0,
  clientEmail: "c@example.com",
};

const ALL = {
  canApproveInvoice: true,
  canSendInvoice: true,
  canRecordInvoicePayment: true,
  canVoid: true,
  canDeleteDraft: true,
};

const button = (name: RegExp) => screen.queryByRole("button", { name });

describe("InvoiceActionBar — Apply trust visibility", () => {
  test("hidden without billing.apply_trust (Record payment still offered)", () => {
    render(<InvoiceActionBar {...baseProps} {...ALL} />);
    expect(button(/apply trust/i)).not.toBeInTheDocument();
    expect(button(/record payment/i)).toBeInTheDocument();
  });

  test("shown with billing.apply_trust when there is trust and an open balance", () => {
    render(<InvoiceActionBar {...baseProps} {...ALL} canApplyTrust />);
    expect(button(/apply trust/i)).toBeInTheDocument();
  });

  test("hidden even with the key when the matter has no trust funds", () => {
    render(
      <InvoiceActionBar {...baseProps} {...ALL} trustBalance={0} canApplyTrust />
    );
    expect(button(/apply trust/i)).not.toBeInTheDocument();
  });

  test("hidden when the viewer has apply_trust but not record_payment (the server needs both)", () => {
    render(
      <InvoiceActionBar
        {...baseProps}
        {...ALL}
        canRecordInvoicePayment={false}
        canApplyTrust
      />
    );
    expect(button(/apply trust/i)).not.toBeInTheDocument();
    expect(button(/record payment/i)).not.toBeInTheDocument();
  });
});

describe("InvoiceActionBar — per-action permission gating", () => {
  test("no flags at all (defaults): nothing is offered, the bar renders nothing", () => {
    const { container } = render(
      <InvoiceActionBar {...baseProps} currentStatus="draft" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("draft: Approve needs billing.approve_invoice", () => {
    const { rerender } = render(
      <InvoiceActionBar
        {...baseProps}
        currentStatus="draft"
        canDeleteDraft
      />
    );
    expect(button(/^approve$/i)).not.toBeInTheDocument();
    // Delete (kebab) is still reachable on its own key.
    expect(button(/more invoice actions/i)).toBeInTheDocument();

    rerender(
      <InvoiceActionBar
        {...baseProps}
        currentStatus="draft"
        canApproveInvoice
      />
    );
    expect(button(/^approve$/i)).toBeInTheDocument();
    // Without delete_draft there is no kebab for a draft.
    expect(button(/more invoice actions/i)).not.toBeInTheDocument();
  });

  test("approved: Mark as sent needs billing.send_invoice", () => {
    const { rerender } = render(
      <InvoiceActionBar {...baseProps} currentStatus="approved" canVoid />
    );
    expect(button(/mark as sent/i)).not.toBeInTheDocument();
    rerender(
      <InvoiceActionBar
        {...baseProps}
        currentStatus="approved"
        canSendInvoice
      />
    );
    expect(button(/mark as sent/i)).toBeInTheDocument();
  });

  test("void is hidden without billing.void_invoice", () => {
    const { container } = render(
      <InvoiceActionBar {...baseProps} currentStatus="approved" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("internal record draft: Mark recorded shares billing.approve_invoice", () => {
    const { rerender } = render(
      <InvoiceActionBar
        {...baseProps}
        kind="internal_record"
        currentStatus="draft"
        canSendInvoice
      />
    );
    expect(button(/mark recorded/i)).not.toBeInTheDocument();
    rerender(
      <InvoiceActionBar
        {...baseProps}
        kind="internal_record"
        currentStatus="draft"
        canApproveInvoice
      />
    );
    expect(button(/mark recorded/i)).toBeInTheDocument();
  });
});

describe("InvoiceActionBar — status x kind x balance matrix (all permissions held)", () => {
  type Row = {
    name: string;
    props: Partial<Parameters<typeof InvoiceActionBar>[0]>;
    shown: RegExp[];
    hidden: RegExp[];
  };
  const rows: Row[] = [
    {
      name: "client draft",
      props: { currentStatus: "draft" },
      shown: [/^approve$/i, /more invoice actions/i],
      hidden: [/mark as sent/i, /record payment/i, /mark recorded/i],
    },
    {
      name: "client approved",
      props: { currentStatus: "approved" },
      shown: [/mark as sent/i, /more invoice actions/i],
      hidden: [/^approve$/i, /record payment/i],
    },
    {
      name: "client sent with a balance",
      props: { currentStatus: "sent" },
      shown: [/record payment/i, /more invoice actions/i],
      hidden: [/^approve$/i, /mark as sent/i],
    },
    {
      name: "client partial with a balance (no void: payment recorded)",
      props: { currentStatus: "partial", paidAmount: 100 },
      shown: [/record payment/i],
      hidden: [/more invoice actions/i, /mark as sent/i],
    },
    {
      name: "client sent with zero balance",
      props: { currentStatus: "sent", invoiceBalance: 0, trustBalance: 0 },
      shown: [/more invoice actions/i],
      hidden: [/record payment/i, /apply trust/i],
    },
    {
      name: "client paid (terminal)",
      props: { currentStatus: "paid", invoiceBalance: 0, paidAmount: 300 },
      shown: [],
      hidden: [/record payment/i, /more invoice actions/i, /^approve$/i],
    },
    {
      name: "client void (terminal)",
      props: { currentStatus: "void", invoiceBalance: 0 },
      shown: [],
      hidden: [/record payment/i, /more invoice actions/i],
    },
    {
      name: "internal record draft",
      props: { kind: "internal_record", currentStatus: "draft" },
      shown: [/mark recorded/i, /more invoice actions/i],
      hidden: [/^approve$/i, /mark as sent/i, /record payment/i],
    },
    {
      name: "internal record paid (voidable only)",
      props: { kind: "internal_record", currentStatus: "paid", invoiceBalance: 0 },
      shown: [/more invoice actions/i],
      hidden: [/mark recorded/i, /record payment/i],
    },
  ];

  test.each(rows)("$name", ({ props, shown, hidden }) => {
    const { container } = render(
      <InvoiceActionBar {...baseProps} {...ALL} canApplyTrust {...props} />
    );
    for (const re of shown) expect(button(re), String(re)).toBeInTheDocument();
    for (const re of hidden) {
      expect(button(re), String(re)).not.toBeInTheDocument();
    }
    if (shown.length === 0) expect(container).toBeEmptyDOMElement();
  });
});

describe("InvoiceActionBar — Approve", () => {
  test("posts the total the approver is looking at so a moved total is refused", async () => {
    vi.mocked(approveInvoice).mockResolvedValue({ ok: true });
    render(
      <InvoiceActionBar
        {...baseProps}
        currentStatus="draft"
        invoiceBalance={1234.5}
        canApproveInvoice
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(approveInvoice).toHaveBeenCalledWith("inv1", "1234.50")
    );
  });
});
